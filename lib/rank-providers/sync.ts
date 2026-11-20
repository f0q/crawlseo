import type { Prisma, PrismaClient } from "@prisma/client";
// Check days go through gscDate, the one day-to-UTC-midnight conversion, so a
// rank row and a GSC row for the same day carry the same timestamp.
import { gscDate } from "@/lib/google/gsc-date";
import { getRankProviderKey } from "./keys";
import { getRankProvider, rankProviderIds } from "./registry";
import { RankKeyMissingError, RankProviderError, type RankProviderClient, type RankRow } from "./types";

/*
 * The rank sync, the same for every provider: for each engine of a provider
 * linked to the site, the first sync backfills every check date the provider
 * has, later ones fetch only new dates plus the newest stored one. Imported
 * and pushed engines are not synced.
 */

/** Rows per createMany, well under Postgres' 65535 bind parameters (8 columns a row). */
const INSERT_BATCH = 2_000;

export interface RankSyncResult {
  engines: number;
  datesFetched: number;
  rowsWritten: number;
  /** Engines that failed while the others were written: "label: reason". */
  failed?: string[];
}

/** Every engine failed; `permanent` when no retry can help (key, subscription, project gone). */
export class RankSyncError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean
  ) {
    super(message);
    this.name = "RankSyncError";
  }
}

type Engine = { id: string; source: string; externalSiteId: string; externalEngineId: string; engine: string; region: string };

/**
 * The days to download for one engine: every check date the provider has that
 * is not stored yet, plus the newest stored one again. A check can still be
 * running when a sync reads it, so the newest day is the one that may have
 * grown since; older days are final.
 */
export function daysToFetch(available: string[], stored: string[]): string[] {
  const have = new Set(stored);
  const newest = stored.length ? [...stored].sort().at(-1) : undefined;
  return [...new Set(available)].filter((day) => !have.has(day) || day === newest).sort();
}

/** Splits into runs of at most `size`, in order. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The rows of the asked days for one engine; a keyword listed twice on a day is written once. */
export function rankRows(engineId: string, rows: RankRow[], days: string[]): Prisma.ExternalRankCreateManyInput[] {
  const wanted = new Set(days);
  const out: Prisma.ExternalRankCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!wanted.has(row.date)) continue;
    // The unique key is (engine, keyword, date).
    const key = `${row.keyword}\u0000${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      engineId,
      keyword: row.keyword,
      date: gscDate(row.date),
      position: row.position,
      url: row.url,
      frequency: row.frequency ?? null,
      frequencyExact: row.frequencyExact ?? null,
    });
  }
  return out;
}

async function storedDays(db: PrismaClient, engineId: string): Promise<string[]> {
  const rows = await db.externalRank.groupBy({ by: ["date"], where: { engineId } });
  return rows.map((r) => r.date.toISOString().slice(0, 10));
}

/**
 * Replaces the given days' rows of one engine: delete and insert in one
 * transaction, so a rerun writes the same rows and a failed batch leaves the
 * earlier ones.
 */
export async function replaceDays(
  db: PrismaClient,
  engineId: string,
  days: string[],
  rows: Prisma.ExternalRankCreateManyInput[]
): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await tx.externalRank.deleteMany({ where: { engineId, date: { in: days.map(gscDate) } } });
      for (const part of chunk(rows, INSERT_BATCH)) {
        await tx.externalRank.createMany({ data: part, skipDuplicates: true });
      }
    },
    { timeout: 60_000 }
  );
}

async function syncEngine(db: PrismaClient, client: RankProviderClient, maxDates: number, engine: Engine) {
  const ref = { externalSiteId: engine.externalSiteId, externalEngineId: engine.externalEngineId };
  const available = await client.listDates(ref);
  const days = daysToFetch(available, await storedDays(db, engine.id));
  let rowsWritten = 0;

  for (const batch of chunk(days, Math.max(1, maxDates))) {
    const rows = rankRows(engine.id, await client.fetchPositions(ref, batch), batch);
    await replaceDays(db, engine.id, batch, rows);
    rowsWritten += rows.length;
  }

  // updateMany: an engine unlinked meanwhile is simply not stamped.
  await db.externalRankEngine.updateMany({ where: { id: engine.id }, data: { lastSyncedAt: new Date() } });
  return { datesFetched: days.length, rowsWritten };
}

export type ClientFactory = (source: string, userId: string) => Promise<RankProviderClient>;

const defaultClients: ClientFactory = async (source, userId) =>
  getRankProvider(source)!.createClient(await getRankProviderKey(userId, source));

/**
 * Syncs every provider engine linked to the site, a client per provider. One
 * engine failing (or one provider's key missing) does not stop the others;
 * when all fail it throws, permanent only when no failure can be retried.
 */
export async function syncRanksForSite(
  db: PrismaClient,
  siteId: string,
  opts: { clients?: ClientFactory } = {}
): Promise<RankSyncResult> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: {
      userId: true,
      rankEngines: { where: { source: { in: rankProviderIds() } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!site) throw new RankSyncError("Site not found", true);
  if (site.rankEngines.length === 0) throw new RankSyncError("No rank provider engine is linked to this site", true);

  const makeClient = opts.clients ?? defaultClients;
  const clients = new Map<string, Promise<RankProviderClient>>();
  const result: RankSyncResult = { engines: 0, datesFetched: 0, rowsWritten: 0 };
  const failed: { label: string; error: unknown }[] = [];

  for (const engine of site.rankEngines) {
    const provider = getRankProvider(engine.source)!;
    try {
      if (!clients.has(engine.source)) {
        const pending = makeClient(engine.source, site.userId);
        pending.catch(() => {});
        clients.set(engine.source, pending);
      }
      const done = await syncEngine(db, await clients.get(engine.source)!, provider.maxDatesPerRequest, engine);
      result.engines++;
      result.datesFetched += done.datesFetched;
      result.rowsWritten += done.rowsWritten;
    } catch (error) {
      console.error(
        `[Rank Sync] ${siteId} ${engine.source} engine ${engine.externalEngineId}:`,
        error instanceof Error ? error.message : error
      );
      failed.push({ label: `${provider.name} ${engine.engine}, ${engine.region}`, error });
    }
  }

  const reasons = failed.map(({ label, error }) => `${label}: ${error instanceof Error ? error.message : String(error)}`);
  if (result.engines === 0) {
    const permanent = failed.every(
      ({ error }) => (error instanceof RankProviderError && error.permanent) || error instanceof RankKeyMissingError
    );
    throw new RankSyncError(reasons.join("; ") || "Rank sync failed", permanent);
  }
  console.log(`[Rank Sync] ${siteId}: ${result.engines} engine(s), ${result.datesFetched} date(s), ${result.rowsWritten} row(s)`);
  return failed.length ? { ...result, failed: reasons } : result;
}
