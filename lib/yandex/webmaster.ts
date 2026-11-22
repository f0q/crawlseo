import { YandexApiError, yandexGetJson, type YandexHttpOptions } from "./http";

/*
 * Yandex Webmaster API v4, read only (agency fork). Paths and fields follow
 * the official Webmaster documentation; docs/agency/yandex.md lists the
 * endpoints and what was checked. Hosts are added and verified in Webmaster itself.
 */

export const WEBMASTER_API_BASE = "https://api.webmaster.yandex.net/v4";

/** Webmaster limits requests per user; a little pacing keeps a sync of many sites polite. */
const MIN_GAP_MS = 250;
/** search-queries/popular returns at most 500 queries per page. */
export const POPULAR_PAGE_SIZE = 500;

export type WebmasterHost = {
  hostId: string;
  asciiUrl: string;
  unicodeUrl: string;
  verified: boolean;
  mainMirrorHostId: string | null;
};

export type WebmasterSummary = {
  sqi: number | null;
  searchablePages: number | null;
  excludedPages: number | null;
  problems: { fatal: number | null; critical: number | null; possible: number | null; recommendation: number | null };
};

/** One indicator value per day, YYYY-MM-DD. */
export type DayValue = { date: string; value: number };

export type IndexingHistory = { http2xx: DayValue[]; http3xx: DayValue[]; http4xx: DayValue[]; http5xx: DayValue[]; other: DayValue[] };

export type PopularQuery = {
  queryId: string | null;
  query: string;
  shows: number | null;
  clicks: number | null;
  avgShowPosition: number | null;
  avgClickPosition: number | null;
};

export type WebmasterProblem = { code: string; severity: string; state: string; lastStateUpdate: string | null };

