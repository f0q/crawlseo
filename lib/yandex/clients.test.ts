import { describe, expect, it } from "vitest";
import { fakeYandex, json } from "@/lib/testing/yandex-fake";
import { YandexApiError } from "./http";
import { createMetrikaClient, STAT_PAGE_SIZE } from "./metrika";
import { createWebmasterClient, parsePopular, parseSitemaps, webmasterDay } from "./webmaster";

const opts = (fetch: typeof globalThis.fetch, sleeps: number[] = []) => ({ fetch, minGapMs: 0, sleep: async (ms: number) => void sleeps.push(ms) });
const HOST = "https:quilltab.app:443";

describe("Webmaster client", () => {
  it("reads the user, the hosts and a host's summary with the OAuth header", async () => {
    const fake = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user": () => json({ user_id: 42 }),
      "GET api.webmaster.yandex.net/v4/user/42/hosts": () =>
        json({
          hosts: [
            { host_id: HOST, ascii_host_url: "https://quilltab.app/", unicode_host_url: "https://quilltab.app/", verified: true },
            { host_id: "http:old.example:80", ascii_host_url: "http://old.example/", verified: false, main_mirror: { host_id: HOST } },
          ],
        }),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/summary": () =>
        json({ sqi: 120, excluded_pages_count: 7, searchable_pages_count: 300, site_problems: { FATAL: 0, CRITICAL: 1, POSSIBLE_PROBLEM: 2, RECOMMENDATION: 3 } }),
    });
    const wm = createWebmasterClient("AT", opts(fake.fetch));
    expect(await wm.userId()).toBe("42");
    const hosts = await wm.hosts("42");
    expect(hosts.map((h) => [h.hostId, h.verified, h.mainMirrorHostId])).toEqual([
      [HOST, true, null],
      ["http:old.example:80", false, HOST],
    ]);
    expect(await wm.summary("42", HOST)).toEqual({
      sqi: 120,
      searchablePages: 300,
      excludedPages: 7,
      problems: { fatal: 0, critical: 1, possible: 2, recommendation: 3 },
    });
    expect(fake.calls.every((c) => c.auth === "OAuth AT")).toBe(true);
    // The host id is one path segment: its colons are encoded.
    expect(fake.calls[2].url.pathname).toBe("/v4/user/42/hosts/https%3Aquilltab.app%3A443/summary");
  });

  it("reads indexing, pages in search and SQI history with a date range", async () => {
    const fake = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/indexing/history": () =>
        json({ indicators: { HTTP_2XX: [{ date: "2026-11-20T00:00:00,000+0300", value: 10 }], HTTP_4XX: [{ date: "2026-11-20T00:00:00.000+03:00", value: 2 }] } }),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/search-urls/in-search/history": () =>
        json({ history: [{ date: "2026-11-21T00:00:00,000+0300", value: 300 }, { date: "2026-11-20T00:00:00,000+0300", value: 299 }] }),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/sqi-history": () => json({ points: [{ date: "2026-11-01T00:00:00,000+0300", value: 110 }] }),
    });
    const wm = createWebmasterClient("AT", opts(fake.fetch));
    const idx = await wm.indexingHistory("42", HOST, "2026-11-01", "2026-11-21");
    expect(idx.http2xx).toEqual([{ date: "2026-11-20", value: 10 }]);
    expect(idx.http4xx).toEqual([{ date: "2026-11-20", value: 2 }]);
    expect(idx.http5xx).toEqual([]);
    expect(fake.calls[0].url.searchParams.get("date_from")).toBe("2026-11-01T00:00:00.000Z");
    expect(fake.calls[0].url.searchParams.get("date_to")).toBe("2026-11-21T00:00:00.000Z");
    expect(await wm.searchableHistory("42", HOST, "2026-11-01", "2026-11-21")).toEqual([
      { date: "2026-11-20", value: 299 },
      { date: "2026-11-21", value: 300 },
    ]);
    expect(await wm.sqiHistory("42", HOST, "2026-11-01", "2026-11-21")).toEqual([{ date: "2026-11-01", value: 110 }]);
  });

  it("asks for popular queries with every indicator and pages by 500", async () => {
    let page = 0;
    const fake = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/search-queries/popular": () => {
        page++;
        const queries = Array.from({ length: page === 1 ? 500 : 3 }, (_, i) => ({
          query_id: `q${page}-${i}`,
          query_text: `query ${page}-${i}`,
          indicators: { TOTAL_SHOWS: 100.0, TOTAL_CLICKS: 5, AVG_SHOW_POSITION: 3.4 },
        }));
        return json({ queries, date_from: "2026-11-09", date_to: "2026-11-15", count: "503" });
      },
    });
    const wm = createWebmasterClient("AT", opts(fake.fetch));
    const rows = await wm.popularQueries("42", HOST, "2026-11-09", "2026-11-15", 1000);
    expect(rows).toHaveLength(503);
    expect(rows[0]).toEqual({ queryId: "q1-0", query: "query 1-0", shows: 100, clicks: 5, avgShowPosition: 3.4, avgClickPosition: null });
    const p = fake.calls[0].url.searchParams;
    expect(p.get("order_by")).toBe("TOTAL_SHOWS");
    expect(p.getAll("query_indicator")).toEqual(["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION"]);
    expect([p.get("offset"), p.get("limit")]).toEqual(["0", "500"]);
    expect(fake.calls[1].url.searchParams.get("offset")).toBe("500");
  });

  it("reads diagnostics and sitemaps", async () => {
    const fake = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/diagnostics": () =>
        json({ problems: { NO_SITEMAPS: { severity: "FATAL", state: "PRESENT", last_state_update: "2026-11-20T10:00:00,000+0300" } } }),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/sitemaps": () =>
        json({ sitemaps: [{ sitemap_id: "s", sitemap_url: "https://quilltab.app/sitemap.xml", urls_count: 40, errors_count: 1, children_count: 0, sources: ["ROBOTS_TXT"], sitemap_type: "SITEMAP" }] }),
    });
    const wm = createWebmasterClient("AT", opts(fake.fetch));
    expect(await wm.diagnostics("42", HOST)).toEqual([{ code: "NO_SITEMAPS", severity: "FATAL", state: "PRESENT", lastStateUpdate: "2026-11-20T10:00:00,000+0300" }]);
    expect((await wm.sitemaps("42", HOST))[0]).toMatchObject({ url: "https://quilltab.app/sitemap.xml", urlsCount: 40, errorsCount: 1 });
    expect(fake.calls[1].url.searchParams.get("limit")).toBe("100");
  });

  it("retries a 429 after Retry-After and a 5xx with backoff, fails at once on 403", async () => {
    let n = 0;
    const flaky = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user": () => {
        n++;
        if (n === 1) return json({ error_code: "TOO_MANY_REQUESTS_ERROR", error_message: "slow down" }, 429, { "Retry-After": "3" });
        if (n === 2) return new Response("bad gateway", { status: 502 });
        return json({ user_id: 1 });
      },
    });
    const sleeps: number[] = [];
    expect(await createWebmasterClient("AT", opts(flaky.fetch, sleeps)).userId()).toBe("1");
    expect(sleeps).toEqual([3000, 4000]);

    const refused = fakeYandex({ "GET api.webmaster.yandex.net/v4/user": () => json({ error_code: "INVALID_OAUTH_TOKEN", error_message: "bad" }, 403) });
    const err = await createWebmasterClient("AT", opts(refused.fetch)).userId().catch((e) => e);
    expect(err).toBeInstanceOf(YandexApiError);
    expect(err).toMatchObject({ status: 403, code: "INVALID_OAUTH_TOKEN", permanent: true });
    expect(refused.calls).toHaveLength(1);
  });

  it("does not retry a used-up daily quota", async () => {
    const fake = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user": () => json({ error_code: "QUOTA_EXCEEDED", daily_quota: 1000, exceeded_until: "2026-11-23", error_message: "quota" }, 429),
    });
    const err = await createWebmasterClient("AT", opts(fake.fetch)).userId().catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: "QUOTA_EXCEEDED", permanent: false });
    expect(fake.calls).toHaveLength(1);
  });

  it("parses the documented shapes defensively", () => {
    expect(webmasterDay("2016-01-01T00:00:00,000+0300")).toBe("2016-01-01");
    expect(webmasterDay(null)).toBeNull();
    expect(parsePopular({ queries: [{ query_text: "a", indicators: {} }], count: 1 }).queries[0].shows).toBeNull();
    expect(parseSitemaps({})).toEqual([]);
  });
});

