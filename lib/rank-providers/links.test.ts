import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import type { RankProjectWithEngines } from "./types";
import { linkedEngines, parseEngineRefs, RankLinkError, setLinkedEngines } from "./links";

let t: TestDb;
let db: PrismaClient;

const available: RankProjectWithEngines[] = [
  {
    externalSiteId: "uuid-a",
    host: "a.example",
    title: "a.example",
    engines: [
      { externalEngineId: "1", engine: "Яндекс", region: "Москва (ПК)", device: "desktop" },
      { externalEngineId: "2", engine: "Яндекс", region: "Москва (mobile)", device: "mobile" },
    ],
  },
];

const ref = (externalSiteId: string, externalEngineId: string) => [{ externalSiteId, externalEngineId }];

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  await db.user.create({ data: { id: "u1", email: "u1@a.example" } });
  await db.site.create({ data: { id: "s1", userId: "u1", domain: "a.example" } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe("setLinkedEngines", () => {
  it("links new engines, unlinks dropped ones with their positions, and counts what is new", async () => {
    expect(await setLinkedEngines(db, "s1", "labrika", ref("uuid-a", "1"), available)).toEqual({ added: 1, removed: 0 });
    const [first] = await linkedEngines(db, "s1");
    expect(first).toMatchObject({
      label: "Яндекс, Москва (ПК)",
      host: "a.example",
      externalEngineId: "1",
      source: "labrika",
      sourceName: "Labrika",
      synced: true,
      matchKey: "yandex|москва|desktop",
    });
    await db.externalRank.create({ data: { engineId: first.id, keyword: "k", date: new Date("2026-11-18T00:00:00Z"), position: 3 } });

    const swap = await setLinkedEngines(db, "s1", "labrika", ref("uuid-a", "2"), available);
    expect(swap).toEqual({ added: 1, removed: 1 });
    expect((await linkedEngines(db, "s1")).map((e) => e.externalEngineId)).toEqual(["2"]);
    expect(await db.externalRank.count()).toBe(0);

    // Saving the same set again adds nothing, so no sync is queued.
    expect(await setLinkedEngines(db, "s1", "labrika", ref("uuid-a", "2"), available)).toEqual({ added: 0, removed: 0 });
  });

  it("leaves engines of other sources alone", async () => {
    await db.externalRankEngine.create({
      data: { siteId: "s1", source: "import", externalSiteId: "csv", externalEngineId: "yandex|москва|desktop", host: "a.example", engine: "Яндекс", region: "Москва", device: "desktop", label: "csv" },
    });
    await setLinkedEngines(db, "s1", "labrika", [], available);
    expect((await linkedEngines(db, "s1")).map((e) => e.source)).toEqual(["import"]);
    expect(await linkedEngines(db, "s1", { source: "labrika" })).toEqual([]);
  });

  it("refuses an unknown provider", async () => {
    await expect(setLinkedEngines(db, "s1", "nope", [], available)).rejects.toBeInstanceOf(RankLinkError);
  });

  it("refuses an engine the account cannot see", async () => {
    await expect(setLinkedEngines(db, "s1", "labrika", ref("uuid-x", "1"), available)).rejects.toBeInstanceOf(
      RankLinkError
    );
  });
});

describe("parseEngineRefs", () => {
  it("takes numeric engine ids and refuses anything else", () => {
    expect(parseEngineRefs([{ externalSiteId: "u", externalEngineId: 41310 }])).toEqual([{ externalSiteId: "u", externalEngineId: "41310" }]);
    expect(parseEngineRefs([{ externalSiteId: "", externalEngineId: "1" }])).toBeNull();
    expect(parseEngineRefs("x")).toBeNull();
  });
});
