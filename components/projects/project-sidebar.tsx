"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { contextNav, type NavSection } from "@/lib/projects/nav-items";
import type { ProjectNav } from "@/lib/projects/navigation";
import { NavItemLink } from "./global-nav";
import { NAV_ICONS } from "./nav-icons";
import { ProjectSwitcher } from "./project-switcher";
import { WithProjectTab } from "./with-project-tab";

const LABEL_CLASS = "px-2.5 pb-1.5 text-[12px] leading-4 text-muted-foreground";

/**
 * Agency fork: the top of the sidebar, in place of upstream's site switcher
 * and SidebarNav (which stay in the tree unchanged). Projects, the project
 * switcher, then inside a project its six sections and a section per site
 * named after the domain (lib/projects/nav-items.ts). The project page and its
 * sites share this one menu: going between them is a click on the next item.
 */
export function ProjectSidebar({ nav, research = true, collapsed = false }: { nav: ProjectNav; research?: boolean; collapsed?: boolean }) {
  return <WithProjectTab>{(tab) => <SidebarBody nav={nav} research={research} collapsed={collapsed} tab={tab} />}</WithProjectTab>;
}

function SidebarBody({ nav, research, collapsed, tab }: { nav: ProjectNav; research: boolean; collapsed: boolean; tab: string | null }) {
  const pathname = usePathname();
  const model = contextNav({ pathname, tab, nav, research });
  return (
    <div className={cn("flex flex-col gap-[22px]", collapsed && "items-center")}>
      <div className={cn("flex flex-col gap-1.5", collapsed && "items-center")}>
        <NavItemLink item={model.projects} collapsed={collapsed} />
        <ProjectSwitcher nav={nav} collapsed={collapsed} tab={tab} />
      </div>
      {model.sections.length > 0 && (
        <nav aria-label={M.nav.sections(model.title ?? M.nav.project)} className={cn("flex flex-col gap-[22px]", collapsed && "items-center gap-3")}>
          {model.sections.map((section) => (
            <Section key={sectionKey(section)} section={section} collapsed={collapsed} />
          ))}
        </nav>
      )}
    </div>
  );
}

const sectionKey = (s: NavSection) => (s.kind === "site" ? `site-${s.siteId}` : s.kind === "action" ? `action-${s.item.href}` : "project");

function Section({ section, collapsed }: { section: NavSection; collapsed: boolean }) {
  if (section.kind === "action") return <NavItemLink item={section.item} collapsed={collapsed} withIcon />;

  if (section.kind === "project") {
    return (
      <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
        {collapsed ? <Divider /> : <p className={LABEL_CLASS}>{section.title}</p>}
        {section.items.map((item) => (
          <NavItemLink key={item.href} item={item} collapsed={collapsed} />
        ))}
      </div>
    );
  }

  // A site of the project: its pages under its domain, or only the domain (a link to it) while another site is open.
  if (!section.expanded) {
    if (collapsed) {
      const Icon = NAV_ICONS.site;
      return (
        <Link
          href={section.href}
          title={section.domain}
          aria-label={section.domain}
          className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-bg-section hover:text-text-strong"
        >
          <Icon className="size-4" aria-hidden />
        </Link>
      );
    }
    return (
      <Link
        href={section.href}
        className="-my-2.5 flex h-[34px] items-center justify-between gap-2 rounded-md px-2.5 font-data text-[13px] text-muted-foreground transition-colors hover:bg-bg-section hover:text-text-strong"
      >
        <span className="truncate">{section.domain}</span>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      </Link>
    );
  }
  return (
    <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
      {collapsed ? (
        <Divider title={section.domain} />
      ) : (
        <p className={cn(LABEL_CLASS, "truncate font-data")} title={section.domain}>
          {section.domain}
        </p>
      )}
      {section.items.map((item) => (
        <NavItemLink key={item.href} item={item} collapsed={collapsed} />
      ))}
    </div>
  );
}

function Divider({ title }: { title?: string }) {
  return <span aria-hidden title={title} className="mb-1 h-px w-6 bg-border" />;
}
