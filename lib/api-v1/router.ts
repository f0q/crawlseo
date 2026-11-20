import type { KeyOwner } from "@/lib/access-keys";
import { apiRateLimitPerMinute, RateLimiter } from "@/lib/rate-limit";
import { checkKey } from "./auth";
import * as read from "./handlers";
import { MAX_PUSH_BYTES, positions, pushPositions, rankEngines } from "@/lib/rank-providers/api-v1";
import { ApiError } from "./params";

/*
 * The API under /api/v1, for the MCP server and scripts. Every request
 * carries an access key (Authorization: Bearer <key>) of a user with MCP
 * turned on in Settings > MCP, and reads the data of that user only. Every
 * route is GET and writes, queues or triggers nothing, except one write
 * (agency fork): POST .../positions, only with a key of the "write" scope.
 *
 * GET /api/v1/key                                  the key in use: name and prefix
 * GET /api/v1/sites
 * GET /api/v1/sites/{siteId}                       overview: last 28 days, latest crawl and vitals
 * GET /api/v1/sites/{siteId}/keywords              ?days= or ?startDate=&endDate=, &limit=
 * GET /api/v1/sites/{siteId}/pages                 the same
 * GET /api/v1/sites/{siteId}/traffic               daily clicks and impressions, the same period
 * GET /api/v1/sites/{siteId}/crawls                ?limit=
 * GET /api/v1/sites/{siteId}/crawls/{id}/issues    id or "latest", ?severity=&limit=
 * GET /api/v1/sites/{siteId}/vitals                ?device=&limit=
 * GET /api/v1/sites/{siteId}/opportunities
 * GET /api/v1/sites/{siteId}/bing/traffic          Bing daily rows, ?days= or ?startDate=&endDate=
 * GET /api/v1/sites/{siteId}/bing/keywords         Bing weekly queries summed over the period, &limit=
 * GET /api/v1/sites/{siteId}/bing/pages            the same for pages
 * GET /api/v1/sites/{siteId}/saved-keywords       saved keywords with their totals, ?days= or ?startDate=&endDate=
 * GET /api/v1/sites/{siteId}/rank-engines         agency fork: rank engines of every source, ?source= (lib/rank-providers/api-v1.ts)
 * GET /api/v1/sites/{siteId}/positions            positions of an engine, ?engine=&source=&date=&from=&to=&limit=&checks=
 * POST /api/v1/sites/{siteId}/positions           write-scoped key: a batch of rows of one source and engine
 */

const PREFIX = "/api/v1/";

const holder = globalThis as unknown as { crawlseoApiRateLimiter?: RateLimiter };

function limiter(): RateLimiter {
  const limit = apiRateLimitPerMinute();
  if (holder.crawlseoApiRateLimiter?.limit !== limit) holder.crawlseoApiRateLimiter = new RateLimiter(limit);
  return holder.crawlseoApiRateLimiter;
}

export type RateCheck = { ok: boolean; headers: Record<string, string> };

/** Counts one request of the key against API_RATE_LIMIT_PER_MINUTE; /api/v1 and /mcp share the count. */
export function countKeyRequest(keyId: string): RateCheck {
  const rate = limiter().hit(keyId);
  const headers: Record<string, string> = { "X-RateLimit-Limit": String(rate.limit), "X-RateLimit-Remaining": String(rate.remaining) };
  if (!rate.ok) headers["Retry-After"] = String(rate.retryAfterS);
  return { ok: rate.ok, headers };
}

/** Writes per minute per key, on top of the shared count: each one can carry thousands of rows. */
export const WRITES_PER_MINUTE = 20;
const writes = globalThis as unknown as { crawlseoApiWriteLimiter?: RateLimiter };

function countWrite(keyId: string): RateCheck {
  writes.crawlseoApiWriteLimiter ??= new RateLimiter(WRITES_PER_MINUTE);
  const rate = writes.crawlseoApiWriteLimiter.hit(keyId);
  return rate.ok ? { ok: true, headers: {} } : { ok: false, headers: { "Retry-After": String(rate.retryAfterS) } };
}

export const READ_ONLY_KEY_MESSAGE =
  "This key is read-only. Create a key with the write scope in Settings > MCP to push positions.";

