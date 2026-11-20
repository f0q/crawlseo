import { db } from "@/lib/db";
import { ApiError, intParam } from "@/lib/api-v1/params";
import type { Site } from "@/lib/api-v1/handlers";
import { parseLabrikaDay } from "./labrika-parse";
import { linkedEngines, type LinkedEngine } from "./links";
import { positionsReport } from "./report";

/*
 * The Labrika endpoints of /api/v1 (agency fork), read only like the rest:
 *
 * GET /api/v1/sites/{siteId}/labrika/engines     the linked engines with their check dates
 * GET /api/v1/sites/{siteId}/labrika/positions   ?engine=&date=&limit=&checks=
 */

/** The site's engines, or 404 when none is linked. */
async function enginesOf(site: Site): Promise<LinkedEngine[]> {
  const engines = await linkedEngines(db, site.id);
  if (engines.length === 0) throw new ApiError(404, "This site has no Labrika search engine linked");
  return engines;
}

const engineView = (e: LinkedEngine) => ({
  id: e.id,
  label: e.label,
  host: e.host,
  engine: e.engine,
  region: e.region,
  device: e.device,
  labrikaSiteId: e.externalSiteId,
  labrikaEngineId: e.externalEngineId,
  lastSyncedAt: e.lastSyncedAt,
});

export async function labrikaEngines(site: Site) {
  const engines = await enginesOf(site);
  const checks = await db.externalRank.groupBy({
    by: ["engineId"],
    where: { engineId: { in: engines.map((e) => e.id) } },
    _min: { date: true },
    _max: { date: true },
  });
  const byEngine = new Map(checks.map((c) => [c.engineId, c]));
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    site,
    engines: engines.map((e) => ({
      ...engineView(e),
      firstCheck: day(byEngine.get(e.id)?._min.date),
      latestCheck: day(byEngine.get(e.id)?._max.date),
    })),
  };
}

/**
 * One engine's keywords on a check (the latest by default) against the check
 * before it, the top 3/10/30 and not-ranked counts of both, and those counts
 * over the last `checks` checks. `engine` is the engine's id here or its
 * Labrika engine id; the first linked engine by default.
 */
export async function labrikaPositions(site: Site, params: URLSearchParams) {
  const engines = await enginesOf(site);
  const wanted = params.get("engine");
  const engine = wanted
    ? engines.find((e) => e.id === wanted || e.externalEngineId === wanted)
    : engines[0];
  if (!engine) throw new ApiError(404, "No such Labrika engine on this site");

  const rawDate = params.get("date");
  const date = rawDate ? parseLabrikaDay(rawDate) : undefined;
  if (rawDate && !date) throw new ApiError(400, "date must be YYYY-MM-DD");
  const limit = intParam(params, "limit", 1000, 1, 10_000);
  const checks = intParam(params, "checks", 30, 1, 400);

  const report = await positionsReport(db, engine.id, { date: date ?? undefined, trendChecks: checks });
  if (date && report.date === null) throw new ApiError(404, `No check on ${date} for this engine`);
  return {
    site,
    engine: engineView(engine),
    engines: engines.map(engineView),
    date: report.date,
    previousDate: report.previousDate,
    summary: report.summary,
    totalKeywords: report.keywords.length,
    keywords: [...report.keywords]
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.keyword.localeCompare(b.keyword))
      .slice(0, limit),
    trend: report.trend,
  };
}
