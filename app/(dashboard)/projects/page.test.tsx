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
  it("lists the user's projects with status, domains, open tasks and the last journal entry, and links to All sites", async () => {
    holder.user = { id: "user-a", email: "a@quilltab.app" };
    const html = renderToString(await ProjectsPage());
    expect(html).toContain("Quilltab");
    expect(html).toContain("quilltab.app");
    expect(html).toContain("1 open task");
    expect(html).toContain("Audited the titles");
    expect(html).toContain('href="/sites"');
    expect(html).not.toContain("Secret B");
    expect(html).toMatch(/Budgets this month[\s\S]*0 of 0 RUB[\s\S]*Labrika: 0 checks a month planned, 0 started this month, limit 5000/);
  });

  it("renders every tab of a project", async () => {
    expect(await page()).toMatch(/Passport[\s\S]*QUILLTAB_PANEL_PASS[\s\S]*Members[\s\S]*Delete project/);
    expect(await page("brief")).toMatch(/Grow organic sign-ups[\s\S]*Files/);
    expect(await page("sites")).toMatch(/quilltab\.app[\s\S]*Remove from project/);
    expect(await page("tasks")).toContain("Fix titles");
    expect(await page("journal")).toContain("Audited the titles");
    expect(await page("rank")).toMatch(/Start checks for this project[\s\S]*None \(Search Console or other data only\)[\s\S]*0 checks per month[\s\S]*All projects this month[\s\S]*No run yet/);
    expect(await page("budget")).toMatch(/0 of 0 RUB[\s\S]*work[\s\S]*No spending this month[\s\S]*Last 6 months/);
  });

  it("is read-only for a viewer, and another user's project is not found", async () => {
    holder.user = { id: "user-v", email: "v@quilltab.app" };
    const html = await page();
    expect(html).toContain("You can view this project");
    expect(html).not.toContain("Delete project");
    expect(await page("tasks")).not.toContain("Add task");
    expect(await page("rank")).toContain("You can view these settings");
    expect(await page("budget")).not.toContain("Save plan");
    await expect(page(undefined, "secret-b")).rejects.toThrow("not found");
  });
});
