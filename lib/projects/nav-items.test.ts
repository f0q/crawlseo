import { describe, expect, it } from "vitest";
import { SITE_SUB_PAGES } from "@/lib/site-routes";
import { contextNav, generalNav, SITE_HIDDEN_PAGES, SITE_PAGES, SITE_RESEARCH_PAGES, SITE_SETTINGS_PAGE, type ContextNav, type NavLink, type SiteSection } from "./nav-items";
import { switchTarget, type NavProject, type ProjectNav } from "./navigation";

// Navigation model of 2026-11-23 (agency fork): what the sidebar and the mobile strip show on each screen.

const one: NavProject = { slug: "one", name: "One", status: "client", group: "G", canEdit: true, sites: [{ id: "s1", domain: "one.example" }] };
const many: NavProject = { slug: "many", name: "Many", status: "client", group: null, canEdit: true, sites: [{ id: "m1", domain: "a.example" }, { id: "m2", domain: "b.example" }] };
const empty: NavProject = { slug: "empty", name: "Empty", status: "prospect", group: null, canEdit: true, sites: [] };
const viewed: NavProject = { slug: "viewed", name: "Viewed", status: "client", group: null, canEdit: false, sites: [] };
const NAV: ProjectNav = {
  groups: [{ name: "G", projects: [one] }, { name: null, projects: [many, empty, viewed] }],
  unassigned: [{ id: "u1", domain: "orphan.example" }],
};

const build = (pathname: string, tab: string | null = null, research = true) => contextNav({ pathname, tab, nav: NAV, research });

/** Every link of the sidebar on a screen, the General block included. */
function allLinks(m: ContextNav, pathname: string): NavLink[] {
  return [m.projects, ...m.sections.flatMap((s) => (s.kind === "action" ? [s.item] : s.items)), ...generalNav(pathname)];
}
const active = (m: ContextNav, pathname: string) => allLinks(m, pathname).filter((l) => l.active).map((l) => l.href);
const sites = (m: ContextNav) => m.sections.filter((s): s is SiteSection => s.kind === "site");

describe("the sidebar outside a project", () => {
  it("has Projects and nothing of a client; Projects is active on the list and on New project only", () => {
    for (const path of ["/projects", "/projects/new"]) {
      const m = build(path);
      expect(m.context).toBe("global");
      expect(m.sections).toEqual([]);
      expect(m.strip).toBeNull();
      expect(active(m, path)).toEqual(["/projects"]);
    }
    expect(build("/projects").title).toBe("Projects");
    expect(build("/projects/new").title).toBe("New project");
  });

  it("highlights only the General item of a general page and names it in the mobile header", () => {
    expect(active(build("/projects/sources"), "/projects/sources")).toEqual(["/projects/sources"]);
    expect(active(build("/projects/groups"), "/projects/groups")).toEqual(["/projects/groups"]);
    expect(active(build("/settings"), "/settings")).toEqual(["/settings"]);
    expect(build("/projects/sources").title).toBe("Data sources");
    expect(build("/settings").title).toBe("Settings");
    expect(build("/sites/nobody").context).toBe("global");
  });
});

describe("the sidebar of a project", () => {
  it("lists the six sections, then the site under its domain, Site settings last; the open section is the one active item", () => {
    const m = build("/projects/one", "tasks");
    expect(m.context).toBe("project");
    expect(m.title).toBe("One");
    expect(m.sections[0]).toMatchObject({ kind: "project", title: "Project" });
    const project = m.sections[0].kind === "project" ? m.sections[0].items : [];
    expect(project.map((i) => i.label)).toEqual(["Overview", "Tasks", "Journal", "Data", "Money", "About"]);
    expect(project.map((i) => i.href)).toEqual([
      "/projects/one",
      "/projects/one?tab=tasks",
      "/projects/one?tab=journal",
      "/projects/one?tab=data",
      "/projects/one?tab=money",
      "/projects/one?tab=about",
    ]);
    const [site] = sites(m);
    expect(site).toMatchObject({ domain: "one.example", expanded: true, current: false });
    expect(site.items[0]).toMatchObject({ href: "/sites/s1", label: "Site overview" });
    expect(site.items.at(-1)).toMatchObject({ href: "/sites/s1/settings", label: "Site settings" });
    expect(site.items.map((i) => i.href)).not.toContain("/sites/s1/mcp");
    expect(active(m, "/projects/one")).toEqual(["/projects/one?tab=tasks"]);
  });

  it("treats the Overview as open without a tab, with an unknown one, and a former key as its new tab", () => {
    expect(active(build("/projects/one"), "/projects/one")).toEqual(["/projects/one"]);
    expect(active(build("/projects/one", "nope"), "/projects/one")).toEqual(["/projects/one"]);
    expect(active(build("/projects/one", "budget"), "/projects/one")).toEqual(["/projects/one?tab=money"]);
  });

  it("offers Add a domain to an editor of a project without sites, and nothing to a viewer", () => {
    expect(build("/projects/empty").sections.slice(1)).toEqual([
      { kind: "action", item: { href: "/projects/empty?tab=data#sites", label: "Add a domain", icon: "add", active: false } },
    ]);
    expect(build("/projects/viewed").sections.map((s) => s.kind)).toEqual(["project"]);
  });

  it("with several sites: one heading per domain, all folded on the project's own pages", () => {
    const m = build("/projects/many");
    expect(sites(m).map((s) => [s.domain, s.expanded, s.href, s.items.length])).toEqual([
      ["a.example", false, "/sites/m1", 0],
      ["b.example", false, "/sites/m2", 0],
    ]);
  });

  it("leaves Research out without DataForSEO", () => {
    const hrefs = sites(build("/projects/one", null, false))[0].items.map((i) => i.href);
    expect(hrefs).not.toContain("/sites/s1/keyword-research");
    expect(sites(build("/projects/one"))[0].items.map((i) => i.href)).toContain("/sites/s1/keyword-research");
  });

  it("strips the six sections on a phone", () => {
    const m = build("/projects/one", "money");
    expect(m.strip?.back).toBeNull();
    expect(m.strip?.items.map((i) => [i.label, i.active])).toEqual([
      ["Overview", false],
      ["Tasks", false],
      ["Journal", false],
      ["Data", false],
      ["Money", true],
      ["About", false],
    ]);
  });
});

