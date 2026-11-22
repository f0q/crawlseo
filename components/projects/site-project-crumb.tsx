import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleProjects } from "@/lib/projects/access";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";

/**
 * Agency fork: the line above every site page that says which project the
 * site belongs to and leads back to it. A site in none of the user's
 * projects says so and leads to the projects page, where such sites are
 * listed. Nothing is shown for a site that is not the user's (the page
 * itself answers 404).
 */
export async function SiteProjectCrumb({ siteId }: { siteId: string }) {
  const actor = sessionActor((await auth())?.user);
  if (!actor) return null;
  const site = await db.site.findFirst({
    where: { id: siteId, userId: actor.userId },
    select: { domain: true, projectId: true },
  });
  if (!site) return null;
  const project = site.projectId
    ? await db.project.findFirst({ where: { AND: [{ id: site.projectId }, visibleProjects(actor)] }, select: { slug: true, name: true } })
    : null;
  return (
    <nav aria-label={M.nav.project} className="mb-3 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <ChevronLeft aria-hidden className="size-3.5 shrink-0" />
      {project ? (
        <Link href={`/projects/${project.slug}`} className="truncate hover:text-text-strong">
          {project.name}
        </Link>
      ) : (
        <Link href="/projects#unassigned" className="truncate hover:text-text-strong">
          {M.nav.unassigned}
        </Link>
      )}
      <span aria-hidden>/</span>
      <span className="truncate font-data text-text">{site.domain}</span>
    </nav>
  );
}
