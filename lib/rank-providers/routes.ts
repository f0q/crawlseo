import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { UnknownRankProviderError } from "./keys";
import { RankLinkError } from "./links";
import { ManualRankError } from "./manual";
import { RankKeyMissingError, RankProviderError } from "./types";

/*
 * What the session routes of rank tracking share: the signed-in user's site,
 * and one mapping from rank errors to responses.
 */

export type OwnSite = { userId: string; site: { id: string; domain: string } };

/** The session user's site, or a response; someone else's site reads like a missing one. */
export async function ownSiteOrResponse(siteId: string): Promise<OwnSite | { error: Response }> {
  const session = await auth();
  if (!session?.user?.id) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true, userId: true, domain: true } });
  if (!site || site.userId !== session.user.id) {
    return { error: Response.json({ error: "Site not found or unauthorized" }, { status: 404 }) };
  }
  return { userId: session.user.id, site: { id: site.id, domain: site.domain } };
}

/** A known rank error as a response, or null for anything else. */
export function rankErrorResponse(error: unknown): Response | null {
  if (error instanceof RankKeyMissingError) {
    return Response.json({ error: error.message, code: "KEY_MISSING" }, { status: 400 });
  }
  if (error instanceof UnknownRankProviderError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof RankLinkError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof ManualRankError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof RankProviderError) return Response.json({ error: error.message, code: error.code }, { status: 502 });
  return null;
}
