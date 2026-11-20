import type { PrismaClient } from "@prisma/client";
import { engineLabel, LABRIKA_SOURCE, type LabrikaSite } from "./labrika-parse";

/*
 * Which Labrika engines feed a site. A site can take several engines (one per
 * region and device), from one Labrika project or more.
 */

export type EngineRef = { siteUuid: string; engineId: string };

export type LinkedEngine = {
  id: string;
  externalSiteId: string;
  externalEngineId: string;
  host: string;
  engine: string;
  region: string;
  device: string;
  label: string;
  lastSyncedAt: string | null;
};

/** A link the account cannot see: refused with this message. */
export class LabrikaLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabrikaLinkError";
  }
}

export function parseEngineRefs(value: unknown): EngineRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs: EngineRef[] = [];
  for (const item of value) {
    const ref = item as { siteUuid?: unknown; engineId?: unknown };
    if (typeof ref?.siteUuid !== "string" || !ref.siteUuid) return null;
    if (typeof ref.engineId !== "string" && typeof ref.engineId !== "number") return null;
    refs.push({ siteUuid: ref.siteUuid, engineId: String(ref.engineId) });
  }
  return refs;
}

type Db = Pick<PrismaClient, "externalRankEngine" | "$transaction">;

export async function linkedEngines(db: Pick<PrismaClient, "externalRankEngine">, siteId: string): Promise<LinkedEngine[]> {
  const rows = await db.externalRankEngine.findMany({
    where: { siteId, source: LABRIKA_SOURCE },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    externalSiteId: r.externalSiteId,
    externalEngineId: r.externalEngineId,
    host: r.host,
    engine: r.engine,
    region: r.region,
    device: r.device,
    label: engineLabel(r),
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  }));
}

/**
 * Makes `wanted` the site's Labrika engines. Every one must be in `available`
 * (the account's projects, just read from Labrika), which is also where the
 * labels come from. An engine left out is unlinked and its stored positions
 * are deleted with it. Returns how many engines are new: those need a sync.
 */
export async function setLinkedEngines(
  db: Db,
  siteId: string,
  wanted: EngineRef[],
  available: LabrikaSite[]
): Promise<{ added: number; removed: number }> {
  const byKey = new Map<string, { site: LabrikaSite; engine: LabrikaSite["engines"][number] }>();
  for (const site of available) {
    for (const engine of site.engines) byKey.set(`${site.siteUuid}:${engine.id}`, { site, engine });
  }
  const keys = [...new Set(wanted.map((w) => `${w.siteUuid}:${w.engineId}`))];
  for (const key of keys) {
    if (!byKey.has(key)) throw new LabrikaLinkError("This Labrika account has no such project and search engine");
  }

  return db.$transaction(async (tx) => {
    const current = await tx.externalRankEngine.findMany({
      where: { siteId, source: LABRIKA_SOURCE },
      select: { id: true, externalSiteId: true, externalEngineId: true },
    });
    const keep = new Set(keys);
    const stale = current.filter((c) => !keep.has(`${c.externalSiteId}:${c.externalEngineId}`));
    if (stale.length) await tx.externalRankEngine.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

    let added = 0;
    for (const key of keys) {
      const { site, engine } = byKey.get(key)!;
      const labels = { host: site.host || site.title, engine: engine.engine, region: engine.region, device: engine.device };
      const ref = { siteId, source: LABRIKA_SOURCE, externalSiteId: site.siteUuid, externalEngineId: engine.id };
      const existing = current.some((c) => `${c.externalSiteId}:${c.externalEngineId}` === key);
      await tx.externalRankEngine.upsert({
        where: { siteId_source_externalSiteId_externalEngineId: ref },
        create: { ...ref, ...labels },
        update: labels,
      });
      if (!existing) added++;
    }
    return { added, removed: stale.length };
  });
}
