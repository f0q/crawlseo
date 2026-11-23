import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// /api/v1/projects (agency fork) on a real Prisma client (PGlite): roles from
// Membership, the write scope, validation (secrets in accessNotes), note
// versions, uploads and downloads, the journal, tasks and updatedSince.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { createAccessKey } from "@/lib/access-keys";
import { handleApiV1 } from "@/lib/api-v1/router";
import { seedApiFixtures, snapshotUserData, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { NOTE_HISTORY } from "./schema";
import { HTML, PDF } from "@/lib/testing/project-files";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;
let uploads: string;
const keys = { viewer: "", editor: "" };

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
  uploads = await mkdtemp(join(tmpdir(), "crawlseo-uploads-"));
  process.env.UPLOADS_DIR = uploads;
  for (const [id, role] of [["user-viewer", "viewer"], ["user-editor", "editor"]] as const) {
    await db.user.create({ data: { id, email: `${role}@quilltab.app` } });
    await db.userSettings.create({ data: { userId: id, mcpEnabled: true } });
    await db.membership.create({ data: { projectId: "proj-a", userId: id, role } });
    keys[role] = (await createAccessKey(db, id, "agent", "write")).key;
  }
}, 120_000);

afterAll(async () => {
  await t?.close();
  delete process.env.UPLOADS_DIR;
  await rm(uploads, { recursive: true, force: true });
});

beforeEach(() => {
  const g = globalThis as { crawlseoApiRateLimiter?: unknown; crawlseoApiWriteLimiter?: unknown };
  g.crawlseoApiRateLimiter = undefined;
  g.crawlseoApiWriteLimiter = undefined;
});

type Json = Record<string, unknown> & { error?: string };

async function call(method: string, path: string, key: string, body?: unknown): Promise<{ status: number; body: Json; res: Response }> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await handleApiV1(new Request(`http://localhost/api/v1${path}`, init));
  const isJson = res.headers.get("content-type")?.includes("json");
  return { status: res.status, body: isJson ? ((await res.clone().json()) as Json) : {}, res };
}
const get = (path: string, key = f.keyA) => call("GET", path, key);
const post = (path: string, body: unknown, key = f.keyAWrite) => call("POST", path, key, body);
const patch = (path: string, body: unknown, key = f.keyAWrite) => call("PATCH", path, key, body);

function form(name: string, bytes: Buffer, category?: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], name));
  if (category) fd.append("category", category);
  return fd;
}

describe("reading", () => {
  it("lists only the projects the key's user is a member of, with the role", async () => {
    const a = await get("/projects");
    expect(a.status).toBe(200);
    const projects = a.body.projects as { slug: string; role: string; sites: { domain: string }[]; openTasks: number; lastJournal: { text: string } }[];
    expect(projects.map((p) => [p.slug, p.role])).toEqual([["quilltab", "owner"]]);
    expect(projects[0].sites.map((s) => s.domain)).toEqual(["quilltab.app"]);
    expect(projects[0]).toMatchObject({ openTasks: 1, lastJournal: { text: "Audited the titles" } });
    expect(((await get("/projects", f.keyB)).body.projects as { slug: string }[]).map((p) => p.slug)).toEqual(["secret-b"]);
    expect(((await get("/projects", keys.viewer)).body.projects as { role: string }[])[0].role).toBe("viewer");
  });

  it("another user's project reads as not found, everywhere under it", async () => {
    for (const path of ["", "/notes", "/files", "/journal", "/tasks"]) {
      const r = await get(`/projects/secret-b${path}`);
      expect(r.status, path).toBe(404);
      expect(r.body.error).toBe("Project not found");
    }
    expect((await patch("/projects/secret-b", { name: "x" })).status).toBe(404);
  });

  it("a project: passport, role, sites and members", async () => {
    const r = await get("/projects/quilltab");
    expect(r.body.project).toMatchObject({ slug: "quilltab", name: "Quilltab", role: "owner", searchEngines: ["Google"] });
    expect(r.body.sites).toEqual([{ id: "site-a", domain: "quilltab.app", gscProperty: "sc-domain:quilltab.app", yours: true }]);
    expect((r.body.members as { email: string; role: string }[]).map((m) => m.role)).toEqual(["owner", "viewer", "editor"]);
  });

  it("refuses a bad updatedSince", async () => {
    expect((await get("/projects?updatedSince=yesterday")).status).toBe(400);
    expect((await get("/projects?updatedSince=2999-01-01")).body.projects).toEqual([]);
  });
});

