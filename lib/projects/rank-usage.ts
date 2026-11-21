/*
 * Rank check usage arithmetic (agency fork), pure so the Rank tracking tab
 * shows the same numbers the server checks on save. A check is one keyword in
 * one engine (search engine + region + device) on one run.
 */

export const RANK_FREQUENCIES = ["weekly", "biweekly", "monthly", "manual"] as const;
export type RankFrequency = (typeof RANK_FREQUENCIES)[number];

/** "none": the project's positions come from somewhere else (Search Console, an import, a script). */
export const NO_SOURCE = "none";

/** Runs in an average month: 365 / 12 / 7 weeks. Manual runs are not planned. */
export const RUNS_PER_MONTH: Record<RankFrequency, number> = {
  weekly: 365 / 12 / 7,
  biweekly: 365 / 12 / 14,
  monthly: 1,
  manual: 0,
};

export const BUDGET_CURRENCIES = ["RUB", "USD"] as const;
export type BudgetCurrency = (typeof BUDGET_CURRENCIES)[number];

/** Checks of one run: the keywords of every included engine. */
export function checksPerRun(engines: { keywords: number }[]): number {
  return engines.reduce((sum, e) => sum + Math.max(0, e.keywords), 0);
}

/** Planned checks per month, rounded up. */
export function checksPerMonth(perRun: number, frequency: RankFrequency, enabled = true): number {
  if (!enabled) return 0;
  return Math.ceil(perRun * RUNS_PER_MONTH[frequency]);
}

export type LimitState = {
  limit: number;
  /** Planned by the other enabled projects of the provider. */
  others: number;
  /** Planned by this project with the new settings. */
  mine: number;
  total: number;
  over: boolean;
  /** At 80 % of the limit or more. */
  near: boolean;
};

/** A limit of 0 means no limit. */
export function limitState(limit: number, others: number, mine: number): LimitState {
  const total = others + mine;
  if (limit <= 0) return { limit, others, mine, total, over: false, near: false };
  return { limit, others, mine, total, over: total > limit, near: total >= limit * 0.8 };
}

/** The price of one check of a plan, e.g. 360 / 5000 = 0.072. */
export function pricePerCheck(plan: { planPrice: number; planChecks: number }): number {
  return plan.planChecks > 0 ? plan.planPrice / plan.planChecks : 0;
}

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" of a date, in UTC. */
export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** The first moment of the month and of the next one, UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** The month `n` months before (negative: after) the given one. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(Date.UTC(y, m - 1 - n, 1)));
}

/** Money with two decimals, so sums of decimals do not drift. */
export const money = (n: number) => Math.round(n * 100) / 100;

/** How far into the budget, in percent, or null without a plan. */
export function percentUsed(plan: number, actual: number): number | null {
  return plan > 0 ? Math.round((actual / plan) * 100) : null;
}

/** 1234.5 and "RUB" as "1,234.5 RUB". */
export const formatMoney = (n: number, currency?: string) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}${currency ? ` ${currency}` : ""}`;
