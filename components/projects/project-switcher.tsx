"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, FolderKanban, Globe, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { sitePathFor } from "@/lib/site-routes";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { switcherView, type NavSite, type ProjectNav } from "@/lib/projects/navigation";

const T = M.nav;

const TRIGGER_CLASS =
  "flex items-center rounded-md border border-border bg-bg font-data text-[13px] text-text-strong transition-colors outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-popup-open:border-line-strong";
const POPUP_CLASS =
  "max-h-[min(460px,var(--available-height))] w-[var(--anchor-width)] min-w-[240px] max-w-[320px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-3)] outline-none";
const ITEM_CLASS =
  "flex h-9 w-full cursor-default items-center gap-2.5 rounded-sm px-2.5 font-data text-[13px] text-text-strong outline-none select-none data-highlighted:bg-bg-section";
const GROUP_LABEL_CLASS = "px-2.5 pt-2 pb-1 text-[11px] leading-4 text-muted-foreground";

/**
 * Agency fork: the switcher at the top of the sidebar. A project is the only
 * top-level entity: All projects, the projects by group, the user's sites
 * that are in no project (so they stay reachable) and New project. Inside a
 * project, a second line picks one of its sites: a plain label with one
 * site, a menu with several, nothing without sites.
 */
export function ProjectSwitcher({ nav, collapsed = false }: { nav: ProjectNav; collapsed?: boolean }) {
  const pathname = usePathname();
  const view = switcherView(pathname, nav);
  const label = view.project?.name ?? (view.unassignedSite ? T.unassigned : T.allProjects);

  return (
    <div className="flex flex-col gap-1.5">
      <Menu.Root>
        <Menu.Trigger
          aria-label={T.switcher(label)}
          title={collapsed ? label : undefined}
          className={cn(TRIGGER_CLASS, collapsed ? "size-10 justify-center" : "h-[38px] w-full justify-between gap-2 px-2.5")}
        >
          {collapsed ? (
            view.project ? (
              <span aria-hidden className="text-[14px] font-medium uppercase">
                {label.charAt(0)}
              </span>
            ) : (
              <FolderKanban className="size-4" aria-hidden />
            )
          ) : (
            <>
              <span className="flex min-w-0 items-center gap-2">
                {!view.project && <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="truncate">{label}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side={collapsed ? "right" : "bottom"} align="start" sideOffset={6} className="isolate z-50 outline-none">
            <Menu.Popup className={POPUP_CLASS}>
              <Menu.LinkItem
                render={<Link href="/projects" />}
                closeOnClick
                aria-current={pathname === "/projects" ? "page" : undefined}
                className={ITEM_CLASS}
              >
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{T.allProjects}</span>
              </Menu.LinkItem>
              {nav.groups.map((g) => (
                <Fragment key={g.name ?? "\u0000"}>
                  <Menu.Separator className="mx-1 my-1 h-px bg-border" />
                  <Menu.Group>
                  {g.name ? (
                    <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{T.groupLabel(g.name)}</Menu.GroupLabel>
                  ) : null}
                  {g.projects.map((p) => {
                    const current = view.project?.slug === p.slug;
                    return (
                      <Menu.LinkItem
                        key={p.slug}
                        render={<Link href={`/projects/${p.slug}`} />}
                        closeOnClick
                        aria-current={current ? "page" : undefined}
                        className={ITEM_CLASS}
                      >
                        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-[11px] text-muted-foreground uppercase">
                          {p.name.charAt(0)}
                        </span>
                        <span className={cn("min-w-0 flex-1 truncate", p.status === "archived" && "text-muted-foreground")}>{p.name}</span>
                        {current && <Check className="size-3.5 shrink-0 text-text-strong" aria-hidden />}
                      </Menu.LinkItem>
                    );
                  })}
                  </Menu.Group>
                </Fragment>
              ))}
              {nav.unassigned.length > 0 && <Menu.Separator className="mx-1 my-1 h-px bg-border" />}
              {nav.unassigned.length > 0 && (
                <Menu.Group>
                  <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{T.unassigned}</Menu.GroupLabel>
                  {nav.unassigned.map((s) => (
                    <Menu.LinkItem
                      key={s.id}
                      render={<Link href={sitePathFor(pathname, s.id)} />}
                      closeOnClick
                      aria-current={view.siteId === s.id ? "page" : undefined}
                      className={ITEM_CLASS}
                    >
                      <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.domain}</span>
                      {view.siteId === s.id && <Check className="size-3.5 shrink-0 text-text-strong" aria-hidden />}
                    </Menu.LinkItem>
                  ))}
                </Menu.Group>
              )}
              <Menu.Separator className="mx-1 my-1 h-px bg-border" />
              <Menu.LinkItem render={<Link href="/projects/new" />} closeOnClick className={ITEM_CLASS}>
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {T.newProject}
              </Menu.LinkItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {!collapsed && view.project && view.project.sites.length > 0 && (
        <SitePicker sites={view.project.sites} siteId={view.siteId} pathname={pathname} />
      )}
    </div>
  );
}

/** The project's sites: a plain label for one, a menu for several. On a project page, it leads to the site. */
function SitePicker({ sites, siteId, pathname }: { sites: NavSite[]; siteId: string | null; pathname: string }) {
  const current = sites.find((s) => s.id === siteId) ?? null;
  if (sites.length === 1) {
    const only = sites[0];
    return (
      <Link
        href={`/sites/${only.id}`}
        aria-current={current ? "page" : undefined}
        className="flex h-8 items-center gap-2 rounded-md px-2.5 font-data text-[13px] text-muted-foreground transition-colors hover:bg-bg-section hover:text-text-strong aria-[current=page]:text-text-strong"
      >
        <Globe className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{only.domain}</span>
      </Link>
    );
  }
  const label = current?.domain ?? T.chooseSite;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={T.sitePicker(label)} className={cn(TRIGGER_CLASS, "h-8 w-full justify-between gap-2 px-2.5")}>
        <span className="flex min-w-0 items-center gap-2">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn("truncate", !current && "text-muted-foreground")}>{label}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50 outline-none">
          <Menu.Popup className={POPUP_CLASS}>
            {sites.map((s) => (
              <Menu.LinkItem
                key={s.id}
                render={<Link href={current ? sitePathFor(pathname, s.id) : `/sites/${s.id}`} />}
                closeOnClick
                aria-current={s.id === siteId ? "page" : undefined}
                className={ITEM_CLASS}
              >
                <span className="min-w-0 flex-1 truncate">{s.domain}</span>
                {s.id === siteId && <Check className="size-3.5 shrink-0 text-text-strong" aria-hidden />}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