describe("the write scope and roles", () => {
  it("a read-only key cannot write, and nothing changes", async () => {
    const before = await snapshotUserData(db);
    for (const [method, path] of [["POST", "/projects"], ["PATCH", "/projects/quilltab"], ["POST", "/projects/quilltab/notes"], ["POST", "/projects/quilltab/journal"]]) {
      const r = await call(method, path, f.keyA, { name: "x", title: "x", text: "x" });
      expect(r.status, path).toBe(403);
      expect(r.body.error).toMatch(/read-only/);
    }
    expect(await snapshotUserData(db)).toBe(before);
  });

  it("a viewer reads but cannot write", async () => {
    expect((await get("/projects/quilltab/notes", keys.viewer)).status).toBe(200);
    const r = await patch("/projects/quilltab", { name: "Renamed" }, keys.viewer);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/viewer; this needs editor/);
    expect((await post("/projects/quilltab/files", form("a.pdf", PDF), keys.viewer)).status).toBe(403);
  });

  it("an editor edits the passport; DELETE is not part of the API", async () => {
    const r = await patch("/projects/quilltab", { cms: "WordPress", testUrl: "https://test.quilltab.app/" }, keys.editor);
    expect(r.status).toBe(200);
    expect(r.body.project).toMatchObject({ cms: "WordPress", testUrl: "https://test.quilltab.app/", role: "editor" });
    expect((await call("DELETE", "/projects/quilltab", keys.editor)).status).toBe(405);
  });
});

describe("a billing key (a CRM)", () => {
  it("reads the projects and sets only the payment dates; everything else is refused", async () => {
    const billing = (await createAccessKey(db, "user-a", "crm", "billing")).key;
    expect((await get("/projects", billing)).status).toBe(200);
    expect((await get("/projects/quilltab", billing)).status).toBe(200);
    const ok = await patch("/projects/quilltab", { paidUntil: "2026-12-15", contractEnd: "2027-11-14", billingNeverPause: false }, billing);
    expect(ok.status).toBe(200);
    expect(ok.body.project).toMatchObject({ paidUntil: expect.stringMatching(/^2026-12-15/), contractEnd: expect.stringMatching(/^2027-11-14/) });

    const before = await snapshotUserData(db);
    for (const [method, path, body] of [
      ["PATCH", "/projects/quilltab", { paidUntil: "2026-12-31", name: "Renamed" }],
      ["PATCH", "/projects/quilltab", {}],
      ["POST", "/projects", { name: "New" }],
      ["POST", "/projects/quilltab/journal", { text: "x" }],
      ["GET", "/projects/quilltab/notes", undefined],
      ["GET", "/projects/_groups", undefined],
      ["GET", "/sites", undefined],
      ["GET", "/sites/site-a/traffic", undefined],
      ["GET", "/key", undefined],
      ["POST", "/projects/quilltab/sites", { domains: ["new.example.com"] }],
    ] as const) {
      const r = await call(method, path, billing, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.error).toMatch(/only reads the project list/);
    }
    expect(await snapshotUserData(db)).toBe(before);
  });
});

describe("sites of a project through the API", () => {
  it("an editor adds a domain and takes a site out; a viewer and a read-only key cannot", async () => {
    expect((await post("/projects/quilltab/sites", { domains: ["shop.quilltab-api.com"] }, keys.viewer)).status).toBe(403);
    expect((await call("POST", "/projects/quilltab/sites", f.keyA, { domains: ["shop.quilltab-api.com"] })).status).toBe(403);
    const added = await post("/projects/quilltab/sites", { domains: ["shop.quilltab-api.com"] });
    expect(added.status).toBe(200);
    const site = (added.body.sites as { id: string; domain: string }[]).find((s) => s.domain === "shop.quilltab-api.com");
    expect(site).toBeDefined();
    const removed = await call("DELETE", `/projects/quilltab/sites/${site!.id}`, f.keyAWrite);
    expect(removed.status).toBe(200);
    expect((removed.body.sites as { id: string }[]).map((s) => s.id)).not.toContain(site!.id);
    expect(await db.site.findUnique({ where: { id: site!.id }, select: { projectId: true } })).toEqual({ projectId: null });
    // Moved into the project again by id.
    expect((await post("/projects/quilltab/sites", { siteId: site!.id })).status).toBe(200);
  });
});