describe("the sidebar of a site", () => {
  it("is the project's sidebar with the site page active, the project one click away", () => {
    const m = build("/sites/s1/yandex");
    expect(m.context).toBe("site");
    expect(m.project?.slug).toBe("one");
    expect(active(m, "/sites/s1/yandex")).toEqual(["/sites/s1/yandex"]);
    expect(m.sections[0].kind === "project" && m.sections[0].items[0].href).toBe("/projects/one");
    expect(active(build("/sites/s1"), "/sites/s1")).toEqual(["/sites/s1"]);
    // A deeper page keeps its item active.
    expect(active(build("/sites/s1/crawl/abc"), "/sites/s1/crawl/abc")).toEqual(["/sites/s1/crawl"]);
    // The phone: a line back to the project overview, then the site's pages.
    expect(m.strip?.back).toEqual({ href: "/projects/one", label: "one.example", title: "One" });
    expect(m.strip?.items[0].label).toBe("Site overview");
  });

  it("with several sites: only the open one unfolds, another domain opens the same page of that site", () => {
    const m = build("/sites/m2/positions");
    expect(sites(m).map((s) => [s.domain, s.expanded, s.current, s.href])).toEqual([
      ["a.example", false, false, "/sites/m1/positions"],
      ["b.example", true, true, "/sites/m2/positions"],
    ]);
    expect(active(m, "/sites/m2/positions")).toEqual(["/sites/m2/positions"]);
  });

  it("of a site without a project: Link to a project instead of the project's sections", () => {
    const m = build("/sites/u1/keywords");
    expect(m.context).toBe("site");
    expect(m.project).toBeNull();
    expect(m.title).toBe("Sites without a project");
    expect(m.sections.map((s) => s.kind)).toEqual(["action", "site"]);
    expect(m.sections[0]).toMatchObject({ item: { href: "/projects#unassigned", label: "Link to a project" } });
    expect(active(m, "/sites/u1/keywords")).toEqual(["/sites/u1/keywords"]);
  });
});

describe("site pages against upstream's routes", () => {
  // A new upstream site page fails here instead of going missing from the menu: list it in SITE_PAGES or SITE_HIDDEN_PAGES.
  it("lists every entry of SITE_SUB_PAGES or hides it on purpose", () => {
    const listed = new Set<string>([...SITE_PAGES, ...SITE_RESEARCH_PAGES, SITE_SETTINGS_PAGE].map((p) => p.sub).filter(Boolean));
    const hidden = new Set<string>(SITE_HIDDEN_PAGES);
    expect(SITE_SUB_PAGES.filter((sub) => !listed.has(sub) && !hidden.has(sub))).toEqual([]);
    expect([...listed, ...hidden].filter((sub) => !(SITE_SUB_PAGES as readonly string[]).includes(sub))).toEqual([]);
  });
});

describe("switching project keeps the screen", () => {
  const to = (pathname: string, target: NavProject, tab: string | null = null) => switchTarget({ pathname, tab, nav: NAV, target });

  it("from a project section: the same section of the other project", () => {
    expect(to("/projects/one", many, "tasks")).toBe("/projects/many?tab=tasks");
    expect(to("/projects/one", many)).toBe("/projects/many");
    expect(to("/projects/one", many, "budget")).toBe("/projects/many?tab=money");
    expect(to("/projects/one", many, "nope")).toBe("/projects/many");
  });

  it("from a site page: the same page of the other project's first site, else its Overview", () => {
    expect(to("/sites/s1/yandex", many)).toBe("/sites/m1/yandex");
    expect(to("/sites/m2/positions", one)).toBe("/sites/s1/positions");
    expect(to("/sites/s1", many)).toBe("/sites/m1");
    // A page that is not a known site page (or a deeper one) opens the site overview.
    expect(to("/sites/s1/unknown", many)).toBe("/sites/m1");
    expect(to("/sites/s1/yandex", empty)).toBe("/projects/empty");
    // A site without a project too.
    expect(to("/sites/u1/keywords", one)).toBe("/sites/s1/keywords");
  });

  it("from a general page: the project's Overview", () => {
    for (const path of ["/projects", "/projects/new", "/projects/sources", "/projects/groups", "/settings", "/sites"]) {
      expect(to(path, one, "tasks")).toBe("/projects/one");
    }
  });
});
