import { PROJECT_MESSAGES as M } from "./messages";

/*
 * The items of the agency sidebar (agency fork, navigation model of
 * 2026-11-23). Pure, so the sidebar, the mobile strip and the tests build
 * the same list. Icons are named here and drawn in components/projects/nav-icons.ts.
 */

export type NavIcon =
  | "projects"
  | "sources"
  | "groups"
  | "settings";

export type NavLink = { href: string; label: string; icon: NavIcon; active: boolean };

/** The General block at the bottom of the sidebar: the pages about every project, the same on every screen. */
export function generalNav(pathname: string): NavLink[] {
  return [
    { href: "/projects/sources", label: M.nav.sources, icon: "sources", active: pathname === "/projects/sources" },
    { href: "/projects/groups", label: M.nav.groups, icon: "groups", active: pathname === "/projects/groups" },
    { href: "/settings", label: M.nav.settings, icon: "settings", active: pathname === "/settings" || pathname.startsWith("/settings/") },
  ];
}
