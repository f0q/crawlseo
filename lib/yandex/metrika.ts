import { YandexApiError, yandexGetJson, type YandexHttpOptions } from "./http";

/*
 * Yandex Metrika, read only (agency fork): the Management API for counters and
 * goals, the Reporting API (/stat/v1/data) for daily visits, sources, search
 * engines and goal reaches. See docs/agency/yandex.md.
 */

export const METRIKA_API_BASE = "https://api-metrika.yandex.net";

/** Metrika allows a few requests a second per user and per IP; this stays well under. */
const MIN_GAP_MS = 120;
/** Rows per Reporting API page (the API takes up to 100000). */
export const STAT_PAGE_SIZE = 10_000;
/** Metrics per Reporting API request: Metrika takes at most 20. */
export const MAX_METRICS = 20;
/** Counters per Management API page. */
const COUNTERS_PAGE = 1_000;

export type MetrikaCounter = { id: string; name: string; site: string; status: string; permission: string };
export type MetrikaGoal = { id: string; name: string; type: string };

/** One row of a report: dimension ids/names and the metric values in the order asked. */
export type StatRow = { dimensions: { id: string | null; name: string | null }[]; metrics: (number | null)[] };

export const VISIT_METRICS = [
  "ym:s:visits",
  "ym:s:users",
  "ym:s:bounceRate",
  "ym:s:pageDepth",
  "ym:s:avgVisitDurationSeconds",
] as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const idOf = (v: unknown): string | null => (typeof v === "number" || (typeof v === "string" && v) ? String(v) : null);

export function parseCounters(body: unknown): { counters: MetrikaCounter[]; rows: number | null } {
  const b = (body ?? {}) as { counters?: unknown; rows?: unknown };
  if (!Array.isArray(b.counters)) throw new YandexApiError(200, "invalid_response", "Metrika counters: unexpected answer");
  return {
    rows: num(b.rows),
    counters: (b.counters as Record<string, unknown>[])
      .map((c) => ({
        id: idOf(c.id) ?? "",
        name: typeof c.name === "string" ? c.name : "",
        site:
          typeof (c.site2 as Record<string, unknown> | undefined)?.site === "string"
            ? String((c.site2 as Record<string, unknown>).site)
            : typeof c.site === "string"
              ? c.site
              : "",
        status: typeof c.status === "string" ? c.status : "",
        permission: typeof c.permission === "string" ? c.permission : "",
      }))
      .filter((c) => c.id),
  };
}

export function parseGoals(body: unknown): MetrikaGoal[] {
  const goals = (body as { goals?: unknown })?.goals;
  if (!Array.isArray(goals)) throw new YandexApiError(200, "invalid_response", "Metrika goals: unexpected answer");
  return (goals as Record<string, unknown>[])
    .map((g) => ({ id: idOf(g.id) ?? "", name: typeof g.name === "string" ? g.name : "", type: typeof g.type === "string" ? g.type : "" }))
    .filter((g) => g.id);
}

export function parseStat(body: unknown): { rows: StatRow[]; totalRows: number | null; sampled: boolean } {
  const b = (body ?? {}) as { data?: unknown; total_rows?: unknown; sampled?: unknown };
  if (!Array.isArray(b.data)) throw new YandexApiError(200, "invalid_response", "Metrika report: unexpected answer");
  return {
    totalRows: num(b.total_rows),
    sampled: b.sampled === true,
    rows: (b.data as Record<string, unknown>[]).map((r) => ({
      dimensions: (Array.isArray(r.dimensions) ? (r.dimensions as Record<string, unknown>[]) : []).map((d) => ({
        id: idOf(d?.id),
        name: typeof d?.name === "string" ? d.name : null,
      })),
      metrics: (Array.isArray(r.metrics) ? r.metrics : []).map(num),
    })),
  };
}

export type StatQuery = {
  counterId: string;
  metrics: readonly string[];
  dimensions: readonly string[];
  /** YYYY-MM-DD, both included. */
  date1: string;
  date2: string;
  filters?: string;
};

export type MetrikaClient = ReturnType<typeof createMetrikaClient>;

export function createMetrikaClient(token: string, opts: YandexHttpOptions = {}) {
  const get = (path: string, params: [string, string][] = []) => {
    const query = params.length ? `?${new URLSearchParams(params)}` : "";
    return yandexGetJson({ service: "Metrika", token, url: `${METRIKA_API_BASE}${path}${query}`, defaultGapMs: MIN_GAP_MS }, opts);
  };

  return {
    /** Every counter the account can read. */
    async counters(): Promise<MetrikaCounter[]> {
      const out: MetrikaCounter[] = [];
      // offset is 1-based in the Management API.
      for (let offset = 1, page = 0; page < 100; page++) {
        const { counters, rows } = parseCounters(
          await get("/management/v1/counters", [["per_page", String(COUNTERS_PAGE)], ["offset", String(offset)]])
        );
        out.push(...counters);
        offset += counters.length;
        if (counters.length < COUNTERS_PAGE || (rows !== null && out.length >= rows)) break;
      }
      return out;
    },
    async goals(counterId: string): Promise<MetrikaGoal[]> {
      return parseGoals(await get(`/management/v1/counter/${encodeURIComponent(counterId)}/goals`));
    },
    /** Every row of a Reporting API table, page by page. */
    async stat(q: StatQuery): Promise<StatRow[]> {
      if (q.metrics.length === 0 || q.metrics.length > MAX_METRICS) throw new Error(`1 to ${MAX_METRICS} metrics per request`);
      const out: StatRow[] = [];
      // offset is 1-based in the Reporting API too.
      for (let offset = 1, page = 0; page < 100; page++) {
        const { rows, totalRows } = parseStat(
          await get("/stat/v1/data", [
            ["ids", q.counterId],
            ["metrics", q.metrics.join(",")],
            ["dimensions", q.dimensions.join(",")],
            ["date1", q.date1],
            ["date2", q.date2],
            ["accuracy", "full"],
            ["limit", String(STAT_PAGE_SIZE)],
            ["offset", String(offset)],
            ...(q.filters ? ([["filters", q.filters]] as [string, string][]) : []),
          ])
        );
        out.push(...rows);
        offset += rows.length;
        if (rows.length < STAT_PAGE_SIZE || (totalRows !== null && out.length >= totalRows)) break;
      }
      return out;
    },
  };
}
