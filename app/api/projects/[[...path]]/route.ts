import { auth } from "@/lib/auth";
import { handleDashboardProjects } from "@/lib/projects/dashboard";

// Agency fork: client projects for the dashboard (lib/projects/http.ts), as the signed-in user.
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const session = await auth();
  return handleDashboardProjects(session?.user, req);
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
