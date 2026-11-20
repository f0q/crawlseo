import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import type { LabrikaSite } from "./labrika-parse";
import { LabrikaLinkError, linkedEngines, parseEngineRefs, setLinkedEngines } from "./links";

let t: TestDb;
let db: PrismaClient;

const available: LabrikaSite[] = [
  {
    siteUuid: "uuid-a",
    host: "a.example",
    title: "a.example",
    engines: [
      { id: "1", engine: "Яндекс", region: "Москва (ПК)", device: "desktop" },
      { id: "2", engine: "Яндекс", region: "Москва (mobile)", device: "mobile" },
    ],
  },
];

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
    expect(await setLinkedEngines(db, "s1", [{ siteUuid: "uuid-a", engineId: "1" }], available)).toEqual({ added: 1, removed: 0 });
    const [first] = await linkedEngines(db, "s1");
    expect(first).toMatchObject({ label: "Яндекс, Москва (ПК)", host: "a.example", externalEngineId: "1" });
    await db.externalRank.create({ data: { engineId: first.id, keyword: "k", date: new Date("2026-11-18T00:00:00Z"), position: 3 } });

    const swap = await setLinkedEngines(db, "s1", [{ siteUuid: "uuid-a", engineId: "2" }], available);
    expect(swap).toEqual({ added: 1, removed: 1 });
    expect((await linkedEngines(db, "s1")).map((e) => e.externalEngineId)).toEqual(["2"]);
    expect(await db.externalRank.count()).toBe(0);

    // Saving the same set again adds nothing, so no sync is queued.
    expect(await setLinkedEngines(db, "s1", [{ siteUuid: "uuid-a", engineId: "2" }], available)).toEqual({ added: 0, removed: 0 });
  });

  it("refuses an engine the account cannot see", async () => {
    await expect(setLinkedEngines(db, "s1", [{ siteUuid: "uuid-x", engineId: "1" }], available)).rejects.toBeInstanceOf(
      LabrikaLinkError
    );
  });
});

describe("parseEngineRefs", () => {
  it("takes numeric engine ids and refuses anything else", () => {
    expect(parseEngineRefs([{ siteUuid: "u", engineId: 41310 }])).toEqual([{ siteUuid: "u", engineId: "41310" }]);
    expect(parseEngineRefs([{ siteUuid: "", engineId: "1" }])).toBeNull();
    expect(parseEngineRefs("x")).toBeNull();
  });
});
