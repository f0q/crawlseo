import { describe, expect, it } from "vitest";
import { PROJECT_TABS, projectTabHref, resolveProjectTab } from "./tabs";

// UX step 3 (agency fork): six project tabs; the former tab keys keep working.

describe("resolveProjectTab", () => {
  it("keeps the six current tabs", () => {
    expect(PROJECT_TABS).toEqual(["overview", "tasks", "journal", "data", "money", "about"]);
    for (const t of PROJECT_TABS) expect(resolveProjectTab(t)).toEqual({ tab: t, section: null, legacy: false });
  });

  it("maps every former tab key to its new tab and section", () => {
    expect(resolveProjectTab("sites")).toEqual({ tab: "data", section: "sites", legacy: true });
    expect(resolveProjectTab("rank")).toEqual({ tab: "data", section: "rank", legacy: true });
    expect(resolveProjectTab("budget")).toEqual({ tab: "money", section: null, legacy: true });
    expect(resolveProjectTab("passport")).toEqual({ tab: "about", section: "passport", legacy: true });
    expect(resolveProjectTab("brief")).toEqual({ tab: "about", section: "brief", legacy: true });
  });

  it("falls back to the Overview", () => {
    for (const v of [undefined, "", "nope", "__proto__", "toString", 3, ["x"]]) {
      expect(resolveProjectTab(v)).toEqual({ tab: "overview", section: null, legacy: false });
    }
    expect(resolveProjectTab(["money", "data"]).tab).toBe("money");
  });
});

describe("projectTabHref", () => {
  it("builds the canonical links", () => {
    expect(projectTabHref("acme", "overview")).toBe("/projects/acme");
    expect(projectTabHref("acme", "tasks")).toBe("/projects/acme?tab=tasks");
    expect(projectTabHref("acme", "data", { section: "rank" })).toBe("/projects/acme?tab=data#rank");
    expect(projectTabHref("acme", "money", { query: { month: "2026-11" } })).toBe("/projects/acme?tab=money&month=2026-11");
    expect(projectTabHref("acme", "money", { query: { month: undefined } })).toBe("/projects/acme?tab=money");
  });
});
