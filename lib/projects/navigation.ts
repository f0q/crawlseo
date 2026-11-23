import { PROJECT_STATUSES } from "./schema";

/*
 * The project switcher of the sidebar (agency fork). A project is the only
 * top-level entity; a site is opened through its project. Pure, so the client
 * components import it; the loader that reads the database is in ./shell.ts.
 */

export type NavSite = { id: string; domain: string };
export type NavProject = { slug: string; name: string; status: string; group: string | null; sites: NavSite[] };
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
