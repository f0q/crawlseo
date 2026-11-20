import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { LabrikaApiError, LabrikaKeyMissingError, listLabrikaSites } from "@/lib/labrika";
import { LABRIKA_SYNC_JOB } from "@/lib/labrika/jobs";
import { LabrikaLinkError, linkedEngines, parseEngineRefs, setLinkedEngines } from "@/lib/labrika/links";

/*
 * The Labrika search engines linked to a site. GET lists them; PUT replaces
 * the set with `{ engines: [{ siteUuid, engineId }] }` and queues a sync when
 * an engine is new, which backfills every check date Labrika has.
 */

type Params = { params: Promise<{ siteId: string }> };

/** The session user's site, or null; someone else's site reads like a missing one. */
async function ownSite(siteId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true } });
  if (!site || site.userId !== session.user.id) {
    return { error: Response.json({ error: "Site not found or unauthorized" }, { status: 404 }) };
  }
  return { userId: session.user.id };
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { siteId } = await params;
    const owner = await ownSite(siteId);
    if (owner.error) return owner.error;
    return Response.json({ engines: await linkedEngines(db, siteId) });
  } catch (error) {
    console.error("Error reading Labrika links:", error);
    return Response.json({ error: "Failed to read Labrika links" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { siteId } = await params;
    const owner = await ownSite(siteId);
    if (owner.error) return owner.error;

    const body = (await req.json().catch(() => null)) as { engines?: unknown } | null;
    const wanted = parseEngineRefs(body?.engines);
    if (!wanted) {
      return Response.json({ error: "engines must be a list of { siteUuid, engineId }" }, { status: 400 });
    }

    // Read from Labrika on every change: only engines this key can see are linked.
    const available = wanted.length ? await listLabrikaSites(owner.userId) : [];
    const { added, removed } = await setLinkedEngines(db, siteId, wanted, available);

    let jobId: string | undefined;
    if (added > 0) {
      registerExtensions();
      const { job } = await requestSiteJob(db, { type: LABRIKA_SYNC_JOB, siteId, source: "manual" });
      dispatchJob(db, job);
      jobId = job.id;
    }

    return Response.json({ engines: await linkedEngines(db, siteId), added, removed, ...(jobId && { jobId }) });
  } catch (error) {
    if (error instanceof LabrikaLinkError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LabrikaKeyMissingError) {
      return Response.json({ error: error.message, code: "LABRIKA_KEY_MISSING" }, { status: 400 });
    }
    if (error instanceof LabrikaApiError) {
      return Response.json({ error: error.message, code: error.code }, { status: 502 });
    }
    console.error("Error linking Labrika engines:", error);
    return Response.json({ error: "Failed to save the Labrika links" }, { status: 500 });
  }
}
