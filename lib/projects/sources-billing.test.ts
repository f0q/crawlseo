import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Data sources and client billing (agency fork, UX step 2) on a real Prisma
// client (PGlite): the billing rule, the one guard of paid collection, the
// schedule filter for paused and archived projects, the sources matrix and
// the API. The rank provider's HTTP is a fake that records every call.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1 } from "@/lib/api-v1/router";
import { encrypt } from "@/lib/encryption";
import { scheduleConfig } from "@/lib/jobs/config";
import { GSC_SYNC_JOB } from "@/lib/jobs/handlers";
import { registerScheduleFilter, runScheduler } from "@/lib/jobs/scheduler";
import { daysAgo, seedApiFixtures, snapshotUserData, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { applyBillingRule, billingState } from "./billing";
import { paidCollectionGuard, projectStatusFilter } from "./collection";
import { handleDashboardProjects } from "./dashboard";
import { attentionReasons } from "./home";
import { runDueRankChecks, runRankCheck } from "./rank";
import { sourcesMatrix, worstCell } from "./sources";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;

const A = { id: "user-a", email: "a@quilltab.app" };
const actorA = { userId: "user-a", email: "a@quilltab.app", kind: "human" as const, label: "a@quilltab.app" };
const day = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => day(new Date(Date.now() + n * 86_400_000));

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ??= "test-secret-for-sources-billing";
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
  // Paid checks on, with a cabinet login: everything a start needs, so only the guard can stop it.
  await db.projectRankSettings.upsert({
    where: { projectId: "proj-a" },
    create: { projectId: "proj-a", enabled: true, source: "labrika", frequency: "weekly", engineIds: ["eng-a"] },
    update: { enabled: true, source: "labrika", frequency: "weekly", engineIds: ["eng-a"] },
  });
  await db.apiKey.create({ data: { userId: "user-a", provider: "labrika-cabinet", encryptedLogin: encrypt("a@quilltab.app"), encryptedPassword: encrypt("pw") } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  const g = globalThis as { crawlseoApiRateLimiter?: unknown; crawlseoApiWriteLimiter?: unknown };
  g.crawlseoApiRateLimiter = undefined;
  g.crawlseoApiWriteLimiter = undefined;
  await db.project.update({ where: { id: "proj-a" }, data: { status: "client", paidUntil: null, contractEnd: null, billingNeverPause: false, paidPausedAt: null, paidPauseReason: null } });
  await db.rankCheckRun.deleteMany();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: string, path: string, key: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handleApiV1(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

async function dash(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handleDashboardProjects(
    A,
    new Request(`http://localhost/api/projects${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    })
  );
  return { status: res.status, body: (await res.json()) as Json };
}

/** A fake labrika.ru that records every request. */
function fakeLabrika() {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    urls.push(`${init.method ?? "GET"} ${url}`);
    if (url.endsWith("/login") && (init.method ?? "GET") === "GET") return new Response("<html></html>", { headers: { "set-cookie": "s=1; path=/" } });
    if (url.endsWith("/login")) return new Response("", { status: 302, headers: { location: "https://labrika.ru/dashboard", "set-cookie": "s=2; path=/" } });
    return Response.json({});
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

describe("migration", () => {
  it("adds the billing columns without tracking any existing project", async () => {
    const dir = join(__dirname, "../../prisma/migrations");
    const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const last = names.indexOf("20261126000000_agency_billing");
    expect(last).toBeGreaterThan(-1);
    const pg = await PGlite.create();
    try {
      for (const name of names.slice(0, last)) await pg.exec(readFileSync(join(dir, name, "migration.sql"), "utf8"));
      await pg.exec(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('u1', 'u1@example.com', now());
        INSERT INTO "Project" ("id", "slug", "name", "ownerId", "updatedAt") VALUES ('p1', 'old-one', 'Old', 'u1', now());`);
      await pg.exec(readFileSync(join(dir, names[last], "migration.sql"), "utf8"));
      const r = await pg.query(`SELECT "paidUntil", "contractEnd", "billingNeverPause", "paidPausedAt", "paidPauseReason", "name" FROM "Project" WHERE "id" = 'p1'`);
      expect(r.rows).toEqual([{ paidUntil: null, contractEnd: null, billingNeverPause: false, paidPausedAt: null, paidPauseReason: null, name: "Old" }]);
    } finally {
      await pg.close();
    }
  }, 60_000);
});

describe("billing rule", () => {
  const now = new Date("2026-11-22T15:00:00Z");
  const state = (paidUntil: string | null, contractEnd: string | null = null, neverPause = false) =>
    billingState({ paidUntil, contractEnd, billingNeverPause: neverPause }, now);

  it("does not track a project without paidUntil, even with a contract end in the past", () => {
    expect(state(null)).toMatchObject({ tracked: false, level: "none", shouldPause: false });
    expect(state(null, "2026-01-01")).toMatchObject({ tracked: false, shouldPause: false });
  });

  it("is ok ahead, due soon within a week, warns 1 to 14 days overdue, pauses later", () => {
    expect(state("2026-12-31")).toMatchObject({ level: "ok", daysLeft: 39, overdueDays: 0 });
    expect(state("2026-11-25")).toMatchObject({ level: "soon", daysLeft: 3 });
    expect(state("2026-11-22")).toMatchObject({ level: "soon", daysLeft: 0, overdueDays: 0 });
    expect(state("2026-11-21")).toMatchObject({ level: "overdue", overdueDays: 1, shouldPause: false, pauseFrom: "2026-12-06" });
    expect(state("2026-11-08")).toMatchObject({ level: "overdue", overdueDays: 14, shouldPause: false, pauseFrom: "2026-11-23" });
    expect(state("2026-11-07")).toMatchObject({ level: "paused", overdueDays: 15, shouldPause: true, pauseReason: "overdue" });
  });

  it("pauses when the contract ended, and never with neverPause", () => {
    expect(state("2026-12-31", "2026-11-21")).toMatchObject({ level: "paused", shouldPause: true, pauseReason: "contract-ended", contractEnded: true });
    expect(state("2026-12-31", "2026-11-22")).toMatchObject({ level: "ok", contractEnded: false, pauseFrom: "2026-11-23" });
    expect(state("2026-10-01", null, true)).toMatchObject({ level: "overdue", shouldPause: false, pauseFrom: null });
    expect(state("2026-12-31", "2026-11-01", true)).toMatchObject({ level: "overdue", contractEnded: true, shouldPause: false });
  });
});

describe("billing fields through the API", () => {
  it("are set with PATCH, returned as days, refused when invalid or with a read-only key", async () => {
    const before = await snapshotUserData(db);
    expect((await api("PATCH", "/projects/quilltab", f.keyA, { paidUntil: "2026-12-01" })).status).toBe(403);
    expect((await api("PATCH", "/projects/quilltab", f.keyAWrite, { paidUntil: "1 Dec" })).status).toBe(400);
    expect((await api("PATCH", "/projects/quilltab", f.keyAWrite, { contractEnd: "2026-02-30" })).status).toBe(400);
    expect((await api("PATCH", "/projects/quilltab", f.keyAWrite, { billingNeverPause: "yes" })).status).toBe(400);
    expect(await snapshotUserData(db)).toBe(before);

    const r = await api("PATCH", "/projects/quilltab", f.keyAWrite, { paidUntil: "2026-12-01", contractEnd: "2027-03-01", billingNeverPause: true });
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.project).toMatchObject({ paidUntil: "2026-12-01", contractEnd: "2027-03-01", billingNeverPause: true, paidPausedAt: null, name: "Quilltab" });
    const list = await api("GET", "/projects", f.keyA);
    expect(list.body.projects[0]).toMatchObject({ slug: "quilltab", paidUntil: "2026-12-01", contractEnd: "2027-03-01", billingNeverPause: true, openTasks: 1 });
    // Other passport fields are untouched; null clears.
    const cleared = await api("PATCH", "/projects/quilltab", f.keyAWrite, { paidUntil: null, contractEnd: "" });
    expect(cleared.body.project).toMatchObject({ paidUntil: null, contractEnd: null, searchEngines: ["Google"] });
  });
});

