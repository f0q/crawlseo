import { auth } from "@/lib/auth";
import { LabrikaApiError, LabrikaKeyMissingError, listLabrikaSites } from "@/lib/labrika";

/** The rank tracking projects of the user's Labrika account, with their search engines. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return Response.json(await listLabrikaSites(session.user.id));
  } catch (error) {
    if (error instanceof LabrikaKeyMissingError) {
      return Response.json({ error: error.message, code: "LABRIKA_KEY_MISSING" }, { status: 400 });
    }
    if (error instanceof LabrikaApiError) {
      return Response.json({ error: error.message, code: error.code }, { status: 502 });
    }
    console.error("Error listing Labrika sites:", error);
    return Response.json({ error: "Failed to list Labrika projects" }, { status: 500 });
  }
}
