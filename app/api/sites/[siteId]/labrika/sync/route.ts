import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { LABRIKA_SYNC_JOB } from "@/lib/labrika/jobs";
import { LABRIKA_SOURCE } from "@/lib/labrika/labrika-parse";

/**
 * Queues a Labrika sync for the site and answers 202 with the job id, like
 * POST /api/bing/sync. The client polls GET /api/jobs/[jobId]; the result has
 * engines, datesFetched, rowsWritten and, when some engines failed, failed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = await params;
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { userId: true, _count: { select: { rankEngines: { where: { source: LABRIKA_SOURCE } } } } },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Site not found or unauthorized" }, { status: 404 });
    }
    if (site._count.rankEngines === 0) {
      return Response.json({ error: "No Labrika search engine is linked to this site" }, { status: 400 });
    }

    registerExtensions();
    const { job, created } = await requestSiteJob(db, { type: LABRIKA_SYNC_JOB, siteId, source: "manual" });
    dispatchJob(db, job);

    return Response.json(
      { jobId: job.id, status: job.status, ...(!created && { alreadyActive: true }) },
      { status: 202 }
    );
  } catch (error) {
    console.error("Labrika sync error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Labrika sync failed" }, { status: 500 });
  }
}
