import type { PrismaClient } from "@prisma/client";
import { gscDate } from "@/lib/google/gsc-date";
import { matchKey, normalizeDevice } from "./common";
import { isRankProviderId, rankProviderIds } from "./registry";
import { MAX_MANUAL_ENGINES_PER_SITE, type PushRow } from "./rows";
import { chunk } from "./sync";

/*
 * Engines filled from outside a provider sync: a CSV import ("import") and
 * the write API (any other source name). An engine is one source, label,
 * search engine, region and device; writing rows replaces the same keyword on
 * the same day, so sending a batch twice leaves the same rows.
 */

export class ManualRankError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ManualRankError";
  }
}

export type ManualEngineSpec = { source: string; engine: string; region: string; device: string; label: string };

type Db = Pick<PrismaClient, "externalRankEngine" | "externalRank" | "$transaction">;

/** The engine for this source, label, search engine, region and device; created on first use. */
export async function ensureManualEngine(
  db: Pick<PrismaClient, "externalRankEngine">,
  site: { id: string; domain: string },
  spec: ManualEngineSpec
): Promise<{ id: string; created: boolean }> {
  if (isRankProviderId(spec.source)) {
    throw new ManualRankError(`"${spec.source}" is a rank provider that crawlseo syncs itself; push under another source name`);
  }
  const device = normalizeDevice(spec.device);
  const ref = {
    siteId: site.id,
    source: spec.source,
    externalSiteId: spec.label.trim().toLowerCase(),
    externalEngineId: matchKey({ engine: spec.engine, region: spec.region, device }),
  };
  const existing = await db.externalRankEngine.findUnique({
    where: { siteId_source_externalSiteId_externalEngineId: ref },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const count = await db.externalRankEngine.count({ where: { siteId: site.id, source: { notIn: rankProviderIds() } } });
  if (count >= MAX_MANUAL_ENGINES_PER_SITE) {
    throw new ManualRankError(`This site has ${MAX_MANUAL_ENGINES_PER_SITE} rank engines. Delete one in Site settings first.`, 409);
  }
  const row = await db.externalRankEngine.upsert({
    where: { siteId_source_externalSiteId_externalEngineId: ref },
    create: { ...ref, host: site.domain, engine: spec.engine.trim(), region: spec.region.trim(), device, label: spec.label.trim() },
    update: {},
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/** One row per keyword and day: a later row of the batch wins over an earlier one. */
export function dedupeRows(rows: PushRow[]): PushRow[] {
  const byKey = new Map<string, PushRow>();
  for (const row of rows) byKey.set(`${row.keyword}\u0000${row.date}`, row);
  return [...byKey.values()];
}

/**
 * Upserts the rows of one engine: per day, the batch's keywords are deleted
 * and written again in one transaction. Other keywords of that day stay.
 */
export async function writeManualRows(db: Db, engineId: string, rows: PushRow[]): Promise<{ rowsWritten: number; dates: string[] }> {
  const unique = dedupeRows(rows);
  const byDay = new Map<string, PushRow[]>();
  for (const row of unique) byDay.set(row.date, [...(byDay.get(row.date) ?? []), row]);

  await db.$transaction(
    async (tx) => {
      for (const [day, dayRows] of byDay) {
        for (const part of chunk(dayRows, 1_000)) {
          await tx.externalRank.deleteMany({ where: { engineId, date: gscDate(day), keyword: { in: part.map((r) => r.keyword) } } });
          await tx.externalRank.createMany({
            data: part.map((r) => ({
              engineId,
              keyword: r.keyword,
              date: gscDate(day),
              position: r.position,
              url: r.url ?? null,
              frequency: r.frequency ?? null,
              frequencyExact: r.frequencyExact ?? null,
            })),
          });
        }
      }
      await tx.externalRankEngine.updateMany({ where: { id: engineId }, data: { lastSyncedAt: new Date() } });
    },
    { timeout: 60_000 }
  );
  return { rowsWritten: unique.length, dates: [...byDay.keys()].sort() };
}
