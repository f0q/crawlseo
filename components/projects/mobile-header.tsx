"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { contextNav } from "@/lib/projects/nav-items";
import type { ProjectNav } from "@/lib/projects/navigation";
import { ContextStrip } from "./context-strip";
import { ProjectSwitcher } from "./project-switcher";
import { WithProjectTab } from "./with-project-tab";

/**
 * Agency fork: the top of the page on a phone, fixed while it scrolls. The
 * menu button and where you are: the client (a tap on it is the project
 * switcher), or the open general page ("Projects", "Data sources"), the logo
 * elsewhere. Under it, inside a project, the strip of its sections or of the
 * open site's pages. The menu opens the same sidebar as on a laptop.
 */
export function MobileHeader({ nav, research = true, onOpenMenu }: { nav: ProjectNav; research?: boolean; onOpenMenu: () => void }) {
  return <WithProjectTab>{(tab) => <HeaderBody nav={nav} research={research} tab={tab} onOpenMenu={onOpenMenu} />}</WithProjectTab>;
}

function HeaderBody({ nav, research, tab, onOpenMenu }: { nav: ProjectNav; research: boolean; tab: string | null; onOpenMenu: () => void }) {
  const pathname = usePathname();
  const model = contextNav({ pathname, tab, nav, research });
  return (
    <div className="sticky top-0 z-30 md:hidden">
      <header className="flex h-14 items-center gap-1 border-b border-border bg-bg px-2">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={M.nav.openMenu}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-text-strong hover:bg-bg-section"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        {model.context !== "global" ? (
          <ProjectSwitcher nav={nav} tab={tab} variant="header" />
        ) : model.title ? (
          <span className="truncate px-1 text-[15px] font-medium text-text-strong">{model.title}</span>
        ) : (
          <Link href="/projects" aria-label="crawlseo" className="flex h-11 items-center px-1 text-text-strong">
            <Logo decorative className="h-[22px]" />
          </Link>
        )}
      </header>
      {model.strip && <ContextStrip strip={model.strip} label={M.nav.sections(model.title ?? M.nav.project)} />}
    </div>
  );
}
