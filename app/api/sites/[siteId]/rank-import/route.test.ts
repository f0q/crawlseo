import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The CSV import route (agency fork) on PGlite: rows parsed in the browser go
// to one engine per search engine, region and device under source "import"
// and the label; importing the same file again leaves the same rows; another
// user's site reads as missing. The engine delete route removes an engine
// with its rows.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
const session = vi.hoisted(() => ({ userId: "u1" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { parseRankCsv } from "@/lib/rank-providers/csv";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { DELETE } from "../rank-engines/[engineId]/route";
import { POST } from "./route";

let t: TestDb;
let db: PrismaClient;

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  await db.user.createMany({ data: [{ id: "u1", email: "u1@a.example" }, { id: "u2", email: "u2@a.example" }] });
  await db.site.create({ data: { id: "s1", userId: "u1", domain: "a.example" } });
  await db.site.create({ data: { id: "s2", userId: "u2", domain: "b.example" } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const CSV = [
  "Запрос;Дата;Позиция;URL;ПС;Регион;Устройство",
  "a;2026-11-01;3;https://a.example/;Яндекс;Москва;ПК",
  "b;2026-11-01;-;;Яндекс;Москва;ПК",
  "a;2026-11-01;5;;Google;Москва;mobile",
].join("\n");

function importRows(siteId: string, body: unknown) {
  return POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ siteId }),
  });
}

describe("rank import", () => {
  it("splits rows by engine, and a second import of the same file changes nothing", async () => {
    const { rows, errors } = parseRankCsv(CSV);
    expect(errors).toEqual([]);
    const res = await importRows("s1", { label: "Topvisor export", rows });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rowsWritten: 3, engines: 2 });

    const engines = await db.externalRankEngine.findMany({ where: { siteId: "s1" }, orderBy: { engine: "asc" } });
    expect(engines.map((e) => [e.source, e.label, e.engine, e.device, e.externalEngineId])).toEqual([
      ["import", "Topvisor export", "Google", "mobile", "google|москва|mobile"],
      ["import", "Topvisor export", "Яндекс", "desktop", "yandex|москва|desktop"],
    ]);
    const before = await db.externalRank.findMany({ orderBy: [{ engineId: "asc" }, { keyword: "asc" }], omit: { id: true } });
    expect(before).toHaveLength(3);

    await importRows("s1", { label: "Topvisor export", rows });
    const after = await db.externalRank.findMany({ orderBy: [{ engineId: "asc" }, { keyword: "asc" }], omit: { id: true } });
    expect(after).toEqual(before);
  });

  it("refuses rows that fail the same checks as the browser, and another user's site", async () => {
    const bad = await importRows("s1", { label: "x", rows: [{ keyword: "k", date: "2026-11-01", position: -1, engine: "Яндекс" }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/position/);
    expect((await importRows("s1", { label: "", rows: parseRankCsv(CSV).rows })).status).toBe(400);
    expect((await importRows("s2", { label: "x", rows: parseRankCsv(CSV).rows })).status).toBe(404);
  });

  it("deletes an engine with its rows, only on the user's own site", async () => {
    const engine = await db.externalRankEngine.findFirstOrThrow({ where: { siteId: "s1", engine: "Google" } });
    const del = (siteId: string) =>
      DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ siteId, engineId: engine.id }) });
    expect((await del("s2")).status).toBe(404);
    expect((await del("s1")).status).toBe(200);
    expect(await db.externalRank.count({ where: { engineId: engine.id } })).toBe(0);
    expect((await del("s1")).status).toBe(404);
  });
});
