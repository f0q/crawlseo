import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { ownSiteOrResponse } from "@/lib/rank-providers/routes";
import { YANDEX_SYNC_JOB } from "@/lib/yandex/jobs";
import { YANDEX_UI } from "@/lib/yandex/messages";

/**
 * Sync now: queues a Yandex sync of the site and answers 202 with the job id,
 * like POST /api/sites/{id}/rank-sync. The client polls GET /api/jobs/[jobId].
 */
export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    const link = await db.yandexSiteLink.findUnique({ where: { siteId }, select: { webmasterHostId: true, metrikaCounterId: true } });
    if (!link?.webmasterHostId && !link?.metrikaCounterId) return Response.json({ error: YANDEX_UI.errors.noLink }, { status: 400 });

    registerExtensions();
    const { job, created } = await requestSiteJob(db, { type: YANDEX_SYNC_JOB, siteId, source: "manual" });
    dispatchJob(db, job);
    return Response.json({ jobId: job.id, status: job.status, ...(!created && { alreadyActive: true }) }, { status: 202 });
  } catch (error) {
    console.error("Yandex sync error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Yandex sync failed" }, { status: 500 });
  }
}
