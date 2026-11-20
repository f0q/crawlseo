import { db } from "@/lib/db";
import { ApiError, intParam } from "@/lib/api-v1/params";
import type { Site } from "@/lib/api-v1/handlers";
import { parseDay } from "./common";
import { linkedEngines, type LinkedEngine } from "./links";
import { ensureManualEngine, ManualRankError, writeManualRows } from "./manual";
import { positionsReport } from "./report";
import { pushBatchSchema, zodMessage } from "./rows";

/*
 * Rank tracking under /api/v1 (agency fork), the same for every source:
 *
 * GET  /api/v1/sites/{siteId}/rank-engines   every engine with its source and check range
 * GET  /api/v1/sites/{siteId}/positions      ?engine=&source=&date=&from=&to=&limit=&checks=
 * POST /api/v1/sites/{siteId}/positions      a batch of rows of one source and engine (write-scoped key)
 */

const engineJson = (e: LinkedEngine) => ({
  id: e.id,
  source: e.source,
  sourceName: e.sourceName,
  synced: e.synced,
  label: e.label,
  userLabel: e.userLabel,
  host: e.host,
  engine: e.engine,
  region: e.region,
  device: e.device,
  matchKey: e.matchKey,
  externalSiteId: e.externalSiteId,
  externalEngineId: e.externalEngineId,
  lastSyncedAt: e.lastSyncedAt,
});

export async function rankEngines(site: Site, params: URLSearchParams) {
  const source = params.get("source") || undefined;
  const engines = await linkedEngines(db, site.id, { source });
  const checks = engines.length
    ? await db.externalRank.groupBy({
        by: ["engineId"],
        where: { engineId: { in: engines.map((e) => e.id) } },
        _min: { date: true },
        _max: { date: true },
      })
    : [];
  const byEngine = new Map(checks.map((c) => [c.engineId, c]));
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    site,
    engines: engines.map((e) => ({
      ...engineJson(e),
      firstCheck: day(byEngine.get(e.id)?._min.date),
      latestCheck: day(byEngine.get(e.id)?._max.date),
    })),
  };
}

function dayParam(params: URLSearchParams, name: string): string | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const day = parseDay(raw);
  if (!day) throw new ApiError(400, `${name} must be YYYY-MM-DD`);
  return day;
}

/**
 * One engine's keywords on a check (the latest in from..to by default)
 * against the check before it, the top 3/10/30 and not-ranked counts of both,
 * and those counts over the last `checks` checks. `engine` is the engine's id
 * here or its provider engine id; `source` narrows the engines. The first
 * engine by default.
 */
export async function positions(site: Site, params: URLSearchParams) {
  const source = params.get("source") || undefined;
  const engines = await linkedEngines(db, site.id, { source });
  if (engines.length === 0) {
    throw new ApiError(404, source ? `This site has no rank engine of source ${source}` : "This site has no rank engine");
  }
  const wanted = params.get("engine");
  const engine = wanted ? engines.find((e) => e.id === wanted || e.externalEngineId === wanted) : engines[0];
  if (!engine) throw new ApiError(404, "No such rank engine on this site");

  const date = dayParam(params, "date");
  const from = dayParam(params, "from");
  const to = dayParam(params, "to");
  if (from && to && from > to) throw new ApiError(400, "from is after to");
  const limit = intParam(params, "limit", 1000, 1, 10_000);
  const checks = intParam(params, "checks", 30, 1, 400);

  const report = await positionsReport(db, engine.id, { date, from, to, trendChecks: checks });
  if (date && report.date === null) throw new ApiError(404, `No check on ${date} for this engine`);
  return {
    site,
    engine: engineJson(engine),
    engines: engines.map(engineJson),
    date: report.date,
    previousDate: report.previousDate,
    dates: report.dates,
    summary: report.summary,
    totalKeywords: report.keywords.length,
    keywords: [...report.keywords]
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.keyword.localeCompare(b.keyword))
      .slice(0, limit),
    trend: report.trend,
  };
}

/** Bodies above this are refused before parsing: 5000 rows of long keywords and URLs fit. */
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;

/**
 * Writes a batch of positions of one source and engine. Idempotent: a keyword
 * on a day is replaced, so a retried request leaves the same rows.
 */
export async function pushPositions(site: Site, body: unknown) {
  const parsed = pushBatchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
  const batch = parsed.data;
  try {
    const engine = await ensureManualEngine(db, site, batch);
    const written = await writeManualRows(db, engine.id, batch.rows);
    return {
      engineId: engine.id,
      engineCreated: engine.created,
      source: batch.source,
      rowsReceived: batch.rows.length,
      rowsWritten: written.rowsWritten,
      dates: written.dates,
    };
  } catch (err) {
    if (err instanceof ManualRankError) throw new ApiError(err.status, err.message);
    throw err;
  }
}
