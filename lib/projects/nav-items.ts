import { sitePathFor } from "@/lib/site-routes";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { PROJECT_MESSAGES as M } from "./messages";
import { switcherView, type NavProject, type NavSite, type ProjectNav } from "./navigation";
import { PROJECT_TABS, projectTabHref, resolveProjectTab, type ProjectTab } from "./tabs";

/*
 * The items of the agency sidebar and of the mobile strip under the header
 * (agency fork, navigation model of 2026-11-23). Pure, so the sidebar, the
 * strip and the tests build the same list. Icons are named here and drawn in
 * components/projects/nav-icons.ts.
 *
 * The sidebar reads top to bottom as a path: Projects, the project switcher,
 * the project's six sections, then one section per site of the project named
 * after its domain. The General block at the bottom is the same everywhere.
 * Exactly one item is active: the open screen.
 */

export type NavIcon =
  | "projects"
  | "sources"
  | "groups"
  | "settings"
  | `tab-${ProjectTab}`
  | `site-${SitePageKey}`
  | "site"
  | "add"
  | "link";

/** A count after the label: "attention" when something waits for the user (tasks in review). */
export type NavBadge = { text: string; title: string; tone: "neutral" | "attention" };
export type NavLink = { href: string; label: string; icon: NavIcon; active: boolean; badge?: NavBadge };

/** A site page of the sidebar: `sub` is the path segment after /sites/{id} ("" for the site overview). */
type SitePage = { sub: string; label: string };

/** The site pages, in the order of the sidebar. Every entry of SITE_SUB_PAGES is here or in SITE_HIDDEN_PAGES (nav-items.test.ts). */
export const SITE_PAGES = [
  { sub: "", label: M.nav.siteOverview },
  { sub: "keywords", label: M.nav.sitePages.keywords },
  { sub: "saved-keywords", label: M.nav.sitePages.savedKeywords },
  // Agency fork: rank tracking positions (lib/rank-providers).
  { sub: "positions", label: M.nav.sitePages.positions },
  // Agency fork: Yandex Metrika and Webmaster (lib/yandex).
  { sub: "yandex", label: YANDEX_UI.nav },
  { sub: "pages", label: M.nav.sitePages.pages },
  { sub: "crawl", label: M.nav.sitePages.crawl },
  { sub: "vitals", label: M.nav.sitePages.vitals },
  { sub: "opportunities", label: M.nav.sitePages.opportunities },
  { sub: "alerts", label: M.nav.sitePages.alerts },
] as const satisfies readonly SitePage[];

/** Only with DataForSEO connected; the pages still open by link. */
export const SITE_RESEARCH_PAGES = [
  { sub: "keyword-research", label: M.nav.sitePages.keywordResearch },
  { sub: "domain-overview", label: M.nav.sitePages.domainOverview },
  { sub: "backlinks", label: M.nav.sitePages.backlinks },
] as const satisfies readonly SitePage[];

/** Always last in a site's section. */
export const SITE_SETTINGS_PAGE = { sub: "settings", label: M.nav.sitePages.settings } as const satisfies SitePage;

/** Site routes left out of the menu on purpose: AI & MCP (/sites/{id}/mcp still opens; Settings > MCP has the same). */
export const SITE_HIDDEN_PAGES = ["mcp"] as const;

type SitePageKey = "overview" | Exclude<(typeof SITE_PAGES)[number]["sub"] | (typeof SITE_RESEARCH_PAGES)[number]["sub"] | typeof SITE_SETTINGS_PAGE.sub, "">;

/** The links of one site's section. */
export function sitePages(siteId: string, pathname: string, research: boolean): NavLink[] {
  const base = `/sites/${siteId}`;
  const pages: SitePage[] = [...SITE_PAGES, ...(research ? SITE_RESEARCH_PAGES : []), SITE_SETTINGS_PAGE];
  return pages.map(({ sub, label }) => {
    const href = sub ? `${base}/${sub}` : base;
    const active = sub ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
    return { href, label, icon: `site-${sub || "overview"}` as NavIcon, active };
  });
}

/** The six sections of a project; `active` is the open one when the project page is open. */
export function projectSections(slug: string, openTab: ProjectTab | null, tasks?: { open: number; review: number }): NavLink[] {
  return PROJECT_TABS.map((t) => {
    const link: NavLink = { href: projectTabHref(slug, t), label: M.tabs[t], icon: `tab-${t}` as const, active: t === openTab };
    if (t === "tasks" && tasks && tasks.open > 0) {
      link.badge = { text: String(tasks.open), title: M.nav.taskBadge(tasks.open, tasks.review), tone: tasks.review > 0 ? "attention" : "neutral" };
    }
    return link;
  });
}

