import { db } from "@/lib/db";
import { registerExtensions } from "@/extensions";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { requestSiteJob } from "@/lib/jobs/site-jobs";
import { RANK_SYNC_JOB } from "@/lib/rank-providers/jobs";
import { listProjectsWithEngines } from "@/lib/rank-providers/keys";
import { linkedEngines, parseEngineRefs, setLinkedEngines } from "@/lib/rank-providers/links";
import { getRankProvider } from "@/lib/rank-providers/registry";
import { ownSiteOrResponse, rankErrorResponse } from "@/lib/rank-providers/routes";

/*
 * The engines of one rank provider linked to a site. GET lists them; PUT
 * replaces the set with `{ engines: [{ externalSiteId, externalEngineId }] }`
 * and queues a sync when an engine is new, which backfills every check date
 * the provider has.
 */

type Params = { params: Promise<{ siteId: string; provider: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { siteId, provider } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    if (!getRankProvider(provider)) return Response.json({ error: "Unknown rank provider" }, { status: 404 });
    return Response.json({ engines: await linkedEngines(db, siteId, { source: provider }) });
  } catch (error) {
    console.error("Error reading rank links:", error);
    return Response.json({ error: "Failed to read the linked engines" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { siteId, provider } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;
    if (!getRankProvider(provider)) return Response.json({ error: "Unknown rank provider" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { engines?: unknown } | null;
    const wanted = parseEngineRefs(body?.engines);
    if (!wanted) {
      return Response.json({ error: "engines must be a list of { externalSiteId, externalEngineId }" }, { status: 400 });
    }

    // Read from the provider on every change: only engines this key can see are linked.
    const available = wanted.length ? await listProjectsWithEngines(owner.userId, provider) : [];
    const { added, removed } = await setLinkedEngines(db, siteId, provider, wanted, available);

    let jobId: string | undefined;
    if (added > 0) {
      registerExtensions();
      const { job } = await requestSiteJob(db, { type: RANK_SYNC_JOB, siteId, source: "manual" });
      dispatchJob(db, job);
      jobId = job.id;
    }

    return Response.json({ engines: await linkedEngines(db, siteId, { source: provider }), added, removed, ...(jobId && { jobId }) });
  } catch (error) {
    const known = rankErrorResponse(error);
    if (known) return known;
    console.error("Error linking rank engines:", error);
    return Response.json({ error: "Failed to save the linked engines" }, { status: 500 });
  }
}
