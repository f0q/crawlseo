import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleProjects } from "@/lib/projects/access";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { Breadcrumbs } from "./breadcrumbs";

/**
 * Agency fork: the path above every site page, `Projects / project / domain`.
 * A site in none of the user's projects says so and leads to the projects
 * page, where such sites are listed. Nothing is shown for a site that is not the user's (the page
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
    <Breadcrumbs
      label={M.nav.breadcrumbs}
      items={[
        { label: M.nav.projects, href: "/projects" },
        project ? { label: project.name, href: `/projects/${project.slug}` } : { label: M.nav.unassigned, href: "/projects#unassigned" },
        { label: site.domain, mono: true },
      ]}
    />
  );
}