describe("creating a project", () => {
  it("creates it with the caller as owner and adds the domains as their sites", async () => {
    const r = await post("/projects", { name: "Acme Shop", status: "prospect", domains: ["https://www.acme-shop.com/", "quilltab.app"] });
    expect(r.status).toBe(409); // quilltab.app is already in project quilltab
    const ok = await post("/projects", { name: "Acme Shop", status: "prospect", domains: ["https://www.acme-shop.com/"], searchEngines: ["Yandex"] });
    expect(ok.status).toBe(201);
    expect(ok.body.project).toMatchObject({ slug: "acme-shop", status: "prospect", role: "owner" });
    expect(ok.body.sites).toMatchObject([{ domain: "www.acme-shop.com", yours: true }]);
    const site = await db.site.findFirst({ where: { domain: "www.acme-shop.com" } });
    expect(site).toMatchObject({ userId: "user-a", gscProperty: null });
    expect(await db.alert.count({ where: { siteId: site!.id } })).toBeGreaterThan(0);
    expect((await post("/projects", { name: "Acme Shop" })).status).toBe(409);
  });

  it("validates: slug, domains, URLs and secrets in accessNotes", async () => {
    expect((await post("/projects", { name: "Bad", slug: "Bad Slug!" })).body.error).toMatch(/slug must be/);
    expect((await post("/projects", { name: "Клиент" })).body.error).toMatch(/Give the project a slug/);
    expect((await post("/projects", { name: "Local", domains: ["localhost"] })).body.error).toMatch(/not a public domain/);
    expect((await post("/projects", { name: "Url", testUrl: "javascript:alert(1)" })).body.error).toMatch(/testUrl: Must be an http/);
    const secret = await post("/projects", { name: "Leaky", accessNotes: "FTP password: Qw3rty!2026" });
    expect(secret.status).toBe(400);
    expect(secret.body.error).toMatch(/^accessNotes: Access notes look like they contain a secret \(a value after "password"\)/);
    expect((await patch("/projects/quilltab", { accessNotes: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" })).body.error).toMatch(/GitHub token/);
    expect(await db.project.count({ where: { slug: { in: ["leaky", "bad", "url", "local"] } } })).toBe(0);
  });
});

describe("notes", () => {
  it("upserts by kind and title and keeps the versions before", async () => {
    const created = await post("/projects/quilltab/notes", { kind: "audience", title: "Audience", body: "v1" });
    expect(created.status).toBe(201);
    const id = (created.body.note as { id: string }).id;
    const same = await post("/projects/quilltab/notes", { kind: "audience", title: "Audience", body: "v1" });
    expect(same.body).toMatchObject({ changed: false, created: false, note: { version: 1 } });
    const v2 = await post("/projects/quilltab/notes", { kind: "audience", title: "Audience", body: "v2", baseVersion: 1 }, keys.editor);
    expect(v2.body).toMatchObject({ changed: true, note: { version: 2, body: "v2", updatedBy: "editor@quilltab.app (key agent)" } });
    const stale = await patch(`/projects/quilltab/notes/${id}`, { body: "v3", baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/now version 2/);
    const history = await get(`/projects/quilltab/notes/${id}`);
    expect((history.body.note as { versions: { version: number; body: string }[] }).versions).toMatchObject([{ version: 1, body: "v1" }]);
  });

  it("keeps the last versions only", async () => {
    const id = (await post("/projects/quilltab/notes", { kind: "strategy", title: "Plan", body: "0" })).body.note as { id: string };
    for (let i = 1; i <= NOTE_HISTORY + 3; i++) {
      (globalThis as { crawlseoApiWriteLimiter?: unknown }).crawlseoApiWriteLimiter = undefined;
      expect((await patch(`/projects/quilltab/notes/${id.id}`, { body: String(i) })).status).toBe(200);
    }
    const note = (await get(`/projects/quilltab/notes/${id.id}`)).body.note as { version: number; versions: { version: number }[] };
    expect(note.version).toBe(NOTE_HISTORY + 4);
    expect(note.versions).toHaveLength(NOTE_HISTORY);
    expect(note.versions[0].version).toBe(NOTE_HISTORY + 3);
    expect(await db.projectNoteVersion.count({ where: { noteId: id.id } })).toBe(NOTE_HISTORY);
    expect(((await get(`/projects/quilltab/notes/${id.id}?history=2`)).body.note as { versions: unknown[] }).versions).toHaveLength(2);
  });

  it("updatedSince returns what changed since then", async () => {
    const mark = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await post("/projects/quilltab/notes", { kind: "chat", title: "Telegram", body: "hello" });
    const notes = (await get(`/projects/quilltab/notes?updatedSince=${encodeURIComponent(mark)}`)).body.notes as { title: string }[];
    expect(notes.map((n) => n.title)).toEqual(["Telegram"]);
    const projects = (await get(`/projects?updatedSince=${encodeURIComponent(mark)}`)).body.projects as { slug: string }[];
    expect(projects.map((p) => p.slug)).toEqual(["quilltab"]);
    expect((await get("/projects/quilltab/notes?kind=nope")).status).toBe(400);
  });
});

describe("files", () => {
  it("uploads, lists and downloads for members only, as an attachment", async () => {
    const up = await post("/projects/quilltab/files", form("Бриф.pdf", PDF, "chat"), keys.editor);
    expect(up.status).toBe(201);
    const file = up.body.file as { id: string; name: string; type: string; size: number; category: string };
    expect(file).toMatchObject({ name: "Бриф.pdf", type: "pdf", size: PDF.length, category: "chat" });
    expect(((await get("/projects/quilltab/files", keys.viewer)).body.files as { id: string }[]).map((x) => x.id)).toContain(file.id);

    const dl = await get(`/projects/quilltab/files/${file.id}`, keys.viewer);
    expect(dl.status).toBe(200);
    expect(dl.res.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(dl.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.res.headers.get("x-ratelimit-limit")).toBeTruthy();
    expect(Buffer.from(await dl.res.arrayBuffer()).equals(PDF)).toBe(true);

    expect((await get(`/projects/quilltab/files/${file.id}`, f.keyB)).status).toBe(404);
    expect((await get(`/projects/secret-b/files/${file.id}`, f.keyB)).status).toBe(404);
  });

  it("refuses HTML, a type mismatch and a missing file field", async () => {
    expect((await post("/projects/quilltab/files", form("x.html", HTML))).body.error).toMatch(/not accepted/);
    expect((await post("/projects/quilltab/files", form("x.pdf", HTML))).body.error).toMatch(/not a pdf file/);
    expect((await post("/projects/quilltab/files", new FormData())).body.error).toMatch(/multipart/);
    expect((await post("/projects/quilltab/files", { file: "x" })).body.error).toMatch(/multipart/);
  });
});

describe("journal and tasks", () => {
  it("adds an entry once, with the key as the agent author", async () => {
    // Today: newer than the fixture's entry two days ago, whatever day the test runs.
    const today = new Date().toISOString().slice(0, 10);
    const entry = { date: today, text: "Published llms.txt", link: "https://quilltab.app/llms.txt", siteId: "site-a" };
    const first = await post("/projects/quilltab/journal", entry, keys.editor);
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({ date: today, authorKind: "agent", author: "editor@quilltab.app (key agent)" });
    expect((await post("/projects/quilltab/journal", entry, keys.editor)).body).toMatchObject({ created: false });
    expect((await post("/projects/quilltab/journal", { text: "x", siteId: "site-b" })).body.error).toMatch(/not a site of this project/);
    expect((await post("/projects/quilltab/journal", { text: "x", date: "2026-02-30" })).body.error).toMatch(/YYYY-MM-DD/);
    const list = (await get("/projects/quilltab/journal?limit=1")).body.entries as { text: string }[];
    expect(list.map((e) => e.text)).toEqual(["Published llms.txt"]);
  });

  it("upserts tasks by externalKey and filters by status", async () => {
    const a = await post("/projects/quilltab/tasks", { externalKey: "t1", title: "Fix titles", status: "doing", due: "2026-12-01" });
    expect(a.body).toMatchObject({ created: false, task: { id: "task-a", status: "doing", due: "2026-12-01" } });
    const b = await post("/projects/quilltab/tasks", { externalKey: "t2", title: "Schema", priority: "high" });
    expect(b.status).toBe(201);
    expect(b.body.task).toMatchObject({ status: "todo", priority: "high" });
    const id = (b.body.task as { id: string }).id;
    expect((await patch(`/projects/quilltab/tasks/${id}`, { status: "done", due: null })).body.task).toMatchObject({ status: "done", due: null });
    expect(((await get("/projects/quilltab/tasks?status=done")).body.tasks as { id: string }[]).map((x) => x.id)).toEqual([id]);
    expect((await post("/projects/quilltab/tasks", { title: "x", status: "blocked" })).status).toBe(400);
  });
});