describe("paid collection guard", () => {
  it("allows a client project that pays and has checks on", async () => {
    expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: true });
    const { fetch, urls } = fakeLabrika();
    expect(await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } })).toMatchObject({ status: "started" });
    expect(urls.length).toBeGreaterThan(0);
  });

  for (const status of ["paused", "archived"]) {
    it(`a ${status} project cannot start a paid check, scheduled or by hand`, async () => {
      await db.project.update({ where: { id: "proj-a" }, data: { status } });
      expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: false, reason: "status" });
      const { fetch, urls } = fakeLabrika();
      expect(await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } })).toBeNull();
      expect(await runRankCheck(db, "proj-a", { trigger: "schedule", providerOptions: { fetch } })).toBeNull();
      expect(await runDueRankChecks(db, { now: new Date(), providerOptions: { fetch } })).toEqual([]);
      const r = await dash("POST", "/quilltab/rank-checks", {});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/paused or archived/);
      expect(urls).toEqual([]);
      expect(await db.rankCheckRun.count()).toBe(0);
      // The manual on/off is not touched.
      expect((await db.projectRankSettings.findUnique({ where: { projectId: "proj-a" } }))!.enabled).toBe(true);
    });
  }

  it("more than 14 days overdue: the rule pauses paid collection without touching the manual setting, and moving the date resumes it", async () => {
    await db.project.update({ where: { id: "proj-a" }, data: { paidUntil: daysAgo(20) } });
    // Blocked before the daily rule has run, too.
    expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: false, reason: "billing" });
    const now = new Date();
    expect(await applyBillingRule(db, now)).toEqual({ paused: ["proj-a"], resumed: [] });
    expect(await applyBillingRule(db, now)).toEqual({ paused: [], resumed: [] });
    const p = await db.project.findUniqueOrThrow({ where: { id: "proj-a" } });
    expect(p).toMatchObject({ status: "client", paidPauseReason: "overdue" });
    expect(p.paidPausedAt).not.toBeNull();
    expect((await db.projectRankSettings.findUnique({ where: { projectId: "proj-a" } }))!.enabled).toBe(true);

    const { fetch, urls } = fakeLabrika();
    expect(await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } })).toBeNull();
    expect(await runDueRankChecks(db, { now, providerOptions: { fetch } })).toEqual([]);
    const refused = await dash("POST", "/quilltab/rank-checks", {});
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/payment is overdue/);
    expect(urls).toEqual([]);
    expect(await db.rankCheckRun.count()).toBe(0);

    // Free sources keep being scheduled for a billing pause.
    const kept = await projectStatusFilter(db)([{ id: "site-a", userId: "user-a", createdAt: new Date(), gscProperty: "x", bingSite: null }]);
    expect(kept.map((s) => s.id)).toEqual(["site-a"]);

    // Paid until moved forward: resumed at once by the PATCH, the stored pause is gone.
    const moved = await api("PATCH", "/projects/quilltab", f.keyAWrite, { paidUntil: inDays(30) });
    expect(moved.body.project.paidPausedAt).toBeNull();
    expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: true });
    expect(await runRankCheck(db, "proj-a", { trigger: "manual", providerOptions: { fetch } })).toMatchObject({ status: "started" });
  });

  it("a contract in the past pauses; neverPause keeps paid collection running", async () => {
    await api("PATCH", "/projects/quilltab", f.keyAWrite, { paidUntil: inDays(30), contractEnd: inDays(-1) });
    expect((await db.project.findUniqueOrThrow({ where: { id: "proj-a" } })).paidPauseReason).toBe("contract-ended");
    expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: false, reason: "billing" });
    await api("PATCH", "/projects/quilltab", f.keyAWrite, { billingNeverPause: true });
    expect((await db.project.findUniqueOrThrow({ where: { id: "proj-a" } })).paidPausedAt).toBeNull();
    expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: true });
  });

  it("manual off stays off whatever billing says", async () => {
    await db.projectRankSettings.update({ where: { projectId: "proj-a" }, data: { enabled: false } });
    try {
      await db.project.update({ where: { id: "proj-a" }, data: { paidUntil: new Date(inDays(30)) } });
      expect(await paidCollectionGuard(db, "proj-a")).toEqual({ allowed: false, reason: "off" });
      expect(await runRankCheck(db, "proj-a", { trigger: "manual" })).toBeNull();
    } finally {
      await db.projectRankSettings.update({ where: { projectId: "proj-a" }, data: { enabled: true } });
    }
  });
});

