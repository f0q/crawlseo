/*
 * The tabs of a project page (agency fork, UX step 3): six tabs, with the
 * former ones kept as aliases so old links (bookmarks, emails, docs, the
 * sources panel) still land in the right place, on the right section.
 * Pure, so pages, components and tests import it.
 */

export const PROJECT_TABS = ["overview", "tasks", "journal", "data", "money", "about"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** Sections inside a tab that a link can lead to (the element ids on the page). */
export const TAB_SECTIONS = {
  data: ["sources", "sites", "rank"],
  about: ["passport", "brief", "members"],
} as const;
export type TabSection = (typeof TAB_SECTIONS)[keyof typeof TAB_SECTIONS][number];

/** Former tab keys: the tab they moved to and the section that holds them now. */
const LEGACY_TABS: Record<string, { tab: ProjectTab; section: TabSection | null }> = {
  sites: { tab: "data", section: "sites" },
  rank: { tab: "data", section: "rank" },
  budget: { tab: "money", section: null },
  passport: { tab: "about", section: "passport" },
  brief: { tab: "about", section: "brief" },
  members: { tab: "about", section: "members" },
};

export type ResolvedTab = {
  tab: ProjectTab;
  /** The section a former tab key leads to, or null. */
  section: TabSection | null;
  /** The query value was a former tab key: the page should move to the canonical URL. */
  legacy: boolean;
};

/** The tab of a `?tab=` value: a current tab, a former one mapped to its new place, else the Overview. */
export function resolveProjectTab(value: unknown): ResolvedTab {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string") return { tab: "overview", section: null, legacy: false };
  if ((PROJECT_TABS as readonly string[]).includes(v)) return { tab: v as ProjectTab, section: null, legacy: false };
  const old = Object.hasOwn(LEGACY_TABS, v) ? LEGACY_TABS[v] : undefined;
  return old ? { ...old, legacy: true } : { tab: "overview", section: null, legacy: false };
}

/** The link to a tab of a project, optionally to a section of it, with extra query values (e.g. `month`). */
export function projectTabHref(slug: string, tab: ProjectTab, opts: { section?: TabSection | null; query?: Record<string, string | undefined> } = {}): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") params.set(k, v);
  const qs = params.toString();
  return `/projects/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}${opts.section ? `#${opts.section}` : ""}`;
}