export const RATE_LIMITED_MESSAGE = "Too many requests for this key. Try again shortly.";

function segment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new ApiError(404, "Not found");
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function route(owner: KeyOwner, segments: string[], params: URLSearchParams): Promise<unknown> {
  const { userId } = owner;
  const [root, siteId, resource, crawlId, sub] = segments;
  if (root === "key" && segments.length === 1) return read.keyInfo(owner.keyId);
  if (root !== "sites") throw new ApiError(404, "Not found");
  if (segments.length === 1) return read.listSites(userId);

  const site = await read.ownSite(userId, siteId);
  if (segments.length === 2) return read.siteOverview(site);
  if (segments.length === 3) {
    switch (resource) {
      case "keywords":
        return read.keywords(site, params);
      case "pages":
        return read.pages(site, params);
      case "traffic":
        return read.traffic(site, params);
      case "crawls":
        return read.crawls(site, params);
      case "vitals":
        return read.vitals(site, params);
      case "opportunities":
        return read.opportunities(site);
      case "saved-keywords":
        return read.savedKeywords(site, params);
      case "rank-engines":
        return rankEngines(site, params);
      case "positions":
        return positions(site, params);
    }
  }
  if (segments.length === 4 && resource === "bing") {
    switch (segments[3]) {
      case "traffic":
        return read.bingTraffic(site, params);
      case "keywords":
        return read.bingKeywords(site, params);
      case "pages":
        return read.bingPages(site, params);
    }
  }
  if (segments.length === 5 && resource === "crawls" && sub === "issues") {
    return read.crawlIssues(site, crawlId, params);
  }
  throw new ApiError(404, "Not found");
}

/** The one write route: POST /api/v1/sites/{siteId}/positions. */
const isWritePath = (segments: string[]) => segments.length === 3 && segments[0] === "sites" && segments[2] === "positions";

async function readBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PUSH_BYTES) throw new ApiError(413, `The body is over ${MAX_PUSH_BYTES} bytes`);
  const text = await req.text();
  if (text.length > MAX_PUSH_BYTES) throw new ApiError(413, `The body is over ${MAX_PUSH_BYTES} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "The body must be JSON");
  }
}

async function write(owner: KeyOwner, segments: string[], req: Request): Promise<unknown> {
  const site = await read.ownSite(owner.userId, segments[1]);
  return pushPositions(site, await readBody(req));
}

/** Answers one /api/v1 request. Used by the route and, in-process, by the instance's MCP endpoint. */
export async function handleApiV1(req: Request, opts: { countRequest?: boolean } = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : "";
  const rawSegments = path.split("/").filter(Boolean);
  const writing = req.method === "POST" && isWritePath(rawSegments);
  if (req.method !== "GET" && !writing) {
    return json({ error: "Only GET, and POST to /sites/{siteId}/positions" }, 405, {
      Allow: isWritePath(rawSegments) ? "GET, POST" : "GET",
    });
  }

  try {
    const check = await checkKey(req);
    if (!check.ok) return json({ error: check.error }, check.status, check.headers);
    const { owner } = check;

    // A tool call from /mcp was counted there, as one request.
    const rate = opts.countRequest === false ? { ok: true, headers: {} } : countKeyRequest(owner.keyId);
    const rateHeaders = rate.headers;
    if (!rate.ok) return json({ error: RATE_LIMITED_MESSAGE }, 429, rateHeaders);

    const segments = rawSegments.map(segment);
    if (writing) {
      if (owner.scope !== "write") return json({ error: READ_ONLY_KEY_MESSAGE }, 403, rateHeaders);
      const w = countWrite(owner.keyId);
      if (!w.ok) return json({ error: RATE_LIMITED_MESSAGE }, 429, { ...rateHeaders, ...w.headers });
      return json(await write(owner, segments, req), 200, rateHeaders);
    }
    return json(await route(owner, segments, url.searchParams), 200, rateHeaders);
  } catch (err) {
    if (err instanceof ApiError) return json({ error: err.message }, err.status);
    console.error("[api/v1]", err);
    return json({ error: "Internal error" }, 500);
  }
}
