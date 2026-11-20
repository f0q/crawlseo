import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLabrikaClient, LabrikaApiError, retryAfterMs, testLabrikaKey } from "./client";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

/** A fetch that answers each call with the next response and records the URLs. */
function answers(...responses: (() => Response)[]) {
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error("no more answers");
    return next();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, urls };
}

const json = (body: unknown, init: ResponseInit = {}) => () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), init);

function client(fetch: typeof globalThis.fetch, sleeps: number[] = []) {
  return createLabrikaClient("key", { fetch, minGapMs: 0, sleep: async (ms) => void sleeps.push(ms) });
}

afterEach(() => vi.clearAllMocks());

describe("pagination", () => {
  it("follows next_offset until has_more is false", async () => {
    const second = { data: [], pagination: { has_more: false, next_offset: null } };
    const { fetch, urls } = answers(json(fixture("sites.json")), json(second));
    const sites = await client(fetch).listSites();
    expect(sites).toHaveLength(2);
    expect(urls[0]).toBe("https://labrika.ru/public-api/v1/serp/sites?limit=100&offset=0");
    expect(urls[1]).toContain("offset=2");
  });

  it("sends one collected_at per day, or last without days", async () => {
    const { fetch, urls } = answers(json(fixture("positions.json")), json(fixture("positions.json")));
    const rows = await client(fetch).positions("uuid", "41310", ["2026-11-11", "2026-11-18"]);
    expect(rows).toHaveLength(2);
    expect(urls[0]).toContain("/serp/sites/uuid/search-engines/41310/positions?");
    expect(urls[0]).toContain("collected_at=2026-11-11T00%3A00%3A00Z&collected_at=2026-11-18T00%3A00%3A00Z");
    await client(fetch).positions("uuid", "41310");
    expect(urls[1]).toContain("collected_at=last");
  });

  it("lists check dates oldest first", async () => {
    const { fetch } = answers(json(fixture("dates.json")));
    expect(await client(fetch).listDates("uuid", "41310")).toEqual(["2026-11-11", "2026-11-18"]);
  });
});

describe("rate limits and errors", () => {
  it("waits out a 429 for Retry-After and tries again", async () => {
    const sleeps: number[] = [];
    const { fetch } = answers(
      json({ error: { code: "rate_limited", message: "slow down" } }, { status: 429, headers: { "Retry-After": "7" } }),
      json(fixture("dates.json"))
    );
    expect(await client(fetch, sleeps).listDates("uuid", "1")).toHaveLength(2);
    expect(sleeps).toEqual([7_000]);
  });

  it("retries a 5xx with backoff, then gives up with the status", async () => {
    const sleeps: number[] = [];
    const fail = json("<html>bad gateway</html>", { status: 502 });
    const { fetch } = answers(fail, fail, fail, fail);
    const err = await client(fetch, sleeps).listSites().catch((e) => e);
    expect(err).toBeInstanceOf(LabrikaApiError);
    expect(err.status).toBe(502);
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);
  });

  it("does not retry a missing subscription, and calls it permanent", async () => {
    const { fetch } = answers(json(fixture("error-subscription.json"), { status: 403 }));
    const err = await client(fetch).positions("uuid", "1").catch((e) => e);
    expect(err).toBeInstanceOf(LabrikaApiError);
    expect(err.code).toBe("serp_subscription_required");
    expect(err.permanent).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("reads the wait from X-Ratelimit-Reset when there is no Retry-After", () => {
    const headers = new Headers({ "X-Ratelimit-Reset": "1000" });
    expect(retryAfterMs(headers, 990_000)).toBe(10_000);
    expect(retryAfterMs(new Headers())).toBeNull();
  });

  it("tests a key with one request and answers false for a refused one", async () => {
    const ok = answers(json(fixture("sites.json")));
    expect(await testLabrikaKey("k", { fetch: ok.fetch, minGapMs: 0 })).toBe(true);
    expect(ok.urls).toHaveLength(1);
    const refused = answers(json({ error: { code: "unauthorized", message: "bad key" } }, { status: 401 }));
    expect(await testLabrikaKey("k", { fetch: refused.fetch, minGapMs: 0 })).toBe(false);
  });
});