/** The General block at the bottom of the sidebar: the pages about every project, the same on every screen. */
export function generalNav(pathname: string): NavLink[] {
  return [
    { href: "/projects/sources", label: M.nav.sources, icon: "sources", active: pathname === "/projects/sources" },
    { href: "/projects/groups", label: M.nav.groups, icon: "groups", active: pathname === "/projects/groups" },
    { href: "/settings", label: M.nav.settings, icon: "settings", active: pathname === "/settings" || pathname.startsWith("/settings/") },
  ];
}

/** One site of the open project, under a heading named after its domain. */
export type SiteSection = {
  kind: "site";
  siteId: string;
  domain: string;
  /** The heading's link: from a site page the same page of this site, else its overview. */
  href: string;
  /** The open site. */
  current: boolean;
  /** Its pages are listed: always with one site, only the open one with several. */
  expanded: boolean;
  items: NavLink[];
};

export type NavSection =
  | { kind: "project"; title: string; items: NavLink[] }
  | SiteSection
  /** One line instead of a section: Add a domain (a project without sites), Link to a project (a site without one). */
  | { kind: "action"; item: NavLink };

export type ContextNav = {
  context: "global" | "project" | "site";
  /** The Projects item above the switcher: active on the list and on New project. */
  projects: NavLink;
  project: NavProject | null;
  /** The open site when it is in none of the user's projects. */
  unassignedSite: NavSite | null;
  sections: NavSection[];
  /** The mobile header's title: the client, or the open general page; null shows the logo. */
  title: string | null;
  /** The mobile strip under the header: the project's sections, or the open site's pages after a line back to its project. */
  strip: { back: { href: string; label: string; title: string } | null; items: NavLink[] } | null;
};

const GLOBAL_TITLES: Record<string, string> = {
  "/projects": M.nav.projects,
  "/projects/new": M.nav.newProject,
  "/projects/sources": M.nav.sources,
  "/projects/groups": M.nav.groups,
  "/settings": M.nav.settings,
  "/sites": M.nav.allSites,
};

/**
 * The sidebar of a screen. `tab` is the `?tab=` value of a project page
 * (a former key counts as the tab it moved to); `research` is false without
 * DataForSEO.
 */
export function contextNav({ pathname, tab, nav, research }: { pathname: string; tab: string | null; nav: ProjectNav; research: boolean }): ContextNav {
  const view = switcherView(pathname, nav);
  const projects: NavLink = {
    href: "/projects",
    label: M.nav.projects,
    icon: "projects",
    active: pathname === "/projects" || pathname === "/projects/new",
  };
  const siteId = view.siteId;

  const siteSection = (s: NavSite, several: boolean): SiteSection => {
    const current = s.id === siteId;
    const expanded = !several || current;
    return {
      kind: "site",
      siteId: s.id,
      domain: s.domain,
      href: siteId ? sitePathFor(pathname, s.id) : `/sites/${s.id}`,
      current,
      expanded,
      items: expanded ? sitePages(s.id, pathname, research) : [],
    };
  };

  if (view.unassignedSite) {
    const site = siteSection(view.unassignedSite, false);
    return {
      context: "site",
      projects,
      project: null,
      unassignedSite: view.unassignedSite,
      sections: [{ kind: "action", item: { href: "/projects#unassigned", label: M.nav.linkToProject, icon: "link", active: false } }, site],
      title: M.nav.unassigned,
      strip: { back: { href: "/projects#unassigned", label: site.domain, title: M.nav.unassigned }, items: site.items },
    };
  }

  const project = view.project;
  if (!project) {
    return { context: "global", projects, project: null, unassignedSite: null, sections: [], title: GLOBAL_TITLES[pathname] ?? null, strip: null };
  }

  const openTab = siteId ? null : resolveProjectTab(tab ?? undefined).tab;
  const sectionItems = projectSections(project.slug, openTab, project.tasks);
  const sections: NavSection[] = [{ kind: "project", title: M.nav.project, items: sectionItems }];
  const several = project.sites.length > 1;
  for (const s of project.sites) sections.push(siteSection(s, several));
  if (project.sites.length === 0 && project.canEdit) {
    sections.push({ kind: "action", item: { href: projectTabHref(project.slug, "data", { section: "sites" }), label: M.nav.addDomain, icon: "add", active: false } });
  }

  const open = sections.find((s): s is SiteSection => s.kind === "site" && s.current);
  return {
    context: siteId ? "site" : "project",
    projects,
    project,
    unassignedSite: null,
    sections,
    title: project.name,
    strip: open
      ? { back: { href: projectTabHref(project.slug, "overview"), label: open.domain, title: project.name }, items: open.items }
      : { back: null, items: sectionItems },
  };
}