export type WebmasterSitemap = {
  url: string;
  urlsCount: number | null;
  errorsCount: number | null;
  lastAccessDate: string | null;
  type: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A Webmaster timestamp ("2026-11-20T00:00:00.000+03:00") as the day it names, before any time zone shift. */
export function webmasterDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

/** A day as Webmaster takes it in date_from and date_to. */
export function webmasterDateParam(day: string): string {
  return `${day}T00:00:00.000Z`;
}

export function parseHosts(body: unknown): WebmasterHost[] {
  const hosts = (body as { hosts?: unknown })?.hosts;
  if (!Array.isArray(hosts)) throw new YandexApiError(200, "invalid_response", "Webmaster hosts: unexpected answer");
  return hosts
    .map((h: Record<string, unknown>) => ({
      hostId: str(h.host_id) ?? "",
      asciiUrl: str(h.ascii_host_url) ?? "",
      unicodeUrl: str(h.unicode_host_url) ?? str(h.ascii_host_url) ?? "",
      verified: h.verified === true,
      mainMirrorHostId: str((h.main_mirror as Record<string, unknown> | undefined)?.host_id),
    }))
    .filter((h) => h.hostId);
}

export function parseSummary(body: unknown): WebmasterSummary {
  const b = (body ?? {}) as Record<string, unknown>;
  const p = (b.site_problems ?? {}) as Record<string, unknown>;
  return {
    sqi: num(b.sqi),
    searchablePages: num(b.searchable_pages_count),
    excludedPages: num(b.excluded_pages_count),
    problems: {
      fatal: num(p.FATAL),
      critical: num(p.CRITICAL),
      possible: num(p.POSSIBLE_PROBLEM),
      recommendation: num(p.RECOMMENDATION),
    },
  };
}

/** [{date, value}] to one value per day; the last one wins when a day repeats. */
export function parsePoints(points: unknown): DayValue[] {
  if (!Array.isArray(points)) return [];
  const byDay = new Map<string, number>();
  for (const p of points as Record<string, unknown>[]) {
    const date = webmasterDay(p?.date);
    const value = num(p?.value);
    if (date && value !== null) byDay.set(date, value);
  }
  return [...byDay].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export function parseIndexingHistory(body: unknown): IndexingHistory {
  const i = ((body as { indicators?: unknown })?.indicators ?? {}) as Record<string, unknown>;
  return {
    http2xx: parsePoints(i.HTTP_2XX),
    http3xx: parsePoints(i.HTTP_3XX),
    http4xx: parsePoints(i.HTTP_4XX),
    http5xx: parsePoints(i.HTTP_5XX),
    other: parsePoints(i.OTHER),
  };
}

export function parsePopular(body: unknown): { queries: PopularQuery[]; count: number | null } {
  const b = (body ?? {}) as { queries?: unknown; count?: unknown };
  const queries = Array.isArray(b.queries) ? (b.queries as Record<string, unknown>[]) : [];
  return {
    // The docs type count as int32, their sample sends a string.
    count: num(typeof b.count === "string" ? Number(b.count) : b.count),
    queries: queries
      .map((q) => {
        const ind = (q.indicators ?? {}) as Record<string, unknown>;
        return {
          queryId: str(q.query_id),
          query: str(q.query_text) ?? "",
          shows: num(ind.TOTAL_SHOWS) === null ? null : Math.round(num(ind.TOTAL_SHOWS)!),
          clicks: num(ind.TOTAL_CLICKS) === null ? null : Math.round(num(ind.TOTAL_CLICKS)!),
          avgShowPosition: num(ind.AVG_SHOW_POSITION),
          avgClickPosition: num(ind.AVG_CLICK_POSITION),
        };
      })
      .filter((q) => q.query),
  };
}

export function parseDiagnostics(body: unknown): WebmasterProblem[] {
  const problems = ((body as { problems?: unknown })?.problems ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(problems).map(([code, p]) => ({
    code,
    severity: str(p?.severity) ?? "UNKNOWN",
    state: str(p?.state) ?? "UNKNOWN",
    lastStateUpdate: str(p?.last_state_update),
  }));
}

export function parseSitemaps(body: unknown): WebmasterSitemap[] {
  const list = (body as { sitemaps?: unknown })?.sitemaps;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[])
    .map((s) => ({
      url: str(s.sitemap_url) ?? "",
      urlsCount: num(s.urls_count),
      errorsCount: num(s.errors_count),
      lastAccessDate: str(s.last_access_date),
      type: str(s.sitemap_type),
    }))
    .filter((s) => s.url);
}

export type WebmasterClient = ReturnType<typeof createWebmasterClient>;

export function createWebmasterClient(token: string, opts: YandexHttpOptions = {}) {
  const get = (path: string, params: [string, string][] = []) => {
    const query = params.length ? `?${new URLSearchParams(params)}` : "";
    return yandexGetJson({ service: "Webmaster", token, url: `${WEBMASTER_API_BASE}${path}${query}`, defaultGapMs: MIN_GAP_MS }, opts);
  };
  const host = (userId: string, hostId: string) =>
    `/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}`;
  const range = (from: string, to: string): [string, string][] => [
    ["date_from", webmasterDateParam(from)],
    ["date_to", webmasterDateParam(to)],
  ];

  return {
    async userId(): Promise<string> {
      const body = (await get("/user")) as { user_id?: unknown };
      if (typeof body.user_id !== "number" && typeof body.user_id !== "string") {
        throw new YandexApiError(200, "invalid_response", "Webmaster user: no user_id");
      }
      return String(body.user_id);
    },
    async hosts(userId: string): Promise<WebmasterHost[]> {
      return parseHosts(await get(`/user/${encodeURIComponent(userId)}/hosts`));
    },
    async summary(userId: string, hostId: string): Promise<WebmasterSummary> {
      return parseSummary(await get(`${host(userId, hostId)}/summary`));
    },
    async indexingHistory(userId: string, hostId: string, from: string, to: string): Promise<IndexingHistory> {
      return parseIndexingHistory(await get(`${host(userId, hostId)}/indexing/history`, range(from, to)));
    },
    async searchableHistory(userId: string, hostId: string, from: string, to: string): Promise<DayValue[]> {
      return parsePoints(((await get(`${host(userId, hostId)}/search-urls/in-search/history`, range(from, to))) as { history?: unknown }).history);
    },
    async sqiHistory(userId: string, hostId: string, from: string, to: string): Promise<DayValue[]> {
      return parsePoints(((await get(`${host(userId, hostId)}/sqi-history`, range(from, to))) as { points?: unknown }).points);
    },
    /** The most shown queries of from..to (days), every page up to `max`. */
    async popularQueries(userId: string, hostId: string, from: string, to: string, max = POPULAR_PAGE_SIZE): Promise<PopularQuery[]> {
      const out: PopularQuery[] = [];
      for (let offset = 0; offset < max; offset += POPULAR_PAGE_SIZE) {
        const limit = Math.min(POPULAR_PAGE_SIZE, max - offset);
        const page = parsePopular(
          await get(`${host(userId, hostId)}/search-queries/popular`, [
            ["order_by", "TOTAL_SHOWS"],
            ["query_indicator", "TOTAL_SHOWS"],
            ["query_indicator", "TOTAL_CLICKS"],
            ["query_indicator", "AVG_SHOW_POSITION"],
            ["query_indicator", "AVG_CLICK_POSITION"],
            ...range(from, to),
            ["offset", String(offset)],
            ["limit", String(limit)],
          ])
        );
        out.push(...page.queries);
        if (page.queries.length < limit || (page.count !== null && offset + limit >= page.count)) break;
      }
      return out;
    },
    async diagnostics(userId: string, hostId: string): Promise<WebmasterProblem[]> {
      return parseDiagnostics(await get(`${host(userId, hostId)}/diagnostics`));
    },
    async sitemaps(userId: string, hostId: string): Promise<WebmasterSitemap[]> {
      return parseSitemaps(await get(`${host(userId, hostId)}/sitemaps`, [["limit", "100"]]));
    },
  };
}
