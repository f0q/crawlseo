import { z } from "zod";
import { db } from "@/lib/db";
import { projectFor, type Actor } from "./access";
import { paidCollectionGuard, PAID_SOURCES, type PaidGuard, type PaidSource } from "./collection";
import { updateRankSettings } from "./rank";
import { ApiError } from "@/lib/api-v1/params";
import { zodMessage } from "./schema";

/*
 * Agency fork: the "Paid collection" block of a project (Money tab) and
 * GET /api/v1/projects/{slug}/paid-collection. One manual switch per paid
 * source; whether it may run now is the same guard the jobs use (manual
 * switch, billing auto-pause, project status). The switches change only from
 * the dashboard: an agent reads them and never turns paid work on itself.
 */

export type PaidSourceState = { enabled: boolean; guard: PaidGuard };
export type PaidCollection = Record<PaidSource, PaidSourceState>;

export async function getPaidCollection(actor: Actor, slug: string, now = new Date()): Promise<PaidCollection> {
  const ref = await projectFor(actor, slug);
  const p = await db.project.findUnique({
    where: { id: ref.id },
    select: { aiVisibilityEnabled: true, rankSettings: { select: { enabled: true } } },
  });
  const enabled: Record<PaidSource, boolean> = { rank: !!p?.rankSettings?.enabled, ai: !!p?.aiVisibilityEnabled };
  const entries = await Promise.all(
    PAID_SOURCES.map(async (s) => [s, { enabled: enabled[s], guard: await paidCollectionGuard(db, ref.id, now, s) }] as const)
  );
  return Object.fromEntries(entries) as PaidCollection;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, zodMessage(r.error));
  return r.data;
}

const switchesSchema = z.object({ rank: z.boolean().optional(), ai: z.boolean().optional() }).strict();

/** Dashboard only: turns a paid source on or off by hand (editor or owner). Rank goes through the rank settings, with their checks. */
export async function setPaidCollection(actor: Actor, slug: string, body: unknown): Promise<PaidCollection> {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(switchesSchema, body);
  if (input.rank !== undefined) await updateRankSettings(actor, slug, { enabled: input.rank });
  if (input.ai !== undefined) await db.project.update({ where: { id: ref.id }, data: { aiVisibilityEnabled: input.ai } });
  return getPaidCollection(actor, slug);
}
