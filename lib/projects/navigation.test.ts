import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// UX step 1 (agency fork): the project group in the API, the sidebar's
// project switcher and the project Overview, on a real Prisma client (PGlite).

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1 } from "@/lib/api-v1/router";
import { daysAgo, seedApiFixtures, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import type { Actor } from "./access";
import { groupProjects, switcherView, type ProjectNav } from "./navigation";
import { isServiceEntry, projectOverview } from "./overview";
import { loadProjectNav, loadShellExtras } from "./shell";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;

const userA: Actor = { userId: "user-a", email: "a@quilltab.app", kind: "human", label: "a@quilltab.app" };
const viewer: Actor = { userId: "user-v", email: "v@quilltab.app", kind: "human", label: "v@quilltab.app" };

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
  await db.user.create({ data: { id: "user-v", email: "v@quilltab.app" } });
  await db.membership.create({ data: { projectId: "proj-a", userId: "user-v", role: "viewer" } });
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
async function call(method: string, path: string, key: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handleApiV1(new Request(`http://localhost/api/v1${path}`, init));
  return { status: res.status, body: (await res.json()) as Json };
}

describe("project group in /api/v1", () => {
  it("is null by default and listed with every project", async () => {
    const r = await call("GET", "/projects", f.keyA);
    expect(r.status).toBe(200);
    const projects = r.body.projects as { slug: string; group: string | null }[];
    expect(projects.find((p) => p.slug === "quilltab")).toMatchObject({ group: null });
  });

  it("is set on create, changed and cleared with PATCH, and validated", async () => {
    const created = await call("POST", "/projects", f.keyAWrite, { name: "Centro Italica", group: "  Centro Adelante  " });
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({ slug: "centro-italica", group: "Centro Adelante" });

    const listed = await call("GET", "/projects", f.keyA);
    expect((listed.body.projects as { slug: string; group: string | null }[]).find((p) => p.slug === "centro-italica")?.group).toBe("Centro Adelante");

    const renamed = await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: "Adelante" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project).toMatchObject({ group: "Adelante", name: "Centro Italica" });

    // A PATCH without group keeps it.
    expect((await call("PATCH", "/projects/centro-italica", f.keyAWrite, { geo: "Moscow" })).body.project).toMatchObject({ group: "Adelante", geo: "Moscow" });

    expect((await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: "" })).body.project).toMatchObject({ group: null });
    await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: "Adelante" });
    expect((await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: null })).body.project).toMatchObject({ group: null });

    const tooLong = await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: "x".repeat(81) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/^group:/);

    // A read-only key cannot change it.
    expect((await call("PATCH", "/projects/centro-italica", f.keyA, { group: "Nope" })).status).toBe(403);
    await call("PATCH", "/projects/centro-italica", f.keyAWrite, { group: "Adelante" });
  });
});

describe("groupProjects", () => {
  it("puts named groups in alphabetical order, the ungrouped first, clients before prospects inside a group", () => {
    const p = (name: string, status: string, group: string | null) => ({ name, status, group });
    const groups = groupProjects([
      p("Zen", "prospect", null),
      p("Market", "prospect", "Centro Adelante"),
      p("Italica", "client", "Centro Adelante"),
      p("Acme", "archived", null),
      p("Sneaker", "client", "beta"),
      p("Flexique", "client", " Centro Adelante "),
    ]);
    expect(groups.map((g) => g.name)).toEqual([null, "beta", "Centro Adelante"]);
    expect(groups[2].projects.map((x) => x.name)).toEqual(["Flexique", "Italica", "Market"]);
    expect(groups[0].projects.map((x) => x.name)).toEqual(["Zen", "Acme"]);
  });
});

