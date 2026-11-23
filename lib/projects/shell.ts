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
  const ids = projects.map((p) => p.id);
  const [roles, counts] = await Promise.all([
    rolesOf(actor, ids),
    db.projectTask.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids }, status: { not: "done" } }, _count: { _all: true } }),
  ]);
  const tasks = new Map<string, { open: number; review: number }>();
  for (const c of counts) {
    const t = tasks.get(c.projectId) ?? { open: 0, review: 0 };
    t.open += c._count._all;
    if (c.status === "review") t.review += c._count._all;
    tasks.set(c.projectId, t);
  }
  return {
    groups: groupProjects(
      projects.map(({ id, ...p }) => ({ ...p, canEdit: atLeast(roles.get(id) ?? "viewer", "editor"), tasks: tasks.get(id) ?? { open: 0, review: 0 } }))
    ),
    unassigned: own.filter((s) => !inProjects.has(s.id)),
  };
}
