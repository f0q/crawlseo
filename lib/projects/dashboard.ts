import { ApiError } from "@/lib/api-v1/params";
import type { Actor } from "./access";
import { routeProjects } from "./http";

/*
 * /api/projects (agency fork): the projects routes for the dashboard, as the
 * signed-in user. The same routes as /api/v1/projects, plus members, sites
 * and DELETE.
 */

type SessionUser = { id?: string | null; email?: string | null } | null | undefined;

export function sessionActor(user: SessionUser): Actor | null {
  if (!user?.id) return null;
  return { userId: user.id, email: user.email ?? null, kind: "human", label: user.email ?? user.id };
}

export async function handleDashboardProjects(user: SessionUser, req: Request): Promise<Response> {
  const actor = sessionActor(user);
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const segments = url.pathname
    .replace(/^\/api\/projects\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return "\u0000";
      }
    });
  try {
    return await routeProjects(actor, req, segments, url.searchParams, "dashboard");
  } catch (err) {
    if (err instanceof ApiError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[api/projects]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
