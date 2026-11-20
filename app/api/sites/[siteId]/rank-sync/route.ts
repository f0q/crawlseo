import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { RANK_SYNC_JOB } from "@/lib/rank-providers/jobs";
import { rankProviderIds } from "@/lib/rank-providers/registry";
import { ownSiteOrResponse } from "@/lib/rank-providers/routes";

/**
 * Queues a rank sync of every provider engine of the site and answers 202
 * with the job id, like POST /api/bing/sync. The client polls GET
 * /api/jobs/[jobId]; the result has engines, datesFetched, rowsWritten and,
 * when some engines failed, failed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    const engines = await db.externalRankEngine.count({ where: { siteId, source: { in: rankProviderIds() } } });
    if (engines === 0) {
      return Response.json({ error: "No rank provider engine is linked to this site" }, { status: 400 });
    }

    registerExtensions();
    const { job, created } = await requestSiteJob(db, { type: RANK_SYNC_JOB, siteId, source: "manual" });
    dispatchJob(db, job);

    return Response.json({ jobId: job.id, status: job.status, ...(!created && { alreadyActive: true }) }, { status: 202 });
  } catch (error) {
    console.error("Rank sync error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Rank sync failed" }, { status: 500 });
  }
}
