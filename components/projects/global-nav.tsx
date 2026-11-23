"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { generalNav, type NavLink } from "@/lib/projects/nav-items";
import { NAV_ICONS } from "./nav-icons";

/**
 * Agency fork: the General block at the bottom of the sidebar (Data sources,
 * Groups, Settings). The same on every screen: what is above it is about the
 * open client, what is in it is about every project.
 */
export function GlobalNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={M.nav.general} className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
      {collapsed ? (
        <span aria-hidden className="mb-1 h-px w-6 bg-border" />
      ) : (
        <p className="px-2.5 pb-1.5 text-[12px] leading-4 text-muted-foreground">{M.nav.general}</p>
      )}
      {generalNav(pathname).map((item) => (
        <NavItemLink
          key={item.href}
          item={item}
          collapsed={collapsed}
          withIcon
          className={item.active ? "bg-white font-medium text-text-strong shadow-sm" : "hover:bg-white/70"}
        />
      ))}
    </nav>
  );
}

/**
 * One sidebar item: the label (after its icon with `withIcon`), or only its
 * icon when collapsed. The active item has a neutral background and weight only.
 */
export function NavItemLink({ item, collapsed, withIcon = false, className }: { item: NavLink; collapsed: boolean; withIcon?: boolean; className?: string }) {
  const Icon = NAV_ICONS[item.icon];
  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={item.active ? "page" : undefined}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md transition-colors",
          item.active ? "bg-border-soft text-text-strong" : "text-muted-foreground hover:bg-bg-section hover:text-text-strong",
          className
        )}
      >
        <Icon className="size-4" aria-hidden />
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "flex h-[34px] items-center gap-2 rounded-md px-2.5 text-[14px] transition-colors",
        item.active ? "bg-border-soft font-medium text-text-strong" : "text-text hover:bg-bg-section hover:text-text-strong",
        className
      )}
    >
      {withIcon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
