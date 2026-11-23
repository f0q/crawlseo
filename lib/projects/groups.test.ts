import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Project groups (agency fork) on PGlite: the group list with counts, rename
// (and merging into an existing group), ungroup and assign, only on the
// projects the actor owns or edits; the dashboard and /api/v1 routes.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { createAccessKey } from "@/lib/access-keys";
import { handleApiV1 } from "@/lib/api-v1/router";
import { seedApiFixtures, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import type { Actor } from "./access";
import { handleDashboardProjects } from "./dashboard";
import { assignGroup, listGroupSummaries, renameGroup, ungroupGroup } from "./groups";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;
let readKey = "";

const actor = (id: string): Actor => ({ userId: id, email: `${id}@quilltab.app`, kind: "human", label: id });
const A = actor("user-a");
const B = actor("user-b");

/** user-a owns g-a1..g-a3, edits g-e, only views g-v; user-b owns g-b (unseen by A) and g-v. */
const PROJECTS: { id: string; owner: string; extra?: { userId: string; role: string } }[] = [
  { id: "g-a1", owner: "user-a" },
  { id: "g-a2", owner: "user-a" },
  { id: "g-a3", owner: "user-a" },
  { id: "g-e", owner: "user-b", extra: { userId: "user-a", role: "editor" } },
  { id: "g-v", owner: "user-b", extra: { userId: "user-a", role: "viewer" } },
  { id: "g-b", owner: "user-b" },
];

async function setGroups(groups: Record<string, string | null>) {
  for (const [id, group] of Object.entries(groups)) await db.project.update({ where: { id }, data: { group } });
}
const groupOf = async (id: string) => (await db.project.findUniqueOrThrow({ where: { id }, select: { group: true } })).group;

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
  readKey = f.keyA;
  for (const p of PROJECTS) {
    await db.project.create({
      data: {
        id: p.id,
        slug: p.id,
        name: `Project ${p.id}`,
        ownerId: p.owner,
        members: { create: [{ userId: p.owner, role: "owner" }, ...(p.extra ? [p.extra] : [])] },
      },
    });
  }
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  const g = globalThis as { crawlseoApiRateLimiter?: unknown; crawlseoApiWriteLimiter?: unknown };
  g.crawlseoApiRateLimiter = undefined;
  g.crawlseoApiWriteLimiter = undefined;
  await setGroups({ "g-a1": "Centro Adelante", "g-a2": "Centro Adelante", "g-a3": "Other", "g-e": "Centro Adelante", "g-v": "Centro Adelante", "g-b": "Centro Adelante" });
  await db.project.update({ where: { id: "proj-a" }, data: { group: null } });
});

describe("listGroupSummaries", () => {
  it("counts the projects the actor sees and the ones they may change", async () => {
    expect(await listGroupSummaries(A)).toEqual([
      { name: "Centro Adelante", count: 4, editable: 3 },
      { name: "Other", count: 1, editable: 1 },
    ]);
    // user-b sees g-e, g-v and g-b.
    expect(await listGroupSummaries(B)).toEqual([{ name: "Centro Adelante", count: 3, editable: 3 }]);
  });

  it("joins spellings that differ in case or spacing, named by the most used one", async () => {
    await setGroups({ "g-a3": "centro  adelante" });
    expect(await listGroupSummaries(A)).toEqual([{ name: "Centro Adelante", count: 5, editable: 4 }]);
  });
});

