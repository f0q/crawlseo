import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { fakeYandex, json, type FakeCall } from "@/lib/testing/yandex-fake";
import { decrypt } from "@/lib/encryption";
import { accessTokenFor, connectWithCode, disconnectYandex, YandexNotConnectedError } from "./connection";
import { setSiteLink, siteLink, YandexLinkError } from "./links";
import { completeWeeks, syncYandexForSite, weeksToFetch, YandexSyncError } from "./sync";
import { metrikaReport, webmasterReport } from "./report";

// The Yandex connection, link and sync against Postgres (PGlite), with every
// Yandex request answered by a fake: no network.

let t: TestDb;
let db: PrismaClient;
const HOST = "https:quilltab.app:443";
const NOW = new Date("2026-11-22T10:00:00Z");
const HTTP = { minGapMs: 0, sleep: async () => {} };

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest-only";
  process.env.YANDEX_CLIENT_ID = "cid";
  process.env.YANDEX_CLIENT_SECRET = "csecret";
  t = await createTestDb();
  db = t.db;
}, 120_000);

afterAll(async () => {
  delete process.env.YANDEX_CLIENT_ID;
  delete process.env.YANDEX_CLIENT_SECRET;
  await t?.close();
});

/** Each day of date1..date2 as Metrika's ym:s:date rows. */
function days(call: FakeCall): string[] {
  const from = call.url.searchParams.get("date1")!;
  const to = call.url.searchParams.get("date2")!;
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function statAnswer(call: FakeCall) {
  const dims = call.url.searchParams.get("dimensions")!;
  const metrics = call.url.searchParams.get("metrics")!.split(",");
  const data = days(call).flatMap((date) => {
    if (dims === "ym:s:date,ym:s:lastTrafficSource") {
      return [
        { dimensions: [{ name: date }, { id: "organic", name: "Search engine traffic" }], metrics: [6, 5] },
        { dimensions: [{ name: date }, { id: "direct", name: "Direct traffic" }], metrics: [4, 4] },
      ];
    }
    if (dims === "ym:s:date,ym:s:lastSearchEngineRoot") {
      return [
        { dimensions: [{ name: date }, { id: "yandex", name: "Yandex" }], metrics: [5, 4] },
        { dimensions: [{ name: date }, { id: "google", name: "Google" }], metrics: [1, 1] },
      ];
    }
    if (metrics[0].startsWith("ym:s:goal")) return [{ dimensions: [{ name: date }], metrics: metrics.map(() => 1) }];
    return [{ dimensions: [{ name: date }], metrics: [10, 8, 25.5, 2.5, 90] }];
  });
  return json({ data, total_rows: data.length, sampled: false });
}

function yandex(opts: { token?: string; refresh?: () => Response } = {}) {
  return fakeYandex({
    "POST oauth.yandex.ru/token": (c) =>
      new URLSearchParams(c.body!).get("grant_type") === "refresh_token"
        ? (opts.refresh?.() ?? json({ access_token: "AT-new", refresh_token: "RT-new", expires_in: 31536000 }))
        : json({ access_token: opts.token ?? "AT", refresh_token: "RT", expires_in: 31536000 }),
    "POST oauth.yandex.ru/revoke_token": () => json({ status: "ok" }),
    "GET login.yandex.ru/info": () => json({ login: "agency-login", id: "7" }),
    "GET api.webmaster.yandex.net/v4/user": () => json({ user_id: 42 }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts": () =>
      json({ hosts: [{ host_id: HOST, ascii_host_url: "https://quilltab.app/", unicode_host_url: "https://quilltab.app/", verified: true }] }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/summary": () =>
      json({ sqi: 60, excluded_pages_count: 9, searchable_pages_count: 310, site_problems: { FATAL: 0, CRITICAL: 1, POSSIBLE_PROBLEM: 0, RECOMMENDATION: 2 } }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/indexing/history": () =>
      json({ indicators: { HTTP_2XX: [{ date: "2026-11-20T00:00:00,000+0300", value: 50 }], HTTP_4XX: [{ date: "2026-11-20T00:00:00,000+0300", value: 3 }] } }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/search-urls/in-search/history": () =>
      json({ history: [{ date: "2026-10-01T00:00:00,000+0300", value: 280 }, { date: "2026-11-20T00:00:00,000+0300", value: 300 }] }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/sqi-history": () => json({ points: [{ date: "2026-10-01T00:00:00,000+0300", value: 50 }] }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/search-queries/popular": (c) =>
      json({
        queries: [
          { query_id: "a", query_text: "quilltab", indicators: { TOTAL_SHOWS: 100, TOTAL_CLICKS: 20, AVG_SHOW_POSITION: 1.5, AVG_CLICK_POSITION: 1.2 } },
          { query_id: "b", query_text: `notes ${c.url.searchParams.get("date_from")!.slice(0, 10)}`, indicators: { TOTAL_SHOWS: 40, TOTAL_CLICKS: 1, AVG_SHOW_POSITION: 8 } },
        ],
        count: 2,
      }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/diagnostics": () =>
      json({ problems: { SLOW_AVG_RESPONSE_TIME: { severity: "CRITICAL", state: "PRESENT" }, NO_SITEMAPS: { severity: "FATAL", state: "ABSENT" } } }),
    "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/sitemaps": () =>
      json({ sitemaps: [{ sitemap_id: "1", sitemap_url: "https://quilltab.app/sitemap.xml", urls_count: 310, errors_count: 0 }] }),
    "GET api-metrika.yandex.net/management/v1/counters": () => json({ rows: 1, counters: [{ id: 1001, name: "Quilltab", site2: { site: "quilltab.app" } }] }),
    "GET api-metrika.yandex.net/management/v1/counter/1001/goals": () =>
      json({ goals: [{ id: 501, name: "Sign-up", type: "action" }, { id: 502, name: "Order", type: "action" }] }),
    "GET api-metrika.yandex.net/stat/v1/data": statAnswer,
  });
}

const HOSTS = [{ hostId: HOST, asciiUrl: "https://quilltab.app/", unicodeUrl: "https://quilltab.app/", verified: true, mainMirrorHostId: null }];
const COUNTERS = [{ id: "1001", name: "Quilltab", site: "quilltab.app", status: "Active", permission: "own" }];
const GOALS = [
  { id: "501", name: "Sign-up", type: "action" },
  { id: "502", name: "Order", type: "action" },
];

async function reset() {
  await db.user.deleteMany();
  await db.user.create({ data: { id: "u1", email: "u1@quilltab.app" } });
  await db.site.create({ data: { id: "s1", userId: "u1", domain: "quilltab.app" } });
}

describe("connection", () => {
  beforeEach(reset);

  it("stores the exchanged tokens encrypted with the login, and refreshes before expiry", async () => {
    const fake = yandex();
    const status = await connectWithCode(db, "u1", "1234567", { fetch: fake.fetch, ...HTTP, now: NOW });
    expect(status).toMatchObject({ configured: true, connected: true, login: "agency-login" });
    const row = await db.yandexConnection.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(row.encryptedAccessToken).not.toContain("AT");
    expect(decrypt(row.encryptedAccessToken)).toBe("AT");
    expect(decrypt(row.encryptedRefreshToken!)).toBe("RT");

    // Far from expiry: the stored token, no request.
    const before = fake.calls.length;
    expect(await accessTokenFor(db, "u1", { fetch: fake.fetch, now: NOW })).toBe("AT");
    expect(fake.calls.length).toBe(before);

    // Within a day of expiry: refreshed and stored.
    await db.yandexConnection.update({ where: { userId: "u1" }, data: { expiresAt: new Date(NOW.getTime() + 3_600_000) } });
    expect(await accessTokenFor(db, "u1", { fetch: fake.fetch, now: NOW })).toBe("AT-new");
    const refreshed = await db.yandexConnection.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(decrypt(refreshed.encryptedAccessToken)).toBe("AT-new");
    expect(decrypt(refreshed.encryptedRefreshToken!)).toBe("RT-new");
    expect(refreshed.expiresAt!.getTime()).toBeGreaterThan(NOW.getTime() + 300 * 86_400_000);
  });

  it("a refused refresh asks to connect again; a Yandex outage keeps the still valid token", async () => {
    await connectWithCode(db, "u1", "1234567", { fetch: yandex().fetch, ...HTTP, now: NOW });
    await db.yandexConnection.update({ where: { userId: "u1" }, data: { expiresAt: new Date(NOW.getTime() + 3_600_000) } });
    const down = yandex({ refresh: () => new Response("down", { status: 503 }) });
    expect(await accessTokenFor(db, "u1", { fetch: down.fetch, now: NOW })).toBe("AT");
    const refused = yandex({ refresh: () => json({ error: "invalid_grant", error_description: "revoked" }, 400) });
    await expect(accessTokenFor(db, "u1", { fetch: refused.fetch, now: NOW })).rejects.toBeInstanceOf(YandexNotConnectedError);
    await expect(accessTokenFor(db, "nobody", { now: NOW })).rejects.toBeInstanceOf(YandexNotConnectedError);
  });
});

describe("site link", () => {
  beforeEach(reset);

  it("checks ids against the account, wipes the old data on change and drops an empty link", async () => {
    await expect(setSiteLink(db, "s1", { webmasterHostId: "https:other.example:443" }, { hosts: HOSTS })).rejects.toBeInstanceOf(YandexLinkError);
    await expect(setSiteLink(db, "s1", { metrikaCounterId: "1001", goalIds: ["999"] }, { counters: COUNTERS, goals: GOALS })).rejects.toBeInstanceOf(YandexLinkError);

    const first = await setSiteLink(db, "s1", { webmasterHostId: HOST, metrikaCounterId: "1001", goalIds: ["501"] }, { hosts: HOSTS, counters: COUNTERS, goals: GOALS });
    expect(first).toMatchObject({ syncWebmaster: true, syncMetrika: true });
    expect(first.link).toMatchObject({ webmasterHostUrl: "https://quilltab.app/", metrikaCounterName: "Quilltab", goals: [{ id: "501", name: "Sign-up" }] });

    // Unchanged: nothing to sync.
    expect(await setSiteLink(db, "s1", { webmasterHostId: HOST }, {})).toMatchObject({ syncWebmaster: false, syncMetrika: false });

    await db.yandexMetrikaDaily.create({ data: { siteId: "s1", date: new Date("2026-11-20T00:00:00Z"), kind: "total", visits: 1, users: 1 } });
    await db.yandexGoalDaily.create({ data: { siteId: "s1", date: new Date("2026-11-20T00:00:00Z"), goalId: "501", reaches: 1 } });
    // Removing a goal deletes its rows; the counter's rows stay.
    await setSiteLink(db, "s1", { goalIds: [] }, {});
    expect(await db.yandexGoalDaily.count()).toBe(0);
    expect(await db.yandexMetrikaDaily.count()).toBe(1);

    // Clearing the counter wipes Metrika; clearing both drops the row.
    await setSiteLink(db, "s1", { metrikaCounterId: null }, {});
    expect(await db.yandexMetrikaDaily.count()).toBe(0);
    await setSiteLink(db, "s1", { webmasterHostId: null }, {});
    expect(await db.yandexSiteLink.count()).toBe(0);
  });
});

describe("sync", () => {
  beforeEach(async () => {
    await reset();
    await connectWithCode(db, "u1", "1234567", { fetch: yandex().fetch, ...HTTP, now: NOW });
    await setSiteLink(db, "s1", { webmasterHostId: HOST, metrikaCounterId: "1001", goalIds: ["501"] }, { hosts: HOSTS, counters: COUNTERS, goals: GOALS });
  });

  it("picks complete weeks after the Webmaster lag", () => {
    const weeks = completeWeeks("2026-11-22", 12);
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)).toBe("2026-11-09");
    expect(weeks[0]).toBe("2026-08-24");
    expect(weeksToFetch("2026-11-22", weeks)).toEqual(["2026-11-09"]);
  });

  it("backfills 90 days of Metrika, a year of Webmaster history and 12 query weeks, then only the newest days", async () => {
    const fake = yandex();
    const result = await syncYandexForSite(db, "s1", { http: { fetch: fake.fetch, ...HTTP }, now: NOW });
    expect(result).toMatchObject({ metrikaDays: 90, queryWeeks: 12, queries: 24 });
    expect(result.failed).toBeUndefined();
    expect(fake.calls.every((c) => c.url.host === "oauth.yandex.ru" || c.auth === "OAuth AT")).toBe(true);

    const stat = fake.calls.filter((c) => c.url.pathname === "/stat/v1/data");
    expect(stat.map((c) => c.url.searchParams.get("date1"))).toEqual(["2026-08-25", "2026-08-25", "2026-08-25", "2026-08-25"]);
    expect(stat[2].url.searchParams.get("filters")).toBe("ym:s:lastTrafficSource=='organic'");
    expect(stat[3].url.searchParams.get("metrics")).toBe("ym:s:goal501reaches");
    const idx = fake.calls.find((c) => c.url.pathname.endsWith("/indexing/history"))!;
    expect(idx.url.searchParams.get("date_from")).toBe("2025-11-23T00:00:00.000Z");

    expect(await db.yandexMetrikaDaily.count({ where: { kind: "total" } })).toBe(90);
    expect(await db.yandexMetrikaDaily.count({ where: { kind: "source" } })).toBe(180);
    expect(await db.yandexGoalDaily.count()).toBe(90);
    const today = await db.yandexWebmasterDaily.findFirstOrThrow({ where: { date: new Date("2026-11-22T00:00:00Z") } });
    expect(today).toMatchObject({ sqi: 60, searchablePages: 310, excludedPages: 9, problemsCritical: 1, problemsRecommendation: 2 });
    const nov20 = await db.yandexWebmasterDaily.findFirstOrThrow({ where: { date: new Date("2026-11-20T00:00:00Z") } });
    expect(nov20).toMatchObject({ http2xx: 50, http4xx: 3, searchablePages: 300 });
    const link = await siteLink(db, "s1");
    expect(link.webmasterSyncedAt).not.toBeNull();
    expect(link.metrikaError).toBeNull();

    // Reports read what was stored.
    const m = await metrikaReport(db, "s1", { days: 28 });
    expect(m.totals.visits).toEqual({ current: 280, previous: 280 });
    expect(m.totals.yandexSearchVisits).toEqual({ current: 140, previous: 140 });
    expect(m.totals.goalReaches).toEqual({ current: 28, previous: 28 });
    expect(m.totals.bounceRate.current).toBe(25.5);
    expect(m.sources.map((s) => s.key)).toEqual(["organic", "direct"]);
    expect(m.daily).toHaveLength(28);
    const w = await webmasterReport(db, "s1", { days: 28 });
    expect(w.cards.sqi).toEqual({ current: 60, previous: 50 });
    expect(w.cards.searchablePages).toEqual({ current: 310, previous: 280 });
    expect(w.problems.map((p) => p.code)).toEqual(["SLOW_AVG_RESPONSE_TIME"]);
    expect(w.week).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(w.queries[0]).toMatchObject({ query: "quilltab", shows: 100, clicks: 20, ctr: 20, previousShows: 100 });

    // The next day: Metrika from three days before the newest stored day, one query week again.
    const next = yandex();
    const again = await syncYandexForSite(db, "s1", { http: { fetch: next.fetch, ...HTTP }, now: new Date("2026-11-23T10:00:00Z") });
    expect(again.queryWeeks).toBe(1);
    expect(next.calls.filter((c) => c.url.pathname === "/stat/v1/data").map((c) => c.url.searchParams.get("date1"))).toEqual([
      "2026-11-19",
      "2026-11-19",
      "2026-11-19",
      "2026-11-19",
    ]);
    // The Webmaster user id was kept.
    expect(next.calls.some((c) => c.url.pathname === "/v4/user")).toBe(false);
    expect(await db.yandexMetrikaDaily.count({ where: { kind: "total" } })).toBe(91);
    expect(await db.yandexQueryWeekly.count()).toBe(24);
  });

  it("a goal added later gets its own 90 days", async () => {
    await syncYandexForSite(db, "s1", { http: { fetch: yandex().fetch, ...HTTP }, now: NOW });
    await setSiteLink(db, "s1", { goalIds: ["501", "502"] }, { goals: GOALS });
    const fake = yandex();
    await syncYandexForSite(db, "s1", { http: { fetch: fake.fetch, ...HTTP }, now: NOW });
    const goalCalls = fake.calls.filter((c) => c.url.searchParams.get("metrics")?.startsWith("ym:s:goal"));
    expect(goalCalls.map((c) => [c.url.searchParams.get("metrics"), c.url.searchParams.get("date1")])).toEqual([
      ["ym:s:goal501reaches", "2026-11-19"],
      ["ym:s:goal502reaches", "2026-08-25"],
    ]);
    expect(await db.yandexGoalDaily.count({ where: { goalId: "502" } })).toBe(90);
  });

  it("keeps Metrika when Webmaster refuses the host, and fails permanently when everything is refused", async () => {
    const base = yandex();
    const noHost = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/:rest": () => json({ error_code: "HOST_NOT_VERIFIED", error_message: "no" }, 404),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/:rest/:more": () => json({ error_code: "HOST_NOT_VERIFIED", error_message: "no" }, 404),
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/:rest/:more/:most": () => json({ error_code: "HOST_NOT_VERIFIED", error_message: "no" }, 404),
    });
    const mixed = ((input: string | URL | Request, init?: RequestInit) =>
      String(input).includes("api.webmaster.yandex.net/v4/user/42/hosts/") ? noHost.fetch(input, init) : base.fetch(input, init)) as typeof fetch;
    const result = await syncYandexForSite(db, "s1", { http: { fetch: mixed, ...HTTP }, now: NOW });
    expect(result.metrikaDays).toBe(90);
    expect(result.failed?.join(" ")).toMatch(/HOST_NOT_VERIFIED/);
    expect((await siteLink(db, "s1")).webmasterError).toMatch(/HOST_NOT_VERIFIED/);

    const refused = fakeYandex({
      "GET api.webmaster.yandex.net/v4/user/42/hosts/:host/summary": () => json({ error_code: "INVALID_OAUTH_TOKEN" }, 403),
      "GET api-metrika.yandex.net/stat/v1/data": () => json({ errors: [{ error_type: "invalid_token", message: "bad" }], code: 403 }, 403),
    });
    const err = await syncYandexForSite(db, "s1", { http: { fetch: refused.fetch, ...HTTP }, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(YandexSyncError);
    expect(err.permanent).toBe(true);
  });

  it("disconnect revokes the token and removes links and data", async () => {
    await syncYandexForSite(db, "s1", { http: { fetch: yandex().fetch, ...HTTP }, now: NOW });
    const fake = yandex();
    await disconnectYandex(db, "u1", { fetch: fake.fetch });
    expect(fake.paths()).toEqual(["POST oauth.yandex.ru/revoke_token"]);
    for (const count of [
      db.yandexConnection.count(),
      db.yandexSiteLink.count(),
      db.yandexWebmasterDaily.count(),
      db.yandexQueryWeekly.count(),
      db.yandexMetrikaDaily.count(),
      db.yandexGoalDaily.count(),
    ]) {
      expect(await count).toBe(0);
    }
    await expect(syncYandexForSite(db, "s1")).rejects.toMatchObject({ permanent: true });
  });
});
