import type { PrismaClient } from "@prisma/client";
import { engineLabel, matchKey } from "./common";
import { getRankProvider } from "./registry";
import type { RankProjectWithEngines } from "./types";

/*
 * Which rank engines feed a site. A site takes any number of engines, from
 * one provider project or more, from CSV imports and from the write API.
 */

export type EngineRef = { externalSiteId: string; externalEngineId: string };

export type LinkedEngine = {
  id: string;
  source: string;
  /** The provider's name, "CSV import", or the pushed source name. */
  sourceName: string;
  /** True for a provider engine that the sync job keeps up to date. */
  synced: boolean;
  externalSiteId: string;
  externalEngineId: string;
  host: string;
  engine: string;
  region: string;
  device: string;
  /** The user label of an imported or pushed engine; "" for provider engines. */
  userLabel: string;
  label: string;
  /** Engines of different sources with the same key can be compared. */
  matchKey: string;
  lastSyncedAt: string | null;
};

/** A link the account cannot see: refused with this message. */
export class RankLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankLinkError";
  }
}

export function sourceName(source: string): string {
  if (source === "import") return "CSV import";
  return getRankProvider(source)?.name ?? source;
}

export function parseEngineRefs(value: unknown): EngineRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs: EngineRef[] = [];
  for (const item of value) {
    const ref = item as { externalSiteId?: unknown; externalEngineId?: unknown };
    if (typeof ref?.externalSiteId !== "string" || !ref.externalSiteId) return null;
    if (typeof ref.externalEngineId !== "string" && typeof ref.externalEngineId !== "number") return null;
    if (ref.externalEngineId === "") return null;
    refs.push({ externalSiteId: ref.externalSiteId, externalEngineId: String(ref.externalEngineId) });
  }
  return refs;
}

type Db = Pick<PrismaClient, "externalRankEngine" | "$transaction">;

type EngineRow = {
  id: string;
  source: string;
  externalSiteId: string;
  externalEngineId: string;
  host: string;
  engine: string;
  region: string;
  device: string;
  label: string;
  lastSyncedAt: Date | null;
};

export function engineView(r: EngineRow): LinkedEngine {
  const base = engineLabel(r);
  return {
    id: r.id,
    source: r.source,
    sourceName: sourceName(r.source),
    synced: getRankProvider(r.source) !== undefined,
    externalSiteId: r.externalSiteId,
    externalEngineId: r.externalEngineId,
    host: r.host,
    engine: r.engine,
    region: r.region,
    device: r.device,
    userLabel: r.label,
    label: r.label ? `${base} · ${r.label}` : base,
    matchKey: matchKey(r),
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  };
}

/** The site's engines, oldest first; `source` limits them to one source. */
export async function linkedEngines(
  db: Pick<PrismaClient, "externalRankEngine">,
  siteId: string,
  opts: { source?: string } = {}
): Promise<LinkedEngine[]> {
  const rows = await db.externalRankEngine.findMany({
    where: { siteId, ...(opts.source && { source: opts.source }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(engineView);
}

/**
 * Makes `wanted` the site's engines of one provider. Every one must be in
 * `available` (the account's projects, just read from the provider), which is
 * also where the labels come from. An engine left out is unlinked and its
 * stored positions are deleted with it. Returns how many engines are new:
 * those need a sync.
 */
export async function setLinkedEngines(
  db: Db,
  siteId: string,
  source: string,
  wanted: EngineRef[],
  available: RankProjectWithEngines[]
): Promise<{ added: number; removed: number }> {
  const provider = getRankProvider(source);
  if (!provider) throw new RankLinkError(`Unknown rank provider: ${source}`);
  const byKey = new Map<string, { project: RankProjectWithEngines; engine: RankProjectWithEngines["engines"][number] }>();
  for (const project of available) {
    for (const engine of project.engines) byKey.set(`${project.externalSiteId}:${engine.externalEngineId}`, { project, engine });
  }
  const keys = [...new Set(wanted.map((w) => `${w.externalSiteId}:${w.externalEngineId}`))];
  for (const key of keys) {
    if (!byKey.has(key)) throw new RankLinkError(`This ${provider.name} account has no such project and search engine`);
  }

  return db.$transaction(async (tx) => {
    const current = await tx.externalRankEngine.findMany({
      where: { siteId, source },
      select: { id: true, externalSiteId: true, externalEngineId: true },
    });
    const keep = new Set(keys);
    const stale = current.filter((c) => !keep.has(`${c.externalSiteId}:${c.externalEngineId}`));
    if (stale.length) await tx.externalRankEngine.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

    let added = 0;
    for (const key of keys) {
      const { project, engine } = byKey.get(key)!;
      const labels = { host: project.host || project.title, engine: engine.engine, region: engine.region, device: engine.device };
      const ref = { siteId, source, externalSiteId: project.externalSiteId, externalEngineId: engine.externalEngineId };
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
