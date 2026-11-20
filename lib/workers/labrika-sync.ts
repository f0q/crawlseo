import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createLabrikaClient,
  getLabrikaApiKey,
  LABRIKA_MAX_DATES_PER_REQUEST,
  LABRIKA_SOURCE,
  LabrikaApiError,
  type LabrikaClient,
  type LabrikaKeywordRow,
} from "@/lib/labrika";
// Check days go through gscDate, the one day-to-UTC-midnight conversion, so a
// Labrika row and a GSC row for the same day carry the same timestamp.
import { gscDate } from "@/lib/google/gsc-date";


/** Rows per createMany, well under Postgres' 65535 bind parameters (8 columns a row). */
const INSERT_BATCH = 2_000;

export interface LabrikaSyncResult {
  engines: number;
  datesFetched: number;
  rowsWritten: number;
  /** Engines that failed while the others were written: "label: reason". */
  failed?: string[];
}

/** Every engine failed; `permanent` when no retry can help (key, subscription, project gone). */
export class LabrikaSyncError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean
  ) {
    super(message);
    this.name = "LabrikaSyncError";
  }
}

type Engine = { id: string; externalSiteId: string; externalEngineId: string; engine: string; region: string };

/**
 * The days to download for one engine: every check date Labrika has that is
 * not stored yet, plus the newest stored one again. A check can still be
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

/** One row per keyword and check day the API returned; a day without an entry gets no row. */
export function rankRows(engineId: string, rows: LabrikaKeywordRow[], days: string[]): Prisma.ExternalRankCreateManyInput[] {
  const wanted = new Set(days);
  const out: Prisma.ExternalRankCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const check of row.checks) {
      if (!wanted.has(check.date)) continue;
      // The unique key is (engine, keyword, date): a keyword listed twice is written once.
      const key = `${row.keyword}\u0000${check.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        engineId,
        keyword: row.keyword,
        date: gscDate(check.date),
        position: check.position,
        url: check.url,
        frequency: row.frequency,
        frequencyExact: row.frequencyExact,
      });
    }
  }
  return out;
}

async function storedDays(db: PrismaClient, engineId: string): Promise<string[]> {
  const rows = await db.externalRank.groupBy({ by: ["date"], where: { engineId } });
  return rows.map((r) => r.date.toISOString().slice(0, 10));
}

/**
 * Downloads one engine's new check days, a batch of days per request, and
 * replaces those days' rows: delete and insert in one transaction per batch,
 * so a rerun writes the same rows and a failed batch leaves the earlier ones.
 */
async function syncEngine(db: PrismaClient, client: LabrikaClient, engine: Engine) {
  const available = await client.listDates(engine.externalSiteId, engine.externalEngineId);
  const days = daysToFetch(available, await storedDays(db, engine.id));
  let rowsWritten = 0;

  for (const batch of chunk(days, LABRIKA_MAX_DATES_PER_REQUEST)) {
    const rows = rankRows(engine.id, await client.positions(engine.externalSiteId, engine.externalEngineId, batch), batch);
    await db.$transaction(
      async (tx) => {
        await tx.externalRank.deleteMany({ where: { engineId: engine.id, date: { in: batch.map(gscDate) } } });
        for (const part of chunk(rows, INSERT_BATCH)) {
          await tx.externalRank.createMany({ data: part, skipDuplicates: true });
        }
      },
      { timeout: 60_000 }
    );
    rowsWritten += rows.length;
  }

  // updateMany: an engine unlinked meanwhile is simply not stamped.
  await db.externalRankEngine.updateMany({ where: { id: engine.id }, data: { lastSyncedAt: new Date() } });
  return { datesFetched: days.length, rowsWritten };
}

/**
 * Syncs every Labrika engine linked to the site. The first sync of an engine
 * backfills every check date Labrika has; later ones fetch only new dates.
 * One engine failing does not stop the others; when all fail it throws.
 */
export async function syncLabrikaForSite(
  db: PrismaClient,
  siteId: string,
  opts: { client?: LabrikaClient } = {}
): Promise<LabrikaSyncResult> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, rankEngines: { where: { source: LABRIKA_SOURCE }, orderBy: { createdAt: "asc" } } },
  });
  if (!site) throw new LabrikaSyncError("Site not found", true);
  if (site.rankEngines.length === 0) throw new LabrikaSyncError("No Labrika search engine is linked to this site", true);

  const client = opts.client ?? createLabrikaClient(await getLabrikaApiKey(site.userId));
  const result: LabrikaSyncResult = { engines: 0, datesFetched: 0, rowsWritten: 0 };
  const failed: { label: string; error: unknown }[] = [];

  for (const engine of site.rankEngines) {
    try {
      const done = await syncEngine(db, client, engine);
      result.engines++;
      result.datesFetched += done.datesFetched;
      result.rowsWritten += done.rowsWritten;
    } catch (error) {
      console.error(`[Labrika Sync] ${siteId} engine ${engine.externalEngineId}:`, error instanceof Error ? error.message : error);
      failed.push({ label: `${engine.engine}, ${engine.region}`, error });
    }
  }

  const reasons = failed.map(({ label, error }) => `${label}: ${error instanceof Error ? error.message : String(error)}`);
  if (result.engines === 0) {
    const permanent = failed.every(({ error }) => error instanceof LabrikaApiError && error.permanent);
    throw new LabrikaSyncError(reasons.join("; ") || "Labrika sync failed", permanent);
  }
  console.log(
    `[Labrika Sync] ${siteId}: ${result.engines} engine(s), ${result.datesFetched} date(s), ${result.rowsWritten} row(s)`
  );
  return failed.length ? { ...result, failed: reasons } : result;
}
