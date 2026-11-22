import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { ownSiteOrResponse } from "@/lib/rank-providers/routes";
import { YANDEX_SYNC_JOB } from "@/lib/yandex/jobs";
import { parseLinkInput, setSiteLink, siteLink } from "@/lib/yandex/links";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { listCounters, listGoals, listHosts, yandexErrorResponse } from "@/lib/yandex/routes";

/*
 * The Yandex link of a site (agency fork). GET reads it; PUT changes it with
 * `{ webmasterHostId?, metrikaCounterId?, goalIds? }` (null clears), checked
 * against the account's hosts, counters and goals read live, and queues a
 * sync when something new needs data.
 */

type Params = { params: Promise<{ siteId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { siteId } = await params;
  const owner = await ownSiteOrResponse(siteId);
  if ("error" in owner) return owner.error;
  return Response.json({ link: await siteLink(db, siteId) });
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { siteId } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    const input = parseLinkInput(await req.json().catch(() => null));
    if (!input) return Response.json({ error: YANDEX_UI.errors.badBody }, { status: 400 });

    const current = await siteLink(db, siteId);
    const counterAfter = input.metrikaCounterId !== undefined ? input.metrikaCounterId : current.metrikaCounterId;
    const [hosts, counters, goals] = await Promise.all([
      input.webmasterHostId ? listHosts(db, owner.userId) : undefined,
      input.metrikaCounterId ? listCounters(db, owner.userId) : undefined,
      input.goalIds?.length && counterAfter ? listGoals(db, owner.userId, counterAfter) : undefined,
    ]);
    const { link, syncWebmaster, syncMetrika } = await setSiteLink(db, siteId, input, { hosts, counters, goals });

    let jobId: string | undefined;
    if (syncWebmaster || syncMetrika) {
      registerExtensions();
      // One job syncs both: the service that did not change only fetches its last few days again.
      const { job } = await requestSiteJob(db, { type: YANDEX_SYNC_JOB, siteId, source: "manual" });
      dispatchJob(db, job);
      jobId = job.id;
    }
    return Response.json({ link, ...(jobId && { jobId }) });
  } catch (error) {
    const known = yandexErrorResponse(error);
    if (known) return known;
    console.error("Yandex link error:", error);
    return Response.json({ error: "Failed to save the Yandex link" }, { status: 500 });
  }
}
