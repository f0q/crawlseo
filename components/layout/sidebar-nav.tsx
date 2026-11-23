"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Globe,
  Search,
  FileText,
  Bug,
  Gauge,
  Lightbulb,
  Bell,
  Settings,
  Bookmark,
  Link as LinkIcon,
  SearchCheck,
  TrendingUp,
  FolderKanban,
  BarChart3,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import { PROJECT_MESSAGES } from "@/lib/projects/messages";
import { switcherView, type ProjectNav } from "@/lib/projects/navigation";
import { YANDEX_UI } from "@/lib/yandex/messages";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = {
  /** Agency fork: a group without a label shows only its items. */
  label: string | null;
  items: NavItem[];
};

export function SidebarNav({
  sites,
  collapsed = false,
  projectNav,
  research = true,
}: {
  sites: { id: string; domain: string }[];
  collapsed?: boolean;
  /** Agency fork: the project of the open site, for the way back to it (lib/projects/navigation). */
  projectNav?: ProjectNav;
  /** Agency fork: false hides the Research group (DataForSEO not connected). */
  research?: boolean;
}) {
  const pathname = usePathname();
  const match = pathname.match(/\/sites\/([^/]+)/);
  const activeSiteId =
    match?.[1] && sites.some((s) => s.id === match[1]) ? match[1] : undefined;
  const project = activeSiteId && projectNav ? switcherView(pathname, projectNav).project : null;

  const workspaceNav: NavGroup | null = activeSiteId
    ? {
        // Agency fork: the group is named after the site, not "Workspace".
        label: sites.find((s) => s.id === activeSiteId)?.domain ?? "Workspace",
        items: [
          { href: `/sites/${activeSiteId}`, label: "Overview", icon: LayoutDashboard, exact: true },
          { href: `/sites/${activeSiteId}/keywords`, label: "Keywords", icon: Search },
          { href: `/sites/${activeSiteId}/saved-keywords`, label: "Saved keywords", icon: Bookmark },
          // Agency fork: rank tracking positions (lib/rank-providers).
          { href: `/sites/${activeSiteId}/positions`, label: "Positions", icon: TrendingUp },
          // Agency fork: Yandex Metrika and Webmaster (lib/yandex).
          { href: `/sites/${activeSiteId}/yandex`, label: YANDEX_UI.nav, icon: BarChart3 },
          { href: `/sites/${activeSiteId}/pages`, label: "Pages", icon: FileText },
          { href: `/sites/${activeSiteId}/crawl`, label: "Crawl / Audit", icon: Bug },
          { href: `/sites/${activeSiteId}/vitals`, label: "Vitals", icon: Gauge },
          { href: `/sites/${activeSiteId}/opportunities`, label: "Opportunities", icon: Lightbulb },
          { href: `/sites/${activeSiteId}/alerts`, label: "Alerts", icon: Bell },
        ],
      }
    : null;

  const researchNav: NavGroup | null = activeSiteId && research
    ? {
        label: "Research",
        items: [
          { href: `/sites/${activeSiteId}/keyword-research`, label: "Keyword research", icon: SearchCheck },
          { href: `/sites/${activeSiteId}/domain-overview`, label: "Domain overview", icon: Globe },
          { href: `/sites/${activeSiteId}/backlinks`, label: "Backlinks", icon: LinkIcon },
        ],
      }
    : null;

  const connectNav: NavGroup | null = activeSiteId
    ? {
        label: "Connect",
        items: [
          // Agency fork: AI & MCP (/sites/[id]/mcp) is left out of the menu; Settings > MCP has it.
          { href: `/sites/${activeSiteId}/settings`, label: "Site settings", icon: Settings },
        ],
      }
    : null;

  // Agency fork: client projects (lib/projects), on every page; on a site, the way back to its project first.
  const projectsNav: NavGroup = {
    label: null,
    items: [
      ...(project
        ? [{ href: `/projects/${project.slug}`, label: PROJECT_MESSAGES.nav.backToProject(project.name), icon: ChevronLeft, exact: true }]
        : []),
      // Agency fork: active on the list only; Data sources and Groups are in the General block (components/projects/global-nav.tsx).
      { href: "/projects", label: PROJECT_MESSAGES.nav.projects, icon: FolderKanban, exact: true },
    ],
  };

  // The home (All sites, or any page outside a site) has no site groups: the
  // workspace switcher above is the way into a site.
  const groups = [projectsNav, workspaceNav, researchNav, connectNav].filter(
    (g): g is NavGroup => g !== null
  );

  if (groups.length === 0) return null;

  return (
    <nav aria-label="Main" className={cn("flex flex-col gap-[22px]", collapsed && "items-center")}>
      {groups.map((group, i) => (
        <div key={group.label ?? i} className="flex flex-col gap-0.5">
          {!collapsed && group.label && (
            <p className="px-2.5 pb-1.5 text-[12px] leading-4 text-muted-foreground">
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const Icon = item.icon;

  // The active item is never coloured: a neutral background and weight only.
  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex size-10 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-border-soft text-text-strong"
            : "text-muted-foreground hover:bg-bg-section hover:text-text-strong"
        )}
      >
        <Icon className="size-4" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[34px] items-center rounded-md px-2.5 text-[14px] transition-colors",
        active
          ? "bg-border-soft font-medium text-text-strong"
          : "text-text hover:bg-bg-section hover:text-text-strong"
      )}
    >
      {item.label}
    </Link>
  );
}
