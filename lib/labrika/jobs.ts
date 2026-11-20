import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { DAY } from "@/lib/jobs/config";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { registerSchedule, slackMs, type DueRule } from "@/lib/jobs/scheduler";
import { isPermanentJobError, JobError, type JobHandler } from "@/lib/jobs/types";
import { LabrikaSyncError, syncLabrikaForSite } from "@/lib/workers/labrika-sync";
import { LabrikaKeyMissingError } from "./labrika-client";
import { LABRIKA_SOURCE } from "./labrika-parse";

/*
 * The Labrika sync as a job type with a daily schedule, registered from
 * extensions/index.ts. One job per site covers every engine linked to it.
 */

export const LABRIKA_SYNC_JOB = "labrika-sync";

type Env = Record<string, string | undefined>;

/** SCHEDULE_LABRIKA_SYNC_HOURS (default 24); 0 turns the scheduled sync off. */
export function labrikaSyncIntervalMs(env: Env = process.env): number {
  const raw = env.SCHEDULE_LABRIKA_SYNC_HOURS?.trim();
  const hours = raw && /^\d+$/.test(raw) ? Number(raw) : 24;
  return hours * (DAY / 24);
}

export const labrikaSyncHandler: JobHandler = {
  type: LABRIKA_SYNC_JOB,
  class: "SHORT",
  maxAttempts: 3,
  isPermanent: isPermanentJobError,
  async run({ db, job }) {
    try {
      const result = await syncLabrikaForSite(db, job.siteId);
      return { ...result };
    } catch (err) {
      if (err instanceof LabrikaKeyMissingError) {
        throw new JobError(err.message, { code: "KEY_MISSING", permanent: true });
      }
      if (err instanceof LabrikaSyncError) {
        throw new JobError(err.message, { code: err.permanent ? "LABRIKA_REFUSED" : undefined, permanent: err.permanent });
      }
      throw err;
    }
  },
};

/**
 * Sites with a Labrika engine whose owner has a Labrika key. Read once per
 * scheduling pass (the pass gives every site the same `now`), not per site.
 */
const passCache = globalThis as unknown as { crawlseoLabrikaSites?: { at: number; ids: Promise<Set<string>> } };

function linkedSites(db: Pick<PrismaClient, "externalRankEngine">, now: Date): Promise<Set<string>> {
  const cached = passCache.crawlseoLabrikaSites;
  if (cached?.at === now.getTime()) return cached.ids;
  const ids = db.externalRankEngine
    .findMany({
      where: { source: LABRIKA_SOURCE, site: { user: { apiKeys: { some: { provider: "labrika" } } } } },
      select: { siteId: true },
      distinct: ["siteId"],
    })
    .then((rows) => new Set(rows.map((r) => r.siteId)));
  passCache.crawlseoLabrikaSites = { at: now.getTime(), ids };
  ids.catch(() => {
    if (passCache.crawlseoLabrikaSites?.ids === ids) passCache.crawlseoLabrikaSites = undefined;
  });
  return ids;
}

/** Due once a day like the Bing sync, and only for a site with a linked engine and a key. */
export function labrikaDueRule(
  intervalMs: number,
  db: Pick<PrismaClient, "externalRankEngine"> = appDb
): DueRule {
  return async (site, { now, lastQueuedAt }) => {
    if (lastQueuedAt && now.getTime() - lastQueuedAt.getTime() < intervalMs - slackMs(intervalMs)) return false;
    return (await linkedSites(db, now)).has(site.id);
  };
}

/** Registers the job type and, unless SCHEDULE_LABRIKA_SYNC_HOURS=0, its daily schedule. */
export function registerLabrika(env: Env = process.env): void {
  registerJobHandler(labrikaSyncHandler);
  const intervalMs = labrikaSyncIntervalMs(env);
  if (intervalMs > 0) registerSchedule({ type: LABRIKA_SYNC_JOB, isDue: labrikaDueRule(intervalMs) });
}
