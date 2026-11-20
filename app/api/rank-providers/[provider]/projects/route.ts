import { auth } from "@/lib/auth";
import { listProjectsWithEngines } from "@/lib/rank-providers/keys";
import { rankErrorResponse } from "@/lib/rank-providers/routes";

/** The rank tracking projects of the user's account at a provider, with their search engines. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { provider } = await params;
    return Response.json(await listProjectsWithEngines(session.user.id, provider));
  } catch (error) {
    const known = rankErrorResponse(error);
    if (known) return known;
    console.error("Error listing rank provider projects:", error);
    return Response.json({ error: "Failed to list the projects" }, { status: 500 });
  }
}
