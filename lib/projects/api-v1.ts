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

/** The methods /api/v1/projects takes. DELETE: only a site out of a project; every other DELETE is the dashboard's. */
export const PROJECT_API_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

/** What a key of the "billing" scope may change: the payment dates and the never-pause switch. */
export const BILLING_FIELDS = ["paidUntil", "contractEnd", "billingNeverPause"] as const;

/**
 * A "billing" key (a CRM): GET /projects and /projects/{slug}, and PATCH
 * /projects/{slug} with only BILLING_FIELDS in the body. Everything else is refused.
 */
export async function billingKeyAllows(req: Request, segments: string[]): Promise<boolean> {
  const [root, slug, ...rest] = segments;
  if (root !== PROJECTS_ROOT || rest.length > 0 || (slug ?? "").startsWith("_")) return false;
  if (req.method === "GET") return true;
  if (req.method !== "PATCH" || !slug) return false;
  const body: unknown = await req.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((k) => (BILLING_FIELDS as readonly string[]).includes(k));
}

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
