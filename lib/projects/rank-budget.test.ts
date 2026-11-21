import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Rank check settings, the usage log, the scheduled starts and the client
// budget (agency fork) on a real Prisma client (PGlite), through /api/v1 and
// the dashboard routes. The provider's HTTP is a fake: nothing leaves the test.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1 } from "@/lib/api-v1/router";
import { encrypt } from "@/lib/encryption";
import { daysAgo, seedApiFixtures, snapshotUserData, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { handleDashboardProjects } from "./dashboard";
import { isDue, runDueRankChecks, runRankCheck } from "./rank";
import { rankChecksScheduled } from "./rank-jobs";
import { checksPerMonth, limitState } from "./rank-usage";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ??= "test-secret-for-rank-budget";
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  const g = globalThis as { crawlseoApiRateLimiter?: unknown; crawlseoApiWriteLimiter?: unknown };
  g.crawlseoApiRateLimiter = undefined;
  g.crawlseoApiWriteLimiter = undefined;
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: string, path: string, key: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handleApiV1(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

const A = { id: "user-a", email: "a@quilltab.app" };
async function dash(method: string, path: string, body?: unknown, user = A): Promise<{ status: number; body: Json }> {
  const res = await handleDashboardProjects(
    user,
    new Request(`http://localhost/api/projects${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

/** A fake labrika.ru: the login page, the login form and the start call. */
function fakeLabrika(startStatus = 200) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    urls.push(`${init.method ?? "GET"} ${url}`);
    if (!url.startsWith("https://labrika.ru/")) throw new Error(`unexpected host ${url}`);
    if (url.endsWith("/login") && (init.method ?? "GET") === "GET") return new Response("<html></html>", { headers: { "set-cookie": "s=1; path=/" } });
    if (url.endsWith("/login")) return new Response("", { status: 302, headers: { location: "https://labrika.ru/dashboard", "set-cookie": "s=2; path=/" } });
    return Response.json({}, { status: startStatus });
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

describe("migration", () => {
  it("gives every existing project rank settings that are turned off", async () => {
    const dir = join(__dirname, "../../prisma/migrations");
    const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const last = names.indexOf("20261123000000_agency_rank_settings_budget");
    expect(last).toBe(names.length - 1);
    const pg = await PGlite.create();
    try {
      for (const name of names.slice(0, last)) await pg.exec(readFileSync(join(dir, name, "migration.sql"), "utf8"));
      await pg.exec(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('u1', 'u1@example.com', now());
        INSERT INTO "Project" ("id", "slug", "name", "ownerId", "updatedAt") VALUES ('p1', 'old-one', 'Old', 'u1', now());`);
      await pg.exec(readFileSync(join(dir, names[last], "migration.sql"), "utf8"));
      const r = await pg.query<{ enabled: boolean; source: string; frequency: string }>(`SELECT "enabled", "source", "frequency" FROM "ProjectRankSettings" WHERE "projectId" = 'p1'`);
      expect(r.rows).toEqual([{ enabled: false, source: "none", frequency: "manual" }]);
    } finally {
      await pg.close();
    }
  }, 60_000);
});

describe("usage arithmetic", () => {
  it("keywords x engines x runs a month, and the limit", () => {
    expect(checksPerMonth(100, "weekly")).toBe(435);
    expect(checksPerMonth(100, "biweekly")).toBe(218);
    expect(checksPerMonth(100, "monthly")).toBe(100);
    expect(checksPerMonth(100, "manual")).toBe(0);
    expect(checksPerMonth(100, "weekly", false)).toBe(0);
    expect(limitState(5000, 4000, 1001)).toMatchObject({ total: 5001, over: true });
    expect(limitState(5000, 3000, 1000)).toMatchObject({ over: false, near: true });
    expect(limitState(0, 9000, 9000).over).toBe(false);
  });

  it("is due once per interval, and a skipped scheduled run is retried after a day", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(isDue("weekly", null, null, now)).toBe(true);
    expect(isDue("weekly", ago(3), null, now)).toBe(false);
    expect(isDue("weekly", ago(7), null, now)).toBe(true);
    expect(isDue("biweekly", ago(10), null, now)).toBe(false);
    expect(isDue("monthly", new Date("2026-10-21T12:00:00Z"), null, now)).toBe(true);
    expect(isDue("monthly", new Date("2026-10-25T12:00:00Z"), null, now)).toBe(false);
    expect(isDue("manual", null, null, now)).toBe(false);
    expect(isDue("weekly", null, { at: ago(0.5), success: false }, now)).toBe(false);
    expect(isDue("weekly", null, { at: ago(1), success: false }, now)).toBe(true);
  });

  it("the scheduled starts can be turned off for the instance", () => {
    expect(rankChecksScheduled({})).toBe(true);
    expect(rankChecksScheduled({ SCHEDULE_RANK_CHECKS: "false" })).toBe(false);
    expect(rankChecksScheduled({ SCHEDULE_RANK_CHECKS: "0" })).toBe(false);
  });
});

