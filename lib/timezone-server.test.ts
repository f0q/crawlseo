import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Agency fork: the display time zone setting on a real Prisma client (PGlite), with the migration's default.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null, user: null as { id: string } | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});
vi.mock("@/lib/auth", () => ({ auth: async () => (holder.user ? { user: holder.user } : null) }));

import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { getDisplayTimeZone, readTimeZone, saveTimeZone } from "./timezone-server";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  holder.db = t.db;
  await t.db.user.create({ data: { id: "u1", email: "u1@quilltab.app" } });
  await t.db.user.create({ data: { id: "u2", email: "u2@quilltab.app" } });
  // A settings row from before the migration's column: it gets the default.
  await t.db.userSettings.create({ data: { userId: "u2", mcpEnabled: true } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe("display time zone setting", () => {
  it("defaults to Asia/Makassar with or without a settings row", async () => {
    expect(await readTimeZone(t.db, "u1")).toBe("Asia/Makassar");
    expect(await readTimeZone(t.db, "u2")).toBe("Asia/Makassar");
    expect((await t.db.userSettings.findUnique({ where: { userId: "u2" } }))?.timeZone).toBe("Asia/Makassar");
  });

  it("saves only IANA zones and keeps the other settings", async () => {
    expect(await saveTimeZone(t.db, "u2", "Mars/Olympus")).toBe(false);
    expect(await saveTimeZone(t.db, "u2", "Europe/Moscow")).toBe(true);
    expect(await saveTimeZone(t.db, "u1", "UTC")).toBe(true);
    expect(await readTimeZone(t.db, "u2")).toBe("Europe/Moscow");
    expect(await readTimeZone(t.db, "u1")).toBe("UTC");
    expect((await t.db.userSettings.findUnique({ where: { userId: "u2" } }))?.mcpEnabled).toBe(true);
  });

  it("reads the zone of the signed-in user, the default when signed out", async () => {
    holder.user = { id: "u2" };
    expect(await getDisplayTimeZone()).toBe("Europe/Moscow");
    holder.user = null;
    expect(await getDisplayTimeZone()).toBe("Asia/Makassar");
  });
});
