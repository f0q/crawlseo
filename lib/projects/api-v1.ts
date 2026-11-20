import type { KeyOwner } from "@/lib/access-keys";
import { db } from "@/lib/db";
import type { Actor } from "./access";
import { routeProjects } from "./http";

/*
 * /api/v1/projects (agency fork): the projects routes for an access key. The
 * key's user is the actor, so the key sees the projects its user is a member
 * of, with that user's role. The router has already refused writes with a
 * read-only key.
 */

export const PROJECTS_ROOT = "projects";

/** The methods /api/v1/projects takes; the dashboard routes also take DELETE. */
export const PROJECT_API_METHODS = ["GET", "POST", "PATCH"] as const;

export async function keyActor(owner: KeyOwner): Promise<Actor> {
  const [user, key] = await Promise.all([
    db.user.findUnique({ where: { id: owner.userId }, select: { email: true } }),
    db.accessKey.findUnique({ where: { id: owner.keyId }, select: { name: true } }),
  ]);
  const email = user?.email ?? null;
  return { userId: owner.userId, email, kind: "agent", label: `${email ?? owner.userId} (key ${key?.name ?? owner.keyId})` };
}

export async function projectsApi(owner: KeyOwner, req: Request, segments: string[], params: URLSearchParams): Promise<Response> {
  return routeProjects(await keyActor(owner), req, segments.slice(1), params, "api");
}
