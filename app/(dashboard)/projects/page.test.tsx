import type { PrismaClient } from "@prisma/client";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The projects pages (agency fork) render from the real service on PGlite:
// the list (the home after sign-in) and each tab of a project, read-only for
// a viewer.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null, user: { id: "user-a", email: "a@quilltab.app" } }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: holder.user }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/projects",
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));

import { seedApiFixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import ProjectsPage from "./page";
import ProjectPage from "./[slug]/page";
import SourcesPage from "./sources/page";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  holder.db = t.db;
  await seedApiFixtures(t.db);
  await t.db.user.create({ data: { id: "user-v", email: "v@quilltab.app" } });
  await t.db.membership.create({ data: { projectId: "proj-a", userId: "user-v", role: "viewer" } });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const page = async (tab?: string, slug = "quilltab") =>
  renderToString(await ProjectPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(tab ? { tab } : {}) }));

describe("projects pages", () => {
  it("lists the user's projects with status, domains, open tasks and the last journal entry", async () => {
    holder.user = { id: "user-a", email: "a@quilltab.app" };
    const html = renderToString(await ProjectsPage());
    expect(html).toContain("Quilltab");
    expect(html).toContain("quilltab.app");
    expect(html).toContain("1 open");
    expect(html).toContain("Audited the titles");
    // Agency fork UX step 2: a table with the data sources of each project and a link to the panel.
    expect(html).toContain('href="/projects/sources"');
    expect(html).toMatch(/aria-label="Data sources: Positions \(paid\)|aria-label="Data sources: Positions:/);
    // Agency fork UX step 1: no All sites button while every site is in a project.
    expect(html).not.toContain('href="/sites"');
    expect(html).not.toContain("Sites without a project");
    expect(html).not.toContain("Secret B");
    // Nothing planned or spent: no summary line.
    expect(html).not.toContain("Spending this month");
    // Quilltab's Yandex link has no Yandex connection behind it: it needs attention.
    expect(html).toMatch(/Needs attention[\s\S]*Quilltab[\s\S]*source[s]? failing/);
  });

  it("groups projects by group and lists the user's sites outside every project", async () => {
    holder.user = { id: "user-a", email: "a@quilltab.app" };
    await t.db.project.create({ data: { id: "proj-g", slug: "grouped", name: "Grouped one", group: "Centro Adelante", ownerId: "user-a", members: { create: { userId: "user-a", role: "owner" } } } });
    await t.db.site.create({ data: { id: "site-orphan", userId: "user-a", domain: "orphan.example" } });
    const html = renderToString(await ProjectsPage());
    expect(html).toMatch(/Needs attention[\s\S]*Quilltab[\s\S]*Centro Adelante[\s\S]*Grouped one[\s\S]*Sites without a project[\s\S]*href="\/sites\/site-orphan"/);
    expect(html).toContain('href="/sites"');
    await t.db.site.delete({ where: { id: "site-orphan" } });
    await t.db.project.delete({ where: { id: "proj-g" } });
  });

  it("renders every tab of a project, the Overview by default", async () => {
    expect(await page()).toMatch(/aria-current="page"[^>]*>Overview<[\s\S]*Last 28 days[\s\S]*quilltab\.app[\s\S]*Clicks[\s\S]*Visits from Yandex search[\s\S]*Rank tracking[\s\S]*Off[\s\S]*Tasks \(1 open\)[\s\S]*Fix titles[\s\S]*Audited the titles/);
    expect(await page("overview")).toContain("Last 28 days");
    // Agency fork UX step 3: six tabs; About = passport + brief + members, Data = sources + sites + rank tracking.
    expect(await page()).toMatch(/>Overview<[\s\S]*>Tasks<[\s\S]*>Journal<[\s\S]*>Data<[\s\S]*>Money<[\s\S]*>About</);
    expect(await page("about")).toMatch(/id="passport"[\s\S]*Passport[\s\S]*QUILLTAB_PANEL_PASS[\s\S]*id="brief"[\s\S]*Grow organic sign-ups[\s\S]*Files[\s\S]*id="members"[\s\S]*Members[\s\S]*Delete project/);
    expect(await page("data")).toMatch(/id="sources"[\s\S]*Search Console[\s\S]*id="sites"[\s\S]*quilltab\.app[\s\S]*Remove from project[\s\S]*Visits from Yandex search[\s\S]*SQI[\s\S]*id="rank"[\s\S]*Start checks for this project[\s\S]*None \(Search Console or other data only\)[\s\S]*0 checks per month[\s\S]*All projects this month[\s\S]*No run yet/);
    expect(await page("tasks")).toContain("Fix titles");
    expect(await page("journal")).toContain("Audited the titles");
    expect(await page("money")).toMatch(/Money[\s\S]*Client payment[\s\S]*Payments are not tracked[\s\S]*Spending[\s\S]*0 of 0 RUB[\s\S]*work[\s\S]*No spending this month[\s\S]*Last 6 months/);
    expect(await page("money")).toContain('name="tab" value="money"');
    expect(await page()).toMatch(/Data<\/h2>[\s\S]*Search Console/);
  });

  it("redirects the former tab keys to their new tab and section", async () => {
    holder.user = { id: "user-a", email: "a@quilltab.app" };
    await expect(page("sites")).rejects.toThrow("redirect /projects/quilltab?tab=data#sites");
    await expect(page("rank")).rejects.toThrow("redirect /projects/quilltab?tab=data#rank");
    await expect(page("budget")).rejects.toThrow("redirect /projects/quilltab?tab=money");
    await expect(page("passport")).rejects.toThrow("redirect /projects/quilltab?tab=about#passport");
    await expect(page("brief")).rejects.toThrow("redirect /projects/quilltab?tab=about#brief");
    const budget = ProjectPage({ params: Promise.resolve({ slug: "quilltab" }), searchParams: Promise.resolve({ tab: "budget", month: "2026-10" }) });
    await expect(budget).rejects.toThrow("redirect /projects/quilltab?tab=money&month=2026-10");
    // An unknown tab opens the Overview.
    expect(await page("nope")).toContain("Last 28 days");
  });

  it("the data sources panel lists every project against every source, with totals", async () => {
    holder.user = { id: "user-a", email: "a@quilltab.app" };
    const html = renderToString(await SourcesPage());
    expect(html).toMatch(/Data sources[\s\S]*Positions[\s\S]*Search Console[\s\S]*Yandex Webmaster[\s\S]*Yandex Metrika[\s\S]*Crawl[\s\S]*Speed \(CWV\)/);
    expect(html).toMatch(/id="p-quilltab"[\s\S]*Quilltab[\s\S]*quilltab\.app/);
    expect(html).toMatch(/Total[\s\S]*of 1 ok/);
    expect(html).not.toContain("Secret B");
  });

  it("is read-only for a viewer, and another user's project is not found", async () => {
    holder.user = { id: "user-v", email: "v@quilltab.app" };
    expect(await page()).toContain("Only the owner of this site sees its numbers.");
    const html = await page("about");
    expect(html).toContain("You can view this project");
    expect(html).not.toContain("Delete project");
    expect(await page("tasks")).not.toContain("Add task");
    // A viewer sees the domain of a site, not its Yandex data.
    expect(await page("data")).toContain("None of your sites in this project has Yandex linked yet.");
    expect(await page("data")).toContain("You can view these settings");
    expect(await page("money")).not.toContain("Save plan");
    expect(await page("money")).toContain("Editors and owners change the payment dates.");
    await expect(page(undefined, "secret-b")).rejects.toThrow("not found");
  });
});