describe("renameGroup", () => {
  it("renames only the projects the actor owns or edits; a viewer's and other users' projects keep the group", async () => {
    const before = await db.project.findUniqueOrThrow({ where: { id: "g-a1" }, select: { updatedAt: true } });
    const r = await renameGroup(A, { from: " centro adelante ", to: "  Adelante  Group " });
    expect(r).toEqual({ group: "Adelante Group", renamed: 3, skipped: 1, merged: false });
    expect(await groupOf("g-a1")).toBe("Adelante Group");
    expect(await groupOf("g-a2")).toBe("Adelante Group");
    expect(await groupOf("g-e")).toBe("Adelante Group");
    expect(await groupOf("g-v")).toBe("Centro Adelante");
    expect(await groupOf("g-b")).toBe("Centro Adelante");
    // The agent sync sees the change.
    const after = await db.project.findUniqueOrThrow({ where: { id: "g-a1" }, select: { updatedAt: true } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("merges into an existing group, with that group's spelling", async () => {
    const r = await renameGroup(A, { from: "Other", to: "CENTRO adelante" });
    expect(r).toEqual({ group: "Centro Adelante", renamed: 1, skipped: 0, merged: true });
    expect(await groupOf("g-a3")).toBe("Centro Adelante");
  });

  it("keeps a new spelling of the same name", async () => {
    const r = await renameGroup(A, { from: "Other", to: "OTHER" });
    expect(r).toMatchObject({ group: "OTHER", merged: false });
  });

  it("refuses a viewer, an unknown group and an empty name", async () => {
    await setGroups({ "g-a1": null, "g-a2": null, "g-e": null });
    await expect(renameGroup(A, { from: "Centro Adelante", to: "X" })).rejects.toMatchObject({ status: 403 });
    expect(await groupOf("g-v")).toBe("Centro Adelante");
    await expect(renameGroup(A, { from: "Nope", to: "X" })).rejects.toMatchObject({ status: 404 });
    await expect(renameGroup(A, { from: "Other", to: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(renameGroup(A, { from: "Other", to: "x".repeat(81) })).rejects.toMatchObject({ status: 400 });
  });
});

describe("ungroupGroup", () => {
  it("takes the actor's editable projects out of the group, the rest stays", async () => {
    expect(await ungroupGroup(A, { name: "centro adelante" })).toEqual({ ungrouped: 3, skipped: 1 });
    expect(await groupOf("g-a1")).toBeNull();
    expect(await groupOf("g-e")).toBeNull();
    expect(await groupOf("g-v")).toBe("Centro Adelante");
    expect(await groupOf("g-b")).toBe("Centro Adelante");
    expect(await groupOf("g-a3")).toBe("Other");
  });
});

describe("assignGroup", () => {
  it("moves projects into a new group, or an existing one by any spelling", async () => {
    expect(await assignGroup(A, { name: "New One", slugs: ["g-a1", "quilltab"] })).toEqual({ group: "New One", moved: 2 });
    expect(await groupOf("proj-a")).toBe("New One");
    expect(await assignGroup(A, { name: "other", slugs: ["g-a2"] })).toEqual({ group: "Other", moved: 1 });
  });

  it("is all or nothing: a viewer's project refuses the whole move", async () => {
    await expect(assignGroup(A, { name: "Mine", slugs: ["g-a1", "g-v"] })).rejects.toMatchObject({ status: 403 });
    await expect(assignGroup(A, { name: "Mine", slugs: ["g-a1", "g-b"] })).rejects.toMatchObject({ status: 404 });
    expect(await groupOf("g-a1")).toBe("Centro Adelante");
    await expect(assignGroup(A, { name: "Mine", slugs: [] })).rejects.toMatchObject({ status: 400 });
  });
});

type Json = Record<string, unknown> & { error?: string };

async function dashboard(user: { id: string; email: string } | null, method: string, path: string, body?: unknown) {
  const req = new Request(`http://localhost/api/projects${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  const res = await handleDashboardProjects(user, req);
  return { status: res.status, body: (await res.json()) as Json };
}

async function api(method: string, path: string, key: string, body?: unknown) {
  const res = await handleApiV1(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

describe("routes", () => {
  const userA = { id: "user-a", email: "user-a@quilltab.app" };

  it("dashboard: lists, renames and ungroups as the signed-in user", async () => {
    const list = await dashboard(userA, "GET", "/_groups");
    expect(list.status).toBe(200);
    expect(list.body.groups).toEqual([
      { name: "Centro Adelante", count: 4, editable: 3 },
      { name: "Other", count: 1, editable: 1 },
    ]);
    const renamed = await dashboard(userA, "POST", "/_groups/rename", { from: "Other", to: "Centro Adelante" });
    expect(renamed).toEqual({ status: 200, body: { group: "Centro Adelante", renamed: 1, skipped: 0, merged: true } });
    const ungrouped = await dashboard(userA, "POST", "/_groups/ungroup", { name: "Centro Adelante" });
    expect(ungrouped).toEqual({ status: 200, body: { ungrouped: 4, skipped: 1 } });
    const assigned = await dashboard(userA, "POST", "/_groups/assign", { name: "Again", slugs: ["g-a1"] });
    expect(assigned).toEqual({ status: 200, body: { group: "Again", moved: 1 } });
  });

  it("dashboard: refuses without a session, other methods and unknown actions", async () => {
    expect((await dashboard(null, "GET", "/_groups")).status).toBe(401);
    expect((await dashboard(userA, "POST", "/_groups")).status).toBe(405);
    expect((await dashboard(userA, "GET", "/_groups/rename")).status).toBe(405);
    expect((await dashboard(userA, "POST", "/_groups/constructor", {})).status).toBe(404);
    expect((await dashboard(userA, "POST", "/_groups/rename/x", {})).status).toBe(404);
    const bad = await dashboard(userA, "POST", "/_groups/rename", { from: "Other" });
    expect(bad.status).toBe(400);
  });

  it("/api/v1: reads with any key, changes only with a write-scoped key", async () => {
    const list = await api("GET", "/projects/_groups", readKey);
    expect(list.status).toBe(200);
    expect((list.body.groups as unknown[]).length).toBe(2);
    const refused = await api("POST", "/projects/_groups/ungroup", readKey, { name: "Other" });
    expect(refused.status).toBe(403);
    expect(await groupOf("g-a3")).toBe("Other");
    const done = await api("POST", "/projects/_groups/rename", f.keyAWrite, { from: "Other", to: "Renamed" });
    expect(done).toEqual({ status: 200, body: { group: "Renamed", renamed: 1, skipped: 0, merged: false } });
    // user-b's key: its own projects only.
    const bKey = (await createAccessKey(db, "user-b", "b-agent", "write")).key;
    const b = await api("POST", "/projects/_groups/ungroup", bKey, { name: "Centro Adelante" });
    expect(b).toEqual({ status: 200, body: { ungrouped: 3, skipped: 0 } });
    expect(await groupOf("g-a1")).toBe("Centro Adelante");
  });
});