describe("project status and the schedule", () => {
  it("a paused or archived project's sites get no scheduled job; sites without a project and other projects keep theirs", async () => {
    const remove = registerScheduleFilter(projectStatusFilter(db));
    try {
      const config = scheduleConfig({});
      const pass = async (status: string) => {
        await db.project.update({ where: { id: "proj-a" }, data: { status } });
        await db.job.deleteMany();
        await runScheduler(db, { now: new Date(), config, force: true, types: [GSC_SYNC_JOB] });
        return (await db.job.findMany({ where: { type: GSC_SYNC_JOB }, select: { siteId: true } })).map((j) => j.siteId).sort();
      };
      expect(await pass("client")).toEqual(["site-a", "site-b"]);
      expect(await pass("paused")).toEqual(["site-b"]);
      expect(await pass("archived")).toEqual(["site-b"]);
      expect(await pass("prospect")).toEqual(["site-a", "site-b"]);
    } finally {
      remove();
      await db.job.deleteMany();
    }
  });
});

describe("sources matrix", () => {
  it("gives each source of each site a state, last sync and error, and the paid checks per project", async () => {
    await db.job.create({ data: { siteId: "site-a", type: GSC_SYNC_JOB, status: "FAILED", source: "schedule", maxAttempts: 3, lastError: "Google refused the token", finishedAt: daysAgo(0) } });
    try {
      const m = await sourcesMatrix(actorA);
      expect(m.projects.map((p) => p.slug)).toEqual(["quilltab"]);
      const p = m.projects[0];
      const site = p.sites[0];
      expect(site).toMatchObject({ siteId: "site-a", domain: "quilltab.app", yours: true });
      expect(site.cells.gsc).toMatchObject({ state: "error", error: "Google refused the token", paid: false, href: "/sites/site-a/keywords" });
      expect(site.cells.gsc.lastSync).not.toBeNull();
      // Linked to Yandex, but the owner has no Yandex connection.
      expect(site.cells.webmaster).toMatchObject({ state: "error", error: expect.stringMatching(/Yandex account is not connected/) });
      expect(site.cells.crawl.state).toBe("ok");
      expect(site.cells.vitals.state).toBe("ok");
      // Paid rank checks are on and never started.
      expect(p.cells.positions).toMatchObject({ paid: true, href: "/projects/quilltab?tab=rank" });
      expect(p.rank).toMatchObject({ enabled: true, source: "labrika", sourceName: "Labrika", canToggle: true });
      expect(p.cells.gsc.state).toBe("error");
      expect(m.totals.errors).toBeGreaterThanOrEqual(3);
      expect(m.totals.paidActive).toBe(1);
      expect(attentionReasons({ status: "client", sources: p, alerts: 0 }).map((r) => r.kind)).toContain("error");

      // Billing pause on the paid cell only; a paused project pauses every collected source.
      await db.project.update({ where: { id: "proj-a" }, data: { paidUntil: daysAgo(30) } });
      const billed = (await sourcesMatrix(actorA)).projects[0];
      expect(billed.cells.positions.state).toBe("paused-billing");
      expect(billed.sites[0].cells.crawl.state).toBe("ok");
      expect(billed.billing.level).toBe("paused");
      expect((await sourcesMatrix(actorA)).totals.paidActive).toBe(0);
      await db.project.update({ where: { id: "proj-a" }, data: { paidUntil: null, status: "paused" } });
      const stopped = (await sourcesMatrix(actorA)).projects[0];
      expect(stopped.cells.positions.state).toBe("paused-status");
      expect(stopped.sites[0].cells.gsc).toMatchObject({ state: "paused-status", error: null });
      expect(attentionReasons({ status: "paused", sources: stopped, alerts: 3 })).toEqual([]);
    } finally {
      await db.job.deleteMany();
    }
  });

  it("hides another member's site errors and links, and is readable through the API", async () => {
    await db.user.create({ data: { id: "user-v", email: "v@quilltab.app" } });
    await db.membership.create({ data: { projectId: "proj-a", userId: "user-v", role: "viewer" } });
    const m = await sourcesMatrix({ userId: "user-v", email: "v@quilltab.app", kind: "human", label: "v" });
    const site = m.projects[0].sites[0];
    expect(site.yours).toBe(false);
    expect(site.cells.webmaster).toMatchObject({ state: "error", error: null, href: null });
    expect(m.projects[0].rank.canToggle).toBe(false);
    await db.membership.deleteMany({ where: { userId: "user-v" } });

    const r = await api("GET", "/projects/_sources", f.keyA);
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: Json) => p.slug)).toEqual(["quilltab"]);
    expect((await api("GET", "/projects/_sources", f.keyB)).body.projects.map((p: Json) => p.slug)).toEqual(["secret-b"]);
    expect((await api("POST", "/projects/_sources", f.keyAWrite, {})).status).toBe(405);
  });

  it("the project line shows the worst state of its sites", () => {
    const c = (state: Parameters<typeof worstCell>[0][number]["state"], lastSync: string | null = null) => ({ state, lastSync, error: null, paid: false, href: null });
    expect(worstCell([c("ok", "2026-11-20"), c("stale", "2026-11-01"), c("not-connected")]).state).toBe("stale");
    expect(worstCell([c("ok", "2026-11-20"), c("ok", "2026-11-18")]).lastSync).toBe("2026-11-18");
    expect(worstCell([]).state).toBe("no-site");
  });
});