describe("the project switcher", () => {
  it("loads the actor's projects by group with only their own sites, and their sites outside every project", async () => {
    await db.site.create({ data: { id: "site-orphan", userId: "user-a", domain: "orphan.example" } });
    const nav = await loadProjectNav(userA);
    expect(nav.groups.map((g) => [g.name, g.projects.map((p) => p.slug)])).toEqual([
      [null, ["quilltab"]],
      ["Adelante", ["centro-italica"]],
    ]);
    expect(nav.groups[0].projects[0].sites).toEqual([{ id: "site-a", domain: "quilltab.app" }]);
    expect(nav.groups[0].projects[0].canEdit).toBe(true);
    expect(nav.unassigned).toEqual([{ id: "site-orphan", domain: "orphan.example" }]);
    // Never another user's project or site.
    expect(JSON.stringify(nav)).not.toMatch(/secret/);

    // A viewer sees the project, not user A's site in it (only the owner opens a site).
    const v = await loadProjectNav(viewer);
    expect(v.groups.flatMap((g) => g.projects).map((p) => [p.slug, p.sites.length, p.canEdit])).toEqual([["quilltab", 0, false]]);
    expect(v.unassigned).toEqual([]);
  });

  it("knows the project and site of the open page", () => {
    const nav: ProjectNav = {
      groups: [
        { name: "G", projects: [{ slug: "one", name: "One", status: "client", group: "G", canEdit: true, sites: [{ id: "s1", domain: "one.example" }, { id: "s2", domain: "two.example" }] }] },
        { name: null, projects: [{ slug: "empty", name: "Empty", status: "prospect", group: null, canEdit: true, sites: [] }] },
      ],
      unassigned: [{ id: "s9", domain: "orphan.example" }],
    };
    expect(switcherView("/projects", nav)).toEqual({ project: null, siteId: null, unassignedSite: null });
    expect(switcherView("/projects/one", nav).project?.slug).toBe("one");
    expect(switcherView("/projects/empty", nav).project?.slug).toBe("empty");
    expect(switcherView("/projects/new", nav).project).toBeNull();
    expect(switcherView("/sites/s2/keywords", nav)).toMatchObject({ project: { slug: "one" }, siteId: "s2", unassignedSite: null });
    expect(switcherView("/sites/s9", nav)).toMatchObject({ project: null, siteId: "s9", unassignedSite: { domain: "orphan.example" } });
    expect(switcherView("/sites/unknown", nav)).toEqual({ project: null, siteId: null, unassignedSite: null });
    expect(switcherView("/sites", nav).project).toBeNull();
  });

  it("tells the layout whether DataForSEO is connected", async () => {
    expect((await loadShellExtras({ id: "user-a", email: "a@quilltab.app" })).research).toBe(false);
    await db.apiKey.create({ data: { userId: "user-a", provider: "dataforseo", encryptedPassword: "x" } });
    const extras = await loadShellExtras({ id: "user-a", email: "a@quilltab.app" });
    expect(extras.research).toBe(true);
    expect(extras.projectNav?.unassigned.map((s) => s.domain)).toEqual(["orphan.example"]);
    expect(await loadShellExtras(null)).toEqual({ research: true });
  });
});

