import { sitePathFor } from "@/lib/site-routes";
import { PROJECT_STATUSES } from "./schema";
import { projectTabHref, resolveProjectTab } from "./tabs";

/*
 * The project switcher of the sidebar (agency fork). A project is the only
 * top-level entity; a site is opened through its project. Pure, so the client
 * components import it; the loader that reads the database is in ./shell.ts.
 */

export type NavSite = { id: string; domain: string };
export type NavProject = {
  slug: string;
  name: string;
  status: string;
  group: string | null;
  /** The actor's own sites in the project (only an owner opens a site). */
  sites: NavSite[];
  /** Editor or owner: may add a domain to the project. */
  canEdit: boolean;
  /** Tasks not done, and those of them in review: the count next to Tasks in the sidebar. */
  tasks?: { open: number; review: number };
};
export type NavGroup<T> = { name: string | null; projects: T[] };
export type ProjectNav = {
  groups: NavGroup<NavProject>[];
  /** The actor's own sites outside every project they see. */
  unassigned: NavSite[];
};

const STATUS_RANK = new Map<string, number>(PROJECT_STATUSES.map((s, i) => [s, i]));
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * Projects by `group`: the ungrouped first (shown without a heading), then named groups in alphabetical order.
 * Inside a group: clients, prospects, paused, archived, then by name.
 */
export function groupProjects<T extends { name: string; status: string; group: string | null }>(projects: T[]): NavGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const p of projects) {
    const key = p.group?.trim() || null;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const rank = (s: string) => STATUS_RANK.get(s) ?? STATUS_RANK.size;
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : byText(a, b)))
    .map(([name, list]) => ({
      name,
      projects: [...list].sort((a, b) => rank(a.status) - rank(b.status) || byText(a.name, b.name)),
    }));
}

export type SwitcherView = {
  /** The project of the open page: /projects/{slug}/... or a site of it. */
  project: NavProject | null;
  /** The open site, when the page is under /sites/{id}. */
  siteId: string | null;
  /** The open site when it is in none of the actor's projects. */
  unassignedSite: NavSite | null;
};

/** What the switcher shows on a path. */
export function switcherView(pathname: string, nav: ProjectNav): SwitcherView {
  const projects = nav.groups.flatMap((g) => g.projects);
  const siteId = pathname.match(/^\/sites\/([^/]+)/)?.[1] ?? null;
  if (siteId) {
    const project = projects.find((p) => p.sites.some((s) => s.id === siteId)) ?? null;
    const unassignedSite = project ? null : (nav.unassigned.find((s) => s.id === siteId) ?? null);
    return { project, siteId: project || unassignedSite ? siteId : null, unassignedSite };
  }
  const slug = pathname.match(/^\/projects\/([^/?]+)/)?.[1];
  const project = slug ? (projects.find((p) => p.slug === decodeURIComponentSafe(slug)) ?? null) : null;
  return { project, siteId: null, unassignedSite: null };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Where choosing another project in the switcher leads: the same screen of
 * that project. From a section of a project page, the same section (`?tab=`,
 * a former key as its new tab); from a site page, the same page of the
 * project's first site (its overview when the page is not a known one), or
 * the project's Overview when it has no site of the user's; from anywhere
 * else, the project's Overview.
 */
export function switchTarget({ pathname, tab, nav, target }: { pathname: string; tab: string | null; nav: ProjectNav; target: NavProject }): string {
  if (/^\/sites\/[^/]+/.test(pathname)) {
    const first = target.sites[0];
    return first ? sitePathFor(pathname, first.id) : projectTabHref(target.slug, "overview");
  }
  const fromProject = switcherView(pathname, nav).project !== null;
  return projectTabHref(target.slug, fromProject ? resolveProjectTab(tab ?? undefined).tab : "overview");
}