describe("rank settings", () => {
  it("are off by default, with the project's engines and their keywords", async () => {
    const r = await api("GET", "/projects/quilltab/rank-settings", f.keyA);
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ enabled: false, source: "none", frequency: "manual", engineIds: [] });
    const engines = r.body.engines as { id: string; keywords: number | null; source: string }[];
    expect(engines.map((e) => [e.id, e.source, e.keywords])).toEqual([
      ["eng-a-csv", "import", 2],
      ["eng-a", "labrika", 3],
    ]);
    expect(r.body.providers).toEqual([{ id: "labrika", name: "Labrika", canStart: true }]);
    expect(r.body.usage).toMatchObject({ perRun: 0, perMonth: 0 });
    expect(r.body.global[0].plan).toMatchObject({ provider: "labrika", monthlyLimit: 5000, planPrice: 360, planChecks: 5000, pricePerCheck: 0.072 });
    // Another user's project stays hidden.
    expect((await api("GET", "/projects/secret-b/rank-settings", f.keyA)).status).toBe(404);
  });

  it("refuses a read-only key, a source of none when turning on, and engines of another source or project", async () => {
    const before = await snapshotUserData(db);
    expect((await api("PATCH", "/projects/quilltab/rank-settings", f.keyA, { enabled: true })).status).toBe(403);
    expect((await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { enabled: true })).body.error).toMatch(/Pick a source/);
    expect((await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { source: "nope" })).status).toBe(400);
    expect((await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { source: "labrika", engineIds: ["eng-b"] })).status).toBe(400);
    expect((await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { source: "labrika", engineIds: ["eng-a-csv"] })).status).toBe(400);
    expect(await snapshotUserData(db)).toBe(before);
  });

  it("a disabled project never runs, and logs nothing", async () => {
    expect(await runRankCheck(db, "proj-a", { trigger: "schedule" })).toBeNull();
    expect(await runDueRankChecks(db, { now: new Date() })).toEqual([]);
    expect(await db.rankCheckRun.count()).toBe(0);
  });

  it("saves the settings and shows the planned checks", async () => {
    const r = await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { enabled: true, source: "labrika", frequency: "weekly", engineIds: ["eng-a"] });
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.settings).toMatchObject({ enabled: true, source: "labrika", frequency: "weekly", engineIds: ["eng-a"] });
    expect(r.body.usage).toMatchObject({ perRun: 3, perMonth: 14 });
    expect(r.body.starting).toEqual({ mode: "auto", missingCabinetFor: ["a@quilltab.app"] });
    expect(r.body.global[0]).toMatchObject({ planned: 14, used: 0 });
  });

  it("refuses a change over the monthly limit unless overridden", async () => {
    // Only admins change plans when admins are configured.
    process.env.CRAWLSEO_ADMIN_EMAILS = "admin@quilltab.app";
    try {
      expect((await dash("PATCH", "/_rank-plans", { provider: "labrika", monthlyLimit: 20, planName: "Tiny", planPrice: 2, planChecks: 20, currency: "RUB" })).status).toBe(403);
    } finally {
      delete process.env.CRAWLSEO_ADMIN_EMAILS;
    }
    const plan = await dash("PATCH", "/_rank-plans", { provider: "labrika", monthlyLimit: 20, planName: "Tiny", planPrice: 2, planChecks: 20, currency: "RUB" });
    expect(plan.status, plan.body.error).toBe(200);
    expect(plan.body.plan).toMatchObject({ monthlyLimit: 20, pricePerCheck: 0.1, custom: true });
    // The API cannot change plans.
    expect((await api("PATCH", "/projects/_rank-plans", f.keyAWrite, { provider: "labrika" })).status).toBe(405);

    // Weekly with 3 keywords is 14 a month and fits 20; the engine's latest check grows to 6 keywords.
    await db.externalRank.createMany({ data: Array.from({ length: 3 }, (_, i) => ({ engineId: "eng-a", keyword: `extra ${i}`, date: daysAgo(1) })) });
    const over = await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { frequency: "weekly", engineIds: ["eng-a"] });
    // Unchanged settings never get refused, even when the engines grew.
    expect(over.status).toBe(200);
    expect(over.body.usage).toMatchObject({ perRun: 6, perMonth: 27 });
    expect(over.body.limit).toMatchObject({ limit: 20, over: true });
    await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { frequency: "monthly" });
    const refused = await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { frequency: "weekly" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/27 checks a month .* over the Labrika limit of 20/);
    const forced = await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { frequency: "weekly", override: true });
    expect(forced.status).toBe(200);
    // Back to the defaults for the runs below.
    await dash("PATCH", "/_rank-plans", { provider: "labrika", monthlyLimit: 5000, planName: "Business", planPrice: 360, planChecks: 5000, currency: "RUB" });
  });

  it("a due project without a cabinet login is skipped and logged once, not every pass", async () => {
    const { fetch, urls } = fakeLabrika();
    const now = new Date();
    const runs = await runDueRankChecks(db, { now, providerOptions: { fetch } });
    expect(runs.map((r) => [r!.status, r!.reason])).toEqual([["skipped", "no-cabinet-login"]]);
    expect(urls).toEqual([]);
    expect(await runDueRankChecks(db, { now: new Date(now.getTime() + 60 * 60_000), providerOptions: { fetch } })).toEqual([]);
    const usage = await api("GET", "/projects/quilltab/rank-usage", f.keyA);
    expect(usage.body).toMatchObject({ checks: 0, runs: [{ status: "skipped", reason: "no-cabinet-login", trigger: "schedule" }] });
  });

  it("starts the check through the cabinet with the stored login, and logs the checks", async () => {
    await db.apiKey.create({ data: { userId: "user-a", provider: "labrika-cabinet", encryptedLogin: encrypt("a@quilltab.app"), encryptedPassword: encrypt("pw") } });
    const { fetch, urls } = fakeLabrika();
    const run = await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } });
    expect(run).toMatchObject({ status: "started", estimatedChecks: 6, engineIds: ["eng-a"] });
    expect(urls).toEqual([
      "GET https://labrika.ru/login",
      "POST https://labrika.ru/login",
      "POST https://labrika.ru/api/v1/sites/uuid-a/reports/search_positions/start",
    ]);
    // Started a moment ago: the weekly schedule is not due.
    expect(await runDueRankChecks(db, { now: new Date(), providerOptions: { fetch } })).toEqual([]);
    const usage = await api("GET", "/projects/quilltab/rank-usage", f.keyA);
    expect(usage.body).toMatchObject({ checks: 6, costs: [{ provider: "labrika", checks: 6, pricePerCheck: 0.072, amount: 0.43 }] });
  });

  it("a refused start is logged as failed with the provider's answer and counts nothing", async () => {
    const { fetch } = fakeLabrika(402);
    const run = await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } });
    expect(run).toMatchObject({ status: "failed", estimatedChecks: 0 });
    expect(run!.reason).toMatch(/Labrika answered 402/);
  });

  it("a scheduled run over the month's limit is skipped; a manual one may override", async () => {
    await db.rankProviderPlan.update({ where: { provider: "labrika" }, data: { monthlyLimit: 8 } });
    const { fetch, urls } = fakeLabrika();
    expect(await runRankCheck(db, "proj-a", { trigger: "schedule", providerOptions: { fetch } })).toMatchObject({ status: "skipped", reason: "over-limit" });
    expect(urls).toEqual([]);
    expect(await runRankCheck(db, "proj-a", { trigger: "manual", override: true, providerOptions: { fetch } })).toMatchObject({ status: "started" });
    await db.rankProviderPlan.update({ where: { provider: "labrika" }, data: { monthlyLimit: 5000 } });
  });

  it("start now is dashboard only and needs checks turned on", async () => {
    expect((await api("POST", "/projects/quilltab/rank-checks", f.keyAWrite, {})).status).toBe(404);
    await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { enabled: false });
    const r = await dash("POST", "/quilltab/rank-checks", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/off for this project/);
    await api("PATCH", "/projects/quilltab/rank-settings", f.keyAWrite, { enabled: true });
  });
});

