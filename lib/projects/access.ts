import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { PROJECT_MESSAGES as M } from "./messages";
import type { Role } from "./schema";

/*
 * Who may do what in a client project (agency fork). Every project route asks
 * here first. A user's role comes from their Membership; a user without one
 * does not see the project at all (404, like a missing one), except instance
 * admins (CRAWLSEO_ADMIN_EMAILS), who act as owners of every project.
 *
 *   viewer  reads everything, downloads files
 *   editor  also edits the passport, notes, files, tasks and the journal, adds their own sites
 *   owner   also manages members and deletes the project
 */

/** Who makes a request: a signed-in user (human) or an access key (agent). */
export type Actor = {
  userId: string;
  email: string | null;
  kind: "human" | "agent";
  /** Written as the author of notes, files and journal entries. */
  label: string;
};

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function isInstanceAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.CRAWLSEO_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function requireRole(role: Role, min: Role): void {
  if (!atLeast(role, min)) throw new ApiError(403, M.errors.forbidden(role, min));
}

/** The projects the actor sees, as a Prisma filter. */
export function visibleProjects(actor: Actor): Prisma.ProjectWhereInput {
  return isInstanceAdmin(actor.email) ? {} : { members: { some: { userId: actor.userId } } };
}

const asRole = (value: string | undefined): Role | null =>
  value === "owner" || value === "editor" || value === "viewer" ? value : null;

export type ProjectRef = { id: string; slug: string; name: string; role: Role };

/** The project with the actor's role in it, or 404. With `min`, a lower role is refused with 403. */
export async function projectFor(actor: Actor, slug: string, min: Role = "viewer"): Promise<ProjectRef> {
  const project = await db.project.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, members: { where: { userId: actor.userId }, select: { role: true } } },
  });
  const memberRole = asRole(project?.members[0]?.role);
  const role: Role | null = isInstanceAdmin(actor.email) ? "owner" : memberRole;
  if (!project || !role) throw new ApiError(404, M.errors.notFound);
  requireRole(role, min);
  return { id: project.id, slug: project.slug, name: project.name, role };
}

/** The actor's role in every project they are a member of, by project id. */
export async function rolesOf(actor: Actor, projectIds: string[]): Promise<Map<string, Role>> {
  const admin = isInstanceAdmin(actor.email);
  const rows = await db.membership.findMany({
    where: { userId: actor.userId, projectId: { in: projectIds } },
    select: { projectId: true, role: true },
  });
  const map = new Map<string, Role>();
  for (const id of projectIds) if (admin) map.set(id, "owner");
  for (const r of rows) {
    const role = asRole(r.role);
    if (role && !admin) map.set(r.projectId, role);
  }
  return map;
}
