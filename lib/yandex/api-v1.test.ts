import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Yandex under /api/v1 on a real Prisma client (PGlite): the two read
// routes, their periods and the isolation between users.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1 } from "@/lib/api-v1/router";
import { daysAgo, seedApiFixtures, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  (globalThis as { crawlseoApiRateLimiter?: unknown }).crawlseoApiRateLimiter = undefined;
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(path: string, key = f.keyA): Promise<{ status: number; body: Json }> {
  const res = await handleApiV1(new Request(`http://localhost/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` } }));
  return { status: res.status, body: (await res.json()) as Json };
}

const day = (n: number) => daysAgo(n).toISOString().slice(0, 10);

describe("GET /api/v1/sites/{id}/yandex/metrika", () => {
  it("compares the last N days with the N before, with sources, engines, goals and the daily series", async () => {
    const { status, body } = await get("/sites/site-a/yandex/metrika?days=7");
    expect(status).toBe(200);
    expect(body.counter).toMatchObject({ id: "1001", name: "Quilltab", goals: [{ id: "501", name: "Sign-up" }] });
    expect(body.period).toMatchObject({ from: day(6), to: day(0), previousFrom: day(13), previousTo: day(7), days: 7 });
    expect(body.totals.visits).toEqual({ current: 210, previous: 140 });
    expect(body.totals.usersPerDay).toEqual({ current: 21, previous: 14 });
    expect(body.totals.yandexSearchVisits).toEqual({ current: 105, previous: 35 });
    expect(body.totals.goalReaches).toEqual({ current: 14, previous: 7 });
    expect(body.sources).toEqual([{ key: "organic", name: "Search engine traffic", visits: 140, previousVisits: 70 }]);
    expect(body.goals).toEqual([{ id: "501", name: "Sign-up", reaches: 14, previousReaches: 7 }]);
    expect(body.daily).toHaveLength(7);
    expect(JSON.stringify(body)).not.toContain("999");
  });

  it("the previous period before the first stored day is unknown, not zero", async () => {
    const { body } = await get("/sites/site-a/yandex/metrika?days=10");
    expect(body.totals.visits.previous).toBeNull();
  });

  it("validates days", async () => {
    expect((await get("/sites/site-a/yandex/metrika?days=0")).status).toBe(400);
  });
});

describe("GET /api/v1/sites/{id}/yandex/webmaster", () => {
  it("returns the cards, problems present, sitemaps and the latest query week", async () => {
    const { status, body } = await get("/sites/site-a/yandex/webmaster?days=7&limit=5");
    expect(status).toBe(200);
    expect(body.host).toMatchObject({ id: "https:quilltab.app:443", url: "https://quilltab.app" });
    expect(body.cards.sqi).toEqual({ current: 50, previous: 40 });
    expect(body.cards.excludedPages).toEqual({ current: 4, previous: null });
    expect(body.cards.problems).toEqual({ current: 1, previous: null });
    expect(body.problems.map((p: { code: string }) => p.code)).toEqual(["NO_SITEMAP_MODIFICATIONS"]);
    expect(body.sitemaps).toHaveLength(1);
    expect(body.week).toEqual({ from: day(7), to: day(1) });
    expect(body.queries).toEqual([
      { query: "quilltab yandex", shows: 100, clicks: 10, ctr: 10, avgShowPosition: 3.5, avgClickPosition: 2, previousShows: 80, previousAvgShowPosition: 6 },
    ]);
  });
});

describe("isolation", () => {
  it("another user's site reads as not found, an unlinked one says what is missing", async () => {
    expect(await get("/sites/site-b/yandex/webmaster")).toMatchObject({ status: 404, body: { error: "Site not found" } });
    expect(await get("/sites/site-b/yandex/metrika")).toMatchObject({ status: 404, body: { error: "Site not found" } });
    await db.yandexSiteLink.update({ where: { siteId: "site-b" }, data: { metrikaCounterId: null } });
    const b = await get("/sites/site-b/yandex/metrika", f.keyB);
    expect(b.status).toBe(404);
    expect(b.body.error).toMatch(/no Metrika counter/);
    expect((await get("/sites/site-a/yandex/nothing")).status).toBe(404);
  });
});
