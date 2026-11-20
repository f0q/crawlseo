import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Rank tracking under /api/v1 on a real Prisma client (PGlite): the generic
// read routes, and the write route with its key scope, validation,
// idempotent upserts and write rate limit.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1, WRITES_PER_MINUTE } from "@/lib/api-v1/router";
import { daysAgo, seedApiFixtures, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { MAX_PUSH_ROWS } from "./rows";

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
  const g = globalThis as { crawlseoApiRateLimiter?: unknown; crawlseoApiWriteLimiter?: unknown };
  g.crawlseoApiRateLimiter = undefined;
  g.crawlseoApiWriteLimiter = undefined;
});

type Json = Record<string, unknown> & { error?: string };

async function get(path: string, key = f.keyA): Promise<{ status: number; body: Json }> {
  const res = await handleApiV1(new Request(`http://localhost/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` } }));
  return { status: res.status, body: (await res.json()) as Json };
}

async function post(path: string, payload: unknown, key = f.keyAWrite): Promise<{ status: number; body: Json }> {
  const res = await handleApiV1(
    new Request(`http://localhost/api/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

const day = (n: number) => daysAgo(n).toISOString().slice(0, 10);

const batch = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  source: "xml-parser",
  engine: "Яндекс",
  region: "Москва",
  device: "desktop",
  rows,
  ...extra,
});

describe("read", () => {
  it("rank-engines lists every source; engines of one search engine and region share a match key", async () => {
    const { status, body } = await get("/sites/site-a/rank-engines");
    expect(status).toBe(200);
    const engines = body.engines as { id: string; source: string; sourceName: string; synced: boolean; matchKey: string; latestCheck: string }[];
    expect(engines.map((e) => [e.id, e.source, e.sourceName, e.synced])).toEqual([
      ["eng-a", "labrika", "Labrika", true],
      ["eng-a-csv", "import", "CSV import", false],
    ]);
    expect(engines[0].matchKey).toBe(engines[1].matchKey);
    expect(engines[0].latestCheck).toBe(day(1));
    expect((await get("/sites/site-a/rank-engines?source=import")).body.engines).toHaveLength(1);
  });

  it("positions: the first engine by default, a source or engine picks another, from and to limit the checks", async () => {
    const latest = await get("/sites/site-a/positions");
    expect((latest.body.engine as { id: string }).id).toBe("eng-a");
    expect(latest.body.date).toBe(day(1));
    expect(latest.body.previousDate).toBe(day(8));

    const csv = await get("/sites/site-a/positions?source=import");
    expect((csv.body.engine as { source: string }).source).toBe("import");
    expect((csv.body.keywords as { keyword: string; position: number }[]).map((k) => [k.keyword, k.position])).toEqual([
      ["quilltab app", 4],
      ["notes app", 9],
    ]);

    const older = await get(`/sites/site-a/positions?engine=eng-a&to=${day(2)}`);
    expect(older.body.date).toBe(day(8));
    expect(older.body.previousDate).toBeNull();
    expect((await get(`/sites/site-a/positions?from=${day(5)}`)).body.dates).toEqual([day(1)]);
  });

  it("refuses bad days and unknown engines or sources", async () => {
    expect((await get("/sites/site-a/positions?from=2026-13-01")).status).toBe(400);
    expect((await get(`/sites/site-a/positions?from=${day(1)}&to=${day(5)}`)).status).toBe(400);
    expect((await get("/sites/site-a/positions?engine=nope")).status).toBe(404);
    expect((await get("/sites/site-a/positions?source=nope")).status).toBe(404);
  });
});

describe("write", () => {
  it("creates an engine for the source on first push and reads back through the same routes", async () => {
    const res = await post("/sites/site-a/positions", batch([
      { keyword: "quilltab app", date: day(1), position: 3, url: "https://quilltab.app/" },
      { keyword: "notes app", date: day(1), position: null },
      { keyword: "notes app", date: day(2), position: 15, frequency: 900 },
    ]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ engineCreated: true, rowsReceived: 3, rowsWritten: 3, dates: [day(2), day(1)] });

    const read = await get("/sites/site-a/positions?source=xml-parser");
    expect(read.body.date).toBe(day(1));
    const engine = read.body.engine as { source: string; sourceName: string; synced: boolean; host: string };
    expect(engine).toMatchObject({ source: "xml-parser", sourceName: "xml-parser", synced: false, host: "quilltab.app" });
  });

  it("is idempotent: the same batch twice leaves the same rows, a changed position replaces the old one", async () => {
    const rows = [{ keyword: "repeat me", date: day(3), position: 7 }];
    const first = await post("/sites/site-a/positions", batch(rows, { label: "idem" }));
    const again = await post("/sites/site-a/positions", batch(rows, { label: "idem" }));
    expect(again.body).toMatchObject({ engineId: first.body.engineId, engineCreated: false });
    const engineId = first.body.engineId as string;
    expect(await db.externalRank.count({ where: { engineId } })).toBe(1);

    await post("/sites/site-a/positions", batch([{ keyword: "repeat me", date: day(3), position: 2 }], { label: "idem" }));
    const stored = await db.externalRank.findMany({ where: { engineId } });
    expect(stored.map((r) => r.position)).toEqual([2]);
  });

  it("a key with the write scope still reads only its own user's sites", async () => {
    const res = await post("/sites/site-b/positions", batch([{ keyword: "x", date: day(1), position: 1 }]));
    expect(res.status).toBe(404);
    expect(await db.externalRankEngine.count({ where: { siteId: "site-b", source: "xml-parser" } })).toBe(0);
  });

  it("validates the batch: source name, provider sources, dates, positions, size and JSON", async () => {
    const one = [{ keyword: "k", date: day(1), position: 1 }];
    const cases: [unknown, RegExp][] = [
      [batch(one, { source: "Bad Source" }), /source/],
      [batch(one, { source: "labrika" }), /syncs itself/],
      [batch([{ keyword: "k", date: "01.11.2026", position: 1 }]), /YYYY-MM-DD/],
      [batch([{ keyword: "k", date: "2999-01-01", position: 1 }]), /future/],
      [batch([{ keyword: "k", date: day(1), position: 0 }]), /rows\.0\.position/],
      [batch([{ keyword: " ", date: day(1), position: 1 }]), /keyword/],
      [batch([]), /rows/],
      [batch(Array.from({ length: MAX_PUSH_ROWS + 1 }, (_, i) => ({ keyword: `k${i}`, date: day(1), position: 1 }))), /at most/],
      [batch(one, { engine: "" }), /engine/],
      ["{not json", /JSON/],
    ];
    for (const [payload, message] of cases) {
      const res = await post("/sites/site-a/positions", payload);
      expect([400, 413], String(message)).toContain(res.status);
      expect(res.body.error, String(message)).toMatch(message);
    }
  });

  it(`allows ${WRITES_PER_MINUTE} writes a minute per key, then 429`, async () => {
    const payload = batch([{ keyword: "rate", date: day(1), position: 1 }], { label: "rate" });
    for (let i = 0; i < WRITES_PER_MINUTE; i++) expect((await post("/sites/site-a/positions", payload)).status).toBe(200);
    const limited = await post("/sites/site-a/positions", payload);
    expect(limited.status).toBe(429);
    // Reads are not writes.
    expect((await get("/sites/site-a/rank-engines", f.keyAWrite)).status).toBe(200);
  });
});
