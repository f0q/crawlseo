import { db } from "@/lib/db";
import { ownSiteOrResponse } from "@/lib/rank-providers/routes";

/** Removes one rank engine of the site with every position stored for it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ siteId: string; engineId: string }> }) {
  try {
    const { siteId, engineId } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    const { count } = await db.externalRankEngine.deleteMany({ where: { id: engineId, siteId } });
    if (count === 0) return Response.json({ error: "No such rank engine on this site" }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Error deleting a rank engine:", error);
    return Response.json({ error: "Failed to delete the engine" }, { status: 500 });
  }
}