describe("Metrika client", () => {
  it("lists counters with site2.site and goals", async () => {
    const fake = fakeYandex({
      "GET api-metrika.yandex.net/management/v1/counters": () =>
        json({ rows: 2, counters: [{ id: 1001, name: "Quilltab", site2: { site: "quilltab.app" }, status: "Active", permission: "own" }, { id: 1002, name: "Other", site2: { site: "other.example" } }] }),
      "GET api-metrika.yandex.net/management/v1/counter/1001/goals": () => json({ goals: [{ id: 501, name: "Sign-up", type: "action" }] }),
    });
    const mt = createMetrikaClient("AT", opts(fake.fetch));
    const counters = await mt.counters();
    expect(counters.map((c) => [c.id, c.site])).toEqual([["1001", "quilltab.app"], ["1002", "other.example"]]);
    expect(fake.calls[0].url.searchParams.get("offset")).toBe("1");
    expect(await mt.goals("1001")).toEqual([{ id: "501", name: "Sign-up", type: "action" }]);
    expect(fake.calls[1].auth).toBe("OAuth AT");
  });

  it("asks the Reporting API with full accuracy and follows 1-based offsets", async () => {
    let call = 0;
    const fake = fakeYandex({
      "GET api-metrika.yandex.net/stat/v1/data": () => {
        call++;
        const n = call === 1 ? STAT_PAGE_SIZE : 2;
        return json({
          data: Array.from({ length: n }, () => ({ dimensions: [{ name: "2026-11-20" }, { id: "organic", name: "Search engine traffic" }], metrics: [5, 4] })),
          total_rows: STAT_PAGE_SIZE + 2,
          sampled: false,
        });
      },
    });
    const rows = await createMetrikaClient("AT", opts(fake.fetch)).stat({
      counterId: "1001",
      metrics: ["ym:s:visits", "ym:s:users"],
      dimensions: ["ym:s:date", "ym:s:lastTrafficSource"],
      date1: "2026-11-01",
      date2: "2026-11-20",
      filters: "ym:s:lastTrafficSource=='organic'",
    });
    expect(rows).toHaveLength(STAT_PAGE_SIZE + 2);
    expect(rows[0]).toEqual({ dimensions: [{ id: null, name: "2026-11-20" }, { id: "organic", name: "Search engine traffic" }], metrics: [5, 4] });
    const p = fake.calls[0].url.searchParams;
    expect(Object.fromEntries(p)).toMatchObject({
      ids: "1001",
      metrics: "ym:s:visits,ym:s:users",
      dimensions: "ym:s:date,ym:s:lastTrafficSource",
      date1: "2026-11-01",
      date2: "2026-11-20",
      accuracy: "full",
      offset: "1",
      filters: "ym:s:lastTrafficSource=='organic'",
    });
    expect(fake.calls[1].url.searchParams.get("offset")).toBe(String(STAT_PAGE_SIZE + 1));
  });

  it("waits out a quota 429 and reads the Metrika error shape", async () => {
    let n = 0;
    const fake = fakeYandex({
      "GET api-metrika.yandex.net/management/v1/counter/1/goals": () =>
        ++n === 1
          ? json({ errors: [{ error_type: "quota_parallel_requests", message: "too many" }], code: 429, message: "too many" }, 429)
          : json({ errors: [{ error_type: "access_denied", message: "no access" }], code: 403, message: "no access" }, 403),
    });
    const sleeps: number[] = [];
    const err = await createMetrikaClient("AT", opts(fake.fetch, sleeps)).goals("1").catch((e) => e);
    expect(sleeps).toEqual([5000]);
    expect(err).toMatchObject({ status: 403, code: "access_denied", permanent: true });
  });

  it("refuses more than 20 metrics", async () => {
    const mt = createMetrikaClient("AT", opts(fakeYandex({}).fetch));
    await expect(mt.stat({ counterId: "1", metrics: Array(21).fill("ym:s:visits"), dimensions: [], date1: "2026-11-01", date2: "2026-11-02" })).rejects.toThrow(/20 metrics/);
  });
});