describe("budget", () => {
  it("starts empty in RUB with the default categories", async () => {
    const r = await api("GET", "/projects/quilltab/budget", f.keyA);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ currency: "RUB", categories: ["work", "services", "ads", "content", "links", "other"], entries: [] });
    expect(r.body.history).toHaveLength(6);
  });

  it("plans by category, with a month over the default, and adds entries once per externalKey", async () => {
    const month = new Date().toISOString().slice(0, 7);
    expect((await api("PATCH", "/projects/quilltab/budget", f.keyA, { plan: { lines: { work: 1000 } } })).status).toBe(403);
    const plan = await api("PATCH", "/projects/quilltab/budget", f.keyAWrite, { plan: { lines: { work: 1000, services: 100, links: 500 } } });
    expect(plan.status, plan.body.error).toBe(200);
    await api("PATCH", "/projects/quilltab/budget", f.keyAWrite, { plan: { month, lines: { links: 0, ads: 300 } } });
    expect((await api("PATCH", "/projects/quilltab/budget", f.keyAWrite, { plan: { lines: { nope: 1 } } })).status).toBe(400);

    const add = (body: unknown) => api("POST", "/projects/quilltab/budget-entries", f.keyAWrite, body);
    const first = await add({ category: "work", amount: 400, note: "Audit", externalKey: "inv-1" });
    expect(first.status, first.body.error).toBe(201);
    expect(first.body.entry).toMatchObject({ category: "work", amount: 400, authorKind: "agent" });
    const again = await add({ category: "work", amount: 450, note: "Audit", externalKey: "inv-1" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, entry: { id: first.body.entry.id, amount: 450 } });
    expect((await add({ category: "travel", amount: 5 })).status).toBe(400);
    expect((await add({ category: "ads", amount: 0 })).status).toBe(400);
    await add({ category: "ads", amount: 120.5 });

    const r = await api("GET", `/projects/quilltab/budget?month=${month}`, f.keyA);
    expect(r.body.plan).toEqual({ defaults: { work: 1000, services: 100, links: 500 }, month: { links: 0, ads: 300 } });
    // 6 + 6 checks started this month by the rank tests at 0.072 RUB.
    expect(r.body.autoCosts).toEqual([{ provider: "labrika", name: "Labrika", checks: 12, pricePerCheck: 0.072, currency: "RUB", amount: 0.86, counted: true }]);
    const rows = Object.fromEntries((r.body.summary.rows as { category: string; plan: number; actual: number }[]).map((x) => [x.category, [x.plan, x.actual]]));
    expect(rows).toMatchObject({ work: [1000, 450], services: [100, 0.86], ads: [300, 120.5], links: [0, 0] });
    expect(r.body.summary).toMatchObject({ plan: 1400, actual: 571.36, percent: 41 });
    // The default plan, without the month's own lines, for another month.
    const other = await api("GET", "/projects/quilltab/budget?month=2020-01", f.keyA);
    expect(other.body.summary).toMatchObject({ plan: 1600, actual: 0 });
    expect((await api("GET", "/projects/quilltab/budget?month=2020-13", f.keyA)).status).toBe(400);
  });

  it("does not add rank costs in RUB to a USD budget", async () => {
    await api("PATCH", "/projects/quilltab/budget", f.keyAWrite, { currency: "USD" });
    const r = await api("GET", "/projects/quilltab/budget", f.keyA);
    expect(r.body.autoCosts[0]).toMatchObject({ currency: "RUB", counted: false });
    expect(r.body.summary.actual).toBe(570.5);
    await api("PATCH", "/projects/quilltab/budget", f.keyAWrite, { currency: "RUB" });
  });

  it("sums this month of every visible project, and rank usage against the limit", async () => {
    const r = await api("GET", "/projects/_summary", f.keyA);
    expect(r.status).toBe(200);
    expect(r.body.budget.projects).toEqual([{ slug: "quilltab", name: "Quilltab", currency: "RUB", plan: 1400, actual: 571.36, percent: 41 }]);
    expect(r.body.budget.totals).toEqual([{ currency: "RUB", plan: 1400, actual: 571.36, percent: 41 }]);
    expect(r.body.rank[0]).toMatchObject({ used: 12, planned: 27, limit: { limit: 5000, over: false } });
    const b = await api("GET", "/projects/_summary", f.keyB);
    expect(b.body.budget.projects.map((p: { slug: string }) => p.slug)).toEqual(["secret-b"]);
    expect(b.body.rank[0].projects).toEqual([]);
  });

  it("deletes an entry from the dashboard only", async () => {
    const r = await api("GET", "/projects/quilltab/budget", f.keyA);
    const id = r.body.entries[0].id as string;
    expect((await api("PATCH", `/projects/quilltab/budget-entries/${id}`, f.keyAWrite, { note: "changed" })).body.entry.note).toBe("changed");
    expect((await dash("DELETE", `/quilltab/budget-entries/${id}`)).status).toBe(200);
    expect((await dash("DELETE", `/quilltab/budget-entries/${id}`)).status).toBe(404);
  });
});
