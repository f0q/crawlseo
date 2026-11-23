import { db } from "@/lib/db";
import { atLeast, rolesOf, visibleProjects, type Actor } from "./access";
import { sessionActor } from "./dashboard";
import { groupProjects, type ProjectNav } from "./navigation";

type SessionUser = { id?: string | null; email?: string | null } | null | undefined;

/**
 * Agency fork: what the dashboard layout adds to the sidebar. The project
 * switcher's data, and whether the user has DataForSEO connected (without it
 * the Research pages of a site have nothing to show, so the group is hidden;
 * the pages still open by link).
 */
export async function loadShellExtras(user: SessionUser): Promise<{ projectNav?: ProjectNav; research: boolean }> {
  const actor = sessionActor(user);
  if (!actor) return { research: true };
  const [projectNav, dataforseo] = await Promise.all([
    loadProjectNav(actor),
    db.apiKey.findUnique({ where: { userId_provider: { userId: actor.userId, provider: "dataforseo" } }, select: { id: true } }),
  ]);
  return { projectNav, research: dataforseo !== null };
}

/**
 * The switcher's data for the actor: the projects they see with their own
 * sites in each (only an owner opens a site), and their sites in none of
 * those projects, so those stay reachable.
 */
export async function loadProjectNav(actor: Actor): Promise<ProjectNav> {
  const [projects, own] = await Promise.all([
    db.project.findMany({
      where: visibleProjects(actor),
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        group: true,
        sites: { where: { userId: actor.userId }, select: { id: true, domain: true }, orderBy: { domain: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    db.site.findMany({ where: { userId: actor.userId }, select: { id: true, domain: true }, orderBy: { domain: "asc" } }),
  ]);
  const inProjects = new Set(projects.flatMap((p) => p.sites.map((s) => s.id)));
  const roles = await rolesOf(actor, projects.map((p) => p.id));
  return {
    groups: groupProjects(projects.map(({ id, ...p }) => ({ ...p, canEdit: atLeast(roles.get(id) ?? "viewer", "editor") }))),
    unassigned: own.filter((s) => !inProjects.has(s.id)),
  };
}