describe("the project overview", () => {
  it("recognises the agent's sync lines", () => {
    expect(isServiceEntry("синхронизация с платформой seo.aijam.pro (crawlseo-sync.py)")).toBe(true);
    expect(isServiceEntry("Published llms.txt")).toBe(false);
    expect(isServiceEntry(`Rewrote the sync, see crawlseo-sync.py. ${"x".repeat(300)}`)).toBe(false);
  });

  it("shows open tasks, real journal entries, active alerts, each site's numbers and rank tracking", async () => {
    await db.projectTask.createMany({
      data: [
        { projectId: "proj-a", title: "Approve the plan", status: "review" },
        { projectId: "proj-a", title: "Late one", status: "todo", due: daysAgo(3) },
        { projectId: "proj-a", title: "Finished", status: "done" },
      ],
    });
    await db.journalEntry.createMany({
      data: [
        { projectId: "proj-a", date: daysAgo(0), text: "синхронизация с платформой seo.aijam.pro (crawlseo-sync.py)", author: "seo-agent" },
        { projectId: "proj-a", date: daysAgo(1), text: "Published llms.txt", author: "seo-agent" },
      ],
    });
    await db.alert.createMany({
      data: [
        { id: "alert-now", userId: "user-a", siteId: "site-a", type: "TRAFFIC_DROP", channel: "EMAIL", config: {}, lastFired: daysAgo(1) },
        { id: "alert-old", userId: "user-a", siteId: "site-a", type: "NEW_404", channel: "EMAIL", config: {}, lastFired: daysAgo(30) },
        { id: "alert-off", userId: "user-a", siteId: "site-a", type: "CRAWL_ISSUES", channel: "EMAIL", config: {}, lastFired: daysAgo(1), enabled: false },
        { id: "alert-b", userId: "user-b", siteId: "site-b", type: "TRAFFIC_DROP", channel: "EMAIL", config: {}, lastFired: daysAgo(1) },
      ],
    });

    const o = await projectOverview(userA, "quilltab");
    expect(o.tasks.open).toBe(3);
    expect(o.tasks.items.map((x) => x.title)).toEqual(["Approve the plan", "Late one", "Fix titles"]);
    expect(o.tasks.byStatus).toEqual({ review: 1, todo: 2 });
    expect(o.tasks.overdue).toBe(1);
    expect(o.journal.map((e) => e.text)).toEqual(["Published llms.txt", "Audited the titles"]);
    expect(o.alerts).toEqual([expect.objectContaining({ id: "alert-now", siteId: "site-a", domain: "quilltab.app", type: "TRAFFIC_DROP" })]);
    expect(o.sites).toHaveLength(1);
    const site = o.sites[0];
    expect(site).toMatchObject({ id: "site-a", yours: true });
    expect(site.gsc?.clicks.current).toBeGreaterThan(0);
    expect(site.gsc?.avgPosition.current).toBe(4);
    expect(site.yandex?.visits.current).toBeGreaterThan(0);
    expect(site.yandex?.sqi.current).toBe(50);
    expect(o.rank).toEqual({ enabled: false, source: "none", frequency: "manual", lastStarted: null });
  });

  it("shows a viewer the domains without numbers or alerts, and a project without sites", async () => {
    const o = await projectOverview(viewer, "quilltab");
    expect(o.sites).toEqual([{ id: "site-a", domain: "quilltab.app", yours: false, gsc: null, yandex: null }]);
    expect(o.alerts).toEqual([]);
    expect(o.tasks.open).toBe(3);

    const empty = await projectOverview(userA, "centro-italica");
    expect(empty.sites).toEqual([]);
    expect(empty.journal).toEqual([]);
    await expect(projectOverview(userA, "secret-b")).rejects.toThrow(/not found/i);
  });

  it("reads rank tracking on, with the last started run", async () => {
    await db.projectRankSettings.upsert({
      where: { projectId: "proj-a" },
      create: { projectId: "proj-a", enabled: true, source: "labrika", frequency: "weekly" },
      update: { enabled: true, source: "labrika", frequency: "weekly" },
    });
    await db.rankCheckRun.createMany({
      data: [
        { projectId: "proj-a", provider: "labrika", trigger: "schedule", status: "started", createdAt: daysAgo(3) },
        { projectId: "proj-a", provider: "labrika", trigger: "schedule", status: "skipped", createdAt: daysAgo(1) },
      ],
    });
    const o = await projectOverview(userA, "quilltab");
    expect(o.rank).toEqual({ enabled: true, source: "labrika", frequency: "weekly", lastStarted: daysAgo(3).toISOString() });
  });
});

describe("group names (agency fork)", () => {
  it("joins an existing group whatever the case and spacing, and lists the groups", async () => {
    const { createProject, updateProject, listGroups } = await import("./service");
    await createProject(userA, { name: "Group One", slug: "group-one", group: "Centro Adelante" });
    const p = await createProject(userA, { name: "Group Two", slug: "group-two", group: "  centro   ADELANTE " });
    expect(p.project.group).toBe("Centro Adelante");
    const q = await updateProject(userA, "group-two", { group: "Other  Group" });
    expect(q.project.group).toBe("Other Group");
    expect(await listGroups(userA)).toEqual(expect.arrayContaining(["Centro Adelante", "Other Group"]));
  });
});
