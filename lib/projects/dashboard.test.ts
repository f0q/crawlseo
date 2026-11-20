import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// /api/projects (agency fork), the dashboard's routes as the signed-in user:
// members and their roles, the last owner, sites (only your own), deleting a
// project, and instance admins.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { seedApiFixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { handleDashboardProjects } from "./dashboard";
import { PDF } from "./test-files";

let t: TestDb;
let db: PrismaClient;
let uploads: string;

const A = { id: "user-a", email: "a@quilltab.app" };
const B = { id: "user-b", email: "b@quilltab.app" };
const C = { id: "user-c", email: "c@quilltab.app" };

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  await seedApiFixtures(db);
  await db.user.create({ data: C });
  uploads = await mkdtemp(join(tmpdir(), "crawlseo-uploads-"));
  process.env.UPLOADS_DIR = uploads;
}, 120_000);

afterAll(async () => {
  await t?.close();
  delete process.env.UPLOADS_DIR;
  await rm(uploads, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.CRAWLSEO_ADMIN_EMAILS;
});

type Json = Record<string, unknown> & { error?: string };

async function call(user: { id: string; email: string } | null, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handleDashboardProjects(user, new Request(`http://localhost/api/projects${path}`, init));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

describe("dashboard projects", () => {
  it("needs a signed-in user", async () => {
    expect((await call(null, "GET", "")).status).toBe(401);
  });

  it("an owner adds members by email; editors cannot", async () => {
    expect((await call(A, "POST", "/quilltab/members", { email: "nobody@quilltab.app", role: "viewer" })).body.error).toMatch(/signed in/);
    const added = await call(A, "POST", "/quilltab/members", { email: "C@quilltab.app", role: "editor" });
    expect(added.status).toBe(200);
    expect((added.body.members as { email: string; role: string }[]).find((m) => m.email === C.email)?.role).toBe("editor");
    const r = await call(C, "POST", "/quilltab/members", { email: B.email, role: "owner" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/editor; this needs owner/);
    // An editor sees the project's sites, but only the owner's own site is "yours".
    const seen = await call(C, "GET", "/quilltab");
    expect(seen.body.sites).toMatchObject([{ id: "site-a", yours: false }]);
  });

  it("keeps the last owner; a member can leave", async () => {
    expect((await call(A, "PATCH", "/quilltab/members/user-a", { role: "editor" })).status).toBe(409);
    expect((await call(A, "DELETE", "/quilltab/members/user-a")).body.error).toMatch(/at least one owner/);
    expect((await call(C, "DELETE", "/quilltab/members/user-c")).status).toBe(200);
    expect((await call(C, "GET", "/quilltab")).status).toBe(404);
  });

  it("links only your own sites, and unlinks them", async () => {
    await call(A, "POST", "/quilltab/members", { email: B.email, role: "editor" });
    const r = await call(B, "POST", "/quilltab/sites", { siteId: "site-a" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/owner of a site/);
    const own = await call(B, "POST", "/quilltab/sites", { siteId: "site-b" });
    expect((own.body.sites as { id: string }[]).map((s) => s.id).sort()).toEqual(["site-a", "site-b"]);
    expect((await call(B, "DELETE", "/quilltab/sites/site-b")).status).toBe(200);
    expect(await db.site.findUnique({ where: { id: "site-b" }, select: { projectId: true } })).toEqual({ projectId: null });
    await call(A, "DELETE", "/quilltab/members/user-b");
  });

  it("deletes a project with its files; its sites stay", async () => {
    const created = await call(A, "POST", "", { name: "Gone", slug: "gone", domains: ["gone-shop.com"] });
    expect(created.status).toBe(201);
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(PDF)], "x.pdf"));
    expect((await call(A, "POST", "/gone/files", fd)).status).toBe(201);
    const id = (await db.project.findUniqueOrThrow({ where: { slug: "gone" } })).id;
    expect(await readdir(join(uploads, id))).toHaveLength(1);

    expect((await call(B, "DELETE", "/gone")).status).toBe(404);
    expect((await call(A, "DELETE", "/gone")).status).toBe(200);
    expect(await db.project.count({ where: { slug: "gone" } })).toBe(0);
    expect(await db.site.findFirst({ where: { domain: "gone-shop.com" }, select: { projectId: true } })).toEqual({ projectId: null });
    await expect(readdir(join(uploads, id))).rejects.toThrow();
  });

  it("an instance admin sees and manages every project", async () => {
    expect((await call(C, "GET", "/secret-b")).status).toBe(404);
    process.env.CRAWLSEO_ADMIN_EMAILS = "admin@quilltab.app, c@quilltab.app";
    const list = (await call(C, "GET", "")).body.projects as { slug: string; role: string }[];
    expect(list.map((p) => [p.slug, p.role])).toEqual([["quilltab", "owner"], ["secret-b", "owner"]]);
    expect((await call(C, "PATCH", "/secret-b", { status: "paused" })).body.project).toMatchObject({ status: "paused" });
  });

  it("deletes notes, journal entries and tasks for editors", async () => {
    expect((await call(A, "DELETE", "/quilltab/tasks/task-a")).status).toBe(200);
    expect((await call(A, "DELETE", "/quilltab/tasks/task-a")).status).toBe(404);
    expect((await call(A, "DELETE", "/quilltab/journal/entry-a")).status).toBe(200);
    expect((await call(A, "DELETE", "/quilltab/notes/note-a")).status).toBe(200);
  });
});
