import type { PrismaClient } from "@prisma/client";

/*
 * Client billing of a project (agency fork): what the client paid for and
 * until when, and the rule that pauses paid collection when the client does
 * not pay. Pure date arithmetic first (shared with the browser through
 * billing-rule.ts), then the rule that stores the auto-pause.
 *
 * The rule (owner decision 2026-11-22):
 * - paidUntil null: billing is not tracked; no warning, no pause.
 * - paidUntil 1 to BILLING_GRACE_DAYS days in the past: a warning.
 * - more than BILLING_GRACE_DAYS days overdue, or contractEnd in the past:
 *   paid collection (rank checks that cost money) is auto-paused. Free
 *   sources (Search Console, Yandex, crawls, vitals) keep running.
 * - paidUntil or contractEnd moved forward: auto-resumed.
 * - billingNeverPause: warnings only, never paused.
 *
 * The auto-pause is stored on its own (Project.paidPausedAt and
 * paidPauseReason): it never changes the manual on/off of rank checks
 * (ProjectRankSettings.enabled) nor the project status, so resuming never
 * turns on what the owner turned off by hand.
 */

export { billingState, BILLING_GRACE_DAYS, BILLING_SOON_DAYS, type BillingInput, type BillingState } from "./billing-rule";
import { billingState } from "./billing-rule";

type Db = PrismaClient;

/** The projects whose stored auto-pause differs from what the rule says now; returns what changed. */
export async function applyBillingRule(
  db: Db,
  now: Date,
  where: { projectId?: string } = {}
): Promise<{ paused: string[]; resumed: string[] }> {
  const rows = await db.project.findMany({
    where: {
      ...(where.projectId ? { id: where.projectId } : { OR: [{ paidUntil: { not: null } }, { paidPausedAt: { not: null } }] }),
    },
    select: { id: true, paidUntil: true, contractEnd: true, billingNeverPause: true, paidPausedAt: true, paidPauseReason: true },
  });
  const paused: string[] = [];
  const resumed: string[] = [];
  for (const p of rows) {
    const s = billingState(p, now);
    if (s.shouldPause && (!p.paidPausedAt || p.paidPauseReason !== s.pauseReason)) {
      // Only the row that is still in the state we read: two passes never both write.
      const { count } = await db.project.updateMany({
        where: { id: p.id, paidPausedAt: p.paidPausedAt },
        data: { paidPausedAt: p.paidPausedAt ?? now, paidPauseReason: s.pauseReason },
      });
      if (count && !p.paidPausedAt) paused.push(p.id);
    } else if (!s.shouldPause && p.paidPausedAt) {
      const { count } = await db.project.updateMany({ where: { id: p.id, paidPausedAt: p.paidPausedAt }, data: { paidPausedAt: null, paidPauseReason: null } });
      if (count) resumed.push(p.id);
    }
  }
  return { paused, resumed };
}
