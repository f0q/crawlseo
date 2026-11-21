import { registerSchedulerTask } from "@/lib/jobs/scheduler";
import { runDueRankChecks } from "./rank";

/*
 * Starts the scheduled rank checks of client projects (agency fork), once
 * per scheduling pass (every 10 minutes, one process at a time). Only
 * projects with checks turned on, a provider that can start checks and a
 * frequency other than manual are looked at; see isDue in ./rank.ts. At most
 * RANK_CHECKS_PER_PASS projects start per pass, so the pass stays short.
 */

export const RANK_CHECKS_TASK = "rank-checks";

type Env = Record<string, string | undefined>;

/** SCHEDULE_RANK_CHECKS=false (or 0, off) turns the scheduled starts off for the whole instance. */
export function rankChecksScheduled(env: Env = process.env): boolean {
  const raw = env.SCHEDULE_RANK_CHECKS?.trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

export function registerRankChecks(env: Env = process.env): void {
  if (!rankChecksScheduled(env)) return;
  registerSchedulerTask(RANK_CHECKS_TASK, async (db, { now }) => {
    await runDueRankChecks(db, { now });
  });
}
