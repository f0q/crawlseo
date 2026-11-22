import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { registerScheduleFilter, registerSchedulerTask, type ScheduledSite } from "@/lib/jobs/scheduler";
import { applyBillingRule, billingState } from "./billing";

/*
 * Which collection a project allows (agency fork).
 *
 * - Project status paused or archived (set by hand): no scheduled collection
 *   for its sites at all, paid or free. A schedule filter drops those sites
 *   from every scheduling pass (Search Console, Bing, crawls, vitals, rank
 *   sync, Yandex sync) and the rank check task skips the project. "Sync now"
 *   and other manual buttons keep working. Sites without a project behave as
 *   before.
 * - Paid collection (rank checks that cost money) goes through one guard,
 *   paidCollectionGuard: the manual on/off, the billing auto-pause and the
 *   project status, for scheduled and manual starts alike.
 */

type Db = PrismaClient;

/** Statuses that stop every scheduled collection of a project's sites. */
export const STOPPED_STATUSES = ["paused", "archived"] as const;

export const isStoppedStatus = (status: string) => (STOPPED_STATUSES as readonly string[]).includes(status);

export type PaidGuard =
  | { allowed: true }
  | {
      allowed: false;
      /** off: turned off by hand (or never on); billing: auto-paused by the billing rule; status: the project is paused or archived; missing: no such project. */
      reason: "off" | "billing" | "status" | "missing";
    };

/**
 * The one check before any paid check starts, scheduled or manual. Billing
 * blocks when the stored auto-pause is set or the rule says pause now (the
 * daily rule may not have run yet).
 */
export async function paidCollectionGuard(db: Db, projectId: string, now: Date = new Date()): Promise<PaidGuard> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: {
      status: true,
      paidUntil: true,
      contractEnd: true,
      billingNeverPause: true,
      paidPausedAt: true,
      rankSettings: { select: { enabled: true } },
    },
  });
  if (!p) return { allowed: false, reason: "missing" };
  if (isStoppedStatus(p.status)) return { allowed: false, reason: "status" };
  if (p.paidPausedAt || billingState(p, now).shouldPause) return { allowed: false, reason: "billing" };
  if (!p.rankSettings?.enabled) return { allowed: false, reason: "off" };
  return { allowed: true };
}

/** The ids of sites whose project is paused or archived. */
export async function stoppedSiteIds(db: Pick<Db, "site">): Promise<Set<string>> {
  const rows = await db.site.findMany({ where: { project: { status: { in: [...STOPPED_STATUSES] } } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** The schedule filter: every site except those of paused or archived projects. */
export function projectStatusFilter(db: Pick<Db, "site"> = appDb) {
  return async (sites: ScheduledSite[]): Promise<ScheduledSite[]> => {
    const stopped = await stoppedSiteIds(db);
    return stopped.size ? sites.filter((s) => !stopped.has(s.id)) : sites;
  };
}

export const BILLING_RULE_TASK = "billing-rule";

/** Registers the status filter and the billing rule (every scheduling pass; the rule is by day, so effectively daily). */
export function registerProjectCollection(): void {
  registerScheduleFilter(projectStatusFilter());
  registerSchedulerTask(BILLING_RULE_TASK, async (db, { now }) => {
    const r = await applyBillingRule(db, now);
    if (r.paused.length || r.resumed.length) console.log(`[billing] paid collection paused for ${r.paused.length} project(s), resumed for ${r.resumed.length}`);
  });
}
