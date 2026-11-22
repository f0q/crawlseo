/*
 * The billing rule of a project as pure date arithmetic (agency fork), with
 * no server imports so the Money tab shows the same outcome as the server.
 * See billing.ts for the rule and how the auto-pause is stored.
 */

/** Days a payment may be overdue with a warning before paid collection is auto-paused. */
export const BILLING_GRACE_DAYS = 14;
/** Days before paidUntil that the home shows "due soon" (a hint, not a warning). */
export const BILLING_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

export type BillingInput = {
  paidUntil: Date | string | null;
  contractEnd: Date | string | null;
  billingNeverPause: boolean;
  paidPausedAt?: Date | string | null;
};

export type BillingState = {
  /** paidUntil is set: billing is tracked. */
  tracked: boolean;
  paidUntil: string | null;
  contractEnd: string | null;
  neverPause: boolean;
  /**
   * none: not tracked; ok; soon: paidUntil within BILLING_SOON_DAYS;
   * overdue: a warning (1 to 14 days, or later with neverPause, or the contract ended with neverPause);
   * paused: paid collection is auto-paused.
   */
  level: "none" | "ok" | "soon" | "overdue" | "paused";
  /** Days since paidUntil; 0 when it is today or ahead. */
  overdueDays: number;
  /** Days until paidUntil (0 today); null when overdue or not tracked. */
  daysLeft: number | null;
  contractEnded: boolean;
  /** The rule pauses paid collection now. */
  shouldPause: boolean;
  pauseReason: "overdue" | "contract-ended" | null;
  /** The first day the rule pauses (or paused) paid collection, YYYY-MM-DD; null when it never will or is not tracked. */
  pauseFrom: string | null;
  /** When the rule stored the pause (the job), ISO; null when not paused. */
  pausedAt: string | null;
};

/** A date or a YYYY-MM-DD as the UTC midnight of that day. */
function dayStart(d: Date | string): number {
  const iso = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return Date.parse(`${iso}T00:00:00.000Z`);
}

const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function billingState(p: BillingInput, now: Date = new Date()): BillingState {
  const paidUntil = p.paidUntil ? dayString(dayStart(p.paidUntil)) : null;
  const contractEnd = p.contractEnd ? dayString(dayStart(p.contractEnd)) : null;
  const pausedAt = p.paidPausedAt ? new Date(p.paidPausedAt).toISOString() : null;
  const base = { paidUntil, contractEnd, neverPause: p.billingNeverPause, pausedAt };
  if (!paidUntil) {
    return { ...base, tracked: false, level: "none", overdueDays: 0, daysLeft: null, contractEnded: false, shouldPause: false, pauseReason: null, pauseFrom: null };
  }
  const today = dayStart(now);
  const paid = dayStart(paidUntil);
  const overdueDays = Math.max(0, Math.round((today - paid) / DAY_MS));
  const daysLeft = today <= paid ? Math.round((paid - today) / DAY_MS) : null;
  const contractEnded = contractEnd !== null && dayStart(contractEnd) < today;

  const overduePause = overdueDays > BILLING_GRACE_DAYS;
  const shouldPause = !p.billingNeverPause && (overduePause || contractEnded);
  const pauseReason = shouldPause ? (contractEnded ? "contract-ended" : "overdue") : null;

  const candidates = [paid + (BILLING_GRACE_DAYS + 1) * DAY_MS, ...(contractEnd ? [dayStart(contractEnd) + DAY_MS] : [])];
  const pauseFrom = p.billingNeverPause ? null : dayString(Math.min(...candidates));

  let level: BillingState["level"] = "ok";
  if (shouldPause) level = "paused";
  else if (overdueDays > 0 || contractEnded) level = "overdue";
  else if (daysLeft !== null && daysLeft <= BILLING_SOON_DAYS) level = "soon";

  return { ...base, tracked: true, level, overdueDays, daysLeft, contractEnded, shouldPause, pauseReason, pauseFrom };
}
