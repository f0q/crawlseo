import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The generic sync against the real schema on PGlite, with the Labrika
// provider's client replaced by a fake: the first sync backfills every check date, later ones fetch only
// new dates plus the newest stored one, and a rerun writes the same rows.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { LabrikaApiError } from "./labrika/client";
import { chunk, daysToFetch, rankRows, RankSyncError, syncRanksForSite, type ClientFactory } from "./sync";
import { RankKeyMissingError, type RankProviderClient, type RankRow } from "./types";

let t: TestDb;
let db: PrismaClient;

/** A provider with `dates` checks; keyword "b" is checked only from the second date on. */
function fakeProvider(dates: string[], opts: { failEngine?: string } = {}) {
  const calls: string[][] = [];
  const client: RankProviderClient = {
    ping: vi.fn(),
    listProjects: vi.fn(),
    listEngines: vi.fn(),
    listDates: vi.fn(async ({ externalEngineId }) => {
      if (externalEngineId === opts.failEngine) throw new LabrikaApiError(404, "not_found", "engine gone");
      return [...dates];
    }),
    fetchPositions: vi.fn(async (_engine, days: string[]): Promise<RankRow[]> => {
      calls.push(days);
      return days.flatMap((date) => [
        { keyword: "a", date, position: dates.indexOf(date) + 1, url: "https://a.example/", frequency: 10, frequencyExact: 2 },
        ...(date === dates[0] ? [] : [{ keyword: "b", date, position: null, url: null }]),
      ]);
    }),
  };
  const clients: ClientFactory = async () => client;
  return { clients, calls };
}

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  await db.user.create({ data: { id: "u1", email: "u1@a.example" } });
  await db.site.create({ data: { id: "s1", userId: "u1", domain: "a.example" } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await db.externalRankEngine.deleteMany({});
  await db.externalRankEngine.create({
    data: { id: "e1", siteId: "s1", source: "labrika", externalSiteId: "uuid", externalEngineId: "41310", host: "a.example", engine: "Яндекс", region: "Москва (ПК)", device: "desktop" },
  });
});

describe("helpers", () => {
  it("fetches new days and the newest stored one again", () => {
    expect(daysToFetch(["2026-11-01", "2026-11-08", "2026-11-15"], [])).toEqual(["2026-11-01", "2026-11-08", "2026-11-15"]);
    expect(daysToFetch(["2026-11-01", "2026-11-08", "2026-11-15"], ["2026-11-01", "2026-11-08"])).toEqual([
      "2026-11-08",
      "2026-11-15",
    ]);
  });

  it("writes a keyword listed twice once per day and skips days not asked for", () => {
    const row = { keyword: "k", date: "2026-11-01", position: 3, url: null, frequency: 1, frequencyExact: 1 };
    expect(rankRows("e", [row, row], ["2026-11-01"])).toHaveLength(1);
    expect(rankRows("e", [row], ["2026-11-02"])).toEqual([]);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("syncRanksForSite", () => {
  it("backfills every check date in batches of 50, then fetches only new dates", async () => {
    const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    const first = fakeProvider(dates);
    const r1 = await syncRanksForSite(db, "s1", { clients: first.clients });
    expect(first.calls.map((c) => c.length)).toEqual([50, 10]);
    expect(r1).toEqual({ engines: 1, datesFetched: 60, rowsWritten: 60 + 59 });
    expect(await db.externalRank.count()).toBe(119);
    // A null position is stored as checked and not ranked; "b" has no row on the day it was not checked.
    expect(await db.externalRank.count({ where: { keyword: "b", position: null } })).toBe(59);
    expect((await db.externalRankEngine.findUniqueOrThrow({ where: { id: "e1" } })).lastSyncedAt).not.toBeNull();

    const next = fakeProvider([...dates, "2026-03-15"]);
    const r2 = await syncRanksForSite(db, "s1", { clients: next.clients });
    expect(next.calls).toEqual([[dates[59], "2026-03-15"]]);
    expect(r2.datesFetched).toBe(2);
    expect(await db.externalRank.count()).toBe(121);
  });

  it("is idempotent: the same answer twice leaves the same rows", async () => {
    const dates = ["2026-11-11", "2026-11-18"];
    await syncRanksForSite(db, "s1", { clients: fakeProvider(dates).clients });
    const before = await db.externalRank.findMany({ orderBy: [{ keyword: "asc" }, { date: "asc" }], omit: { id: true } });
    await syncRanksForSite(db, "s1", { clients: fakeProvider(dates).clients });
    const after = await db.externalRank.findMany({ orderBy: [{ keyword: "asc" }, { date: "asc" }], omit: { id: true } });
    expect(after).toEqual(before);
  });

  it("keeps the engines that answered when another fails, and fails permanently when all are gone", async () => {
    await db.externalRankEngine.create({
      data: { id: "e2", siteId: "s1", source: "labrika", externalSiteId: "uuid", externalEngineId: "999", host: "a.example", engine: "Яндекс", region: "СПб (ПК)", device: "desktop" },
    });
    const partly = await syncRanksForSite(db, "s1", { clients: fakeProvider(["2026-11-18"], { failEngine: "999" }).clients });
    expect(partly.engines).toBe(1);
    expect(partly.failed).toEqual(["Labrika Яндекс, СПб (ПК): engine gone"]);

    await db.externalRankEngine.delete({ where: { id: "e1" } });
    const err = await syncRanksForSite(db, "s1", { clients: fakeProvider(["2026-11-18"], { failEngine: "999" }).clients }).catch((e) => e);
    expect(err).toBeInstanceOf(RankSyncError);
    expect(err.permanent).toBe(true);
  });

  it("refuses a site with no linked engine", async () => {
    await db.externalRankEngine.deleteMany({});
    await expect(syncRanksForSite(db, "s1", { clients: fakeProvider([]).clients })).rejects.toThrow(/No rank provider engine/);
  });

  it("does not sync imported or pushed engines, and a missing key fails permanently", async () => {
    await db.externalRankEngine.create({
      data: { siteId: "s1", source: "import", externalSiteId: "csv", externalEngineId: "yandex|москва|desktop", host: "a.example", engine: "Яндекс", region: "Москва", device: "desktop" },
    });
    const fake = fakeProvider(["2026-11-18"]);
    const r = await syncRanksForSite(db, "s1", { clients: fake.clients });
    expect(r.engines).toBe(1);

    const noKey: ClientFactory = async () => {
      throw new RankKeyMissingError("Labrika");
    };
    const err = await syncRanksForSite(db, "s1", { clients: noKey }).catch((e) => e);
    expect(err).toBeInstanceOf(RankSyncError);
    expect(err.permanent).toBe(true);
  });
});
