import { RankProviderError, type RankProviderClientOptions } from "../types";
import {
  labrikaCollectedAt,
  parseDatesPage,
  parseLabrikaError,
  parsePositionsPage,
  parseSitesPage,
  type LabrikaKeywordRow,
  type LabrikaPage,
  type LabrikaSite,
} from "./parse";

/*
 * The Labrika Public API, read only: the user's rank tracking projects, their
 * check dates and the positions per keyword. Projects, keywords, regions and
 * checks are set up in Labrika itself; the API cannot change them.
 */

const LABRIKA_API_BASE = "https://labrika.ru/public-api/v1";

/** The API pages lists by at most 100. */
export const LABRIKA_PAGE_SIZE = 100;
/** collected_at takes up to 51 dates per request. */
export const LABRIKA_MAX_DATES_PER_REQUEST = 50;

const REQUEST_TIMEOUT_MS = 20_000;
/** Labrika allows 60 requests a minute per key; one a little over a second apart stays under it. */
const MIN_GAP_MS = 1_050;
/** Attempts per request: a 429, a 5xx or a network error is tried again. */
const MAX_ATTEMPTS = 4;
/** Longest wait for a Retry-After or a backoff, so a wrong header cannot stall a job. */
const MAX_WAIT_MS = 65_000;

/** Labrika refused the request. `status` 0: no answer (network error or timeout). */
export class LabrikaApiError extends RankProviderError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "LabrikaApiError";
  }
}

export type LabrikaClientOptions = RankProviderClientOptions;

/** One schedule for the whole process: two syncs at once must share the key's per-minute budget. */
const pacing = globalThis as unknown as { crawlseoLabrikaNextAt?: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long a 429 asks to wait: Retry-After (seconds), else until X-Ratelimit-Reset (epoch seconds). */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const after = Number(headers.get("retry-after"));
  if (headers.get("retry-after") !== null && Number.isFinite(after) && after >= 0) return after * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-reset") !== null && Number.isFinite(reset) && reset > 0) {
    return Math.max(0, reset * 1000 - now);
  }
  return null;
}

export type LabrikaClient = ReturnType<typeof createLabrikaClient>;

export function createLabrikaClient(apiKey: string, opts: LabrikaClientOptions = {}) {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const minGapMs = opts.minGapMs ?? MIN_GAP_MS;

  async function paced(): Promise<void> {
    if (minGapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, pacing.crawlseoLabrikaNextAt ?? 0);
    pacing.crawlseoLabrikaNextAt = at + minGapMs;
    if (at > now) await sleep(at - now);
  }

  async function get(path: string, params: [string, string][]): Promise<unknown> {
    const query = new URLSearchParams(params);
    const url = `${LABRIKA_API_BASE}${path}?${query}`;
    let lastError: LabrikaApiError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await paced();
      let response: Response;
      let text: string;
      try {
        response = await doFetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        text = await response.text();
      } catch (err) {
        lastError = new LabrikaApiError(0, "network", `Labrika did not answer: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt < MAX_ATTEMPTS) await sleep(Math.min(MAX_WAIT_MS, 2_000 * 2 ** (attempt - 1)));
        continue;
      }

      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // a proxy error page: reported with its status below
      }
      if (response.ok) {
        if (body === null) throw new LabrikaApiError(response.status, "invalid_json", "Labrika answered with something other than JSON");
        return body;
      }

      const detail = parseLabrikaError(body);
      lastError = new LabrikaApiError(
        response.status,
        detail?.code ?? `http_${response.status}`,
        `Labrika ${path} failed: ${response.status}${detail ? ` ${detail.code}: ${detail.message}` : ` ${text.slice(0, 200)}`}`
      );
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
      const wait =
        response.status === 429
          ? (retryAfterMs(response.headers) ?? 60_000)
          : 2_000 * 2 ** (attempt - 1);
      await sleep(Math.min(MAX_WAIT_MS, wait));
    }
    throw lastError ?? new LabrikaApiError(0, "network", "Labrika did not answer");
  }

  /** Every page of a list, following pagination.next_offset. */
  async function all<T>(
    path: string,
    params: [string, string][],
    parse: (body: unknown) => LabrikaPage<T>
  ): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    // A bound on pages, so an API that keeps answering has_more cannot loop forever.
    for (let pageNo = 0; pageNo < 1_000; pageNo++) {
      const { items, nextOffset } = parse(
        await get(path, [...params, ["limit", String(LABRIKA_PAGE_SIZE)], ["offset", String(offset)]])
      );
      out.push(...items);
      if (nextOffset === null || nextOffset <= offset) return out;
      offset = nextOffset;
    }
    return out;
  }

  const enginePath = (siteUuid: string, engineId: string) =>
    `/serp/sites/${encodeURIComponent(siteUuid)}/search-engines/${encodeURIComponent(engineId)}`;

  return {
    /** Every rank tracking project of the account, with its search engines. */
    listSites(): Promise<LabrikaSite[]> {
      return all("/serp/sites", [], parseSitesPage);
    },

    /** One request, the cheapest that needs a valid key: the connection test. */
    async ping(): Promise<void> {
      parseSitesPage(await get("/serp/sites", [["limit", "1"], ["offset", "0"]]));
    },

    /** The engine's check dates, oldest first. */
    async listDates(siteUuid: string, engineId: string): Promise<string[]> {
      const days = await all(`${enginePath(siteUuid, engineId)}/dates`, [], parseDatesPage);
      return [...new Set(days)].sort();
    },

    /**
     * Every keyword with its checks on the given days (at most
     * LABRIKA_MAX_DATES_PER_REQUEST), or on the latest check without days.
     */
    positions(siteUuid: string, engineId: string, days: string[] = []): Promise<LabrikaKeywordRow[]> {
      if (days.length > LABRIKA_MAX_DATES_PER_REQUEST) {
        throw new Error(`At most ${LABRIKA_MAX_DATES_PER_REQUEST} dates per request`);
      }
      const collectedAt: [string, string][] = days.length
        ? days.map((day) => ["collected_at", labrikaCollectedAt(day)])
        : [["collected_at", "last"]];
      return all(`${enginePath(siteUuid, engineId)}/positions`, collectedAt, parsePositionsPage);
    },
  };
}

/** Whether a key can read rank tracking projects. */
export async function testLabrikaKey(apiKey: string, opts?: LabrikaClientOptions): Promise<boolean> {
  try {
    await createLabrikaClient(apiKey, opts).ping();
    return true;
  } catch {
    return false;
  }
}
