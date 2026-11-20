import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { DAY } from "@/lib/jobs/config";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { registerSchedule, slackMs, type DueRule } from "@/lib/jobs/scheduler";
import { isPermanentJobError, JobError, type JobHandler } from "@/lib/jobs/types";
import { rankProviderIds } from "./registry";
import { RankSyncError, syncRanksForSite } from "./sync";
import { RankKeyMissingError } from "./types";

/*
 * The rank sync as one job type for every provider, with a daily schedule,
 * registered from extensions/index.ts. One job per site covers every provider
 * engine linked to it; each engine's provider comes from its source.
 */

export const RANK_SYNC_JOB = "rank-sync";

type Env = Record<string, string | undefined>;

/**
 * SCHEDULE_RANK_SYNC_HOURS (default 24), or the older SCHEDULE_LABRIKA_SYNC_HOURS
 * when only that one is set; 0 turns the scheduled sync off.
 */
export function rankSyncIntervalMs(env: Env = process.env): number {
  const raw = (env.SCHEDULE_RANK_SYNC_HOURS ?? env.SCHEDULE_LABRIKA_SYNC_HOURS)?.trim();
  const hours = raw && /^\d+$/.test(raw) ? Number(raw) : 24;
  return hours * (DAY / 24);
}

export const rankSyncHandler: JobHandler = {
  type: RANK_SYNC_JOB,
  class: "SHORT",
  maxAttempts: 3,
  isPermanent: isPermanentJobError,
  async run({ db, job }) {
    try {
      const result = await syncRanksForSite(db, job.siteId);
      return { ...result };
    } catch (err) {
      if (err instanceof RankKeyMissingError) {
        throw new JobError(err.message, { code: "KEY_MISSING", permanent: true });
      }
      if (err instanceof RankSyncError) {
        throw new JobError(err.message, { code: err.permanent ? "PROVIDER_REFUSED" : undefined, permanent: err.permanent });
      }
      throw err;
    }
  },
};

/**
 * Sites with a provider engine whose owner has that provider's key. Read once
 * per scheduling pass (the pass gives every site the same `now`), not per site.
 */
const passCache = globalThis as unknown as { crawlseoRankSites?: { at: number; ids: Promise<Set<string>> } };

function linkedSites(db: Pick<PrismaClient, "externalRankEngine">, now: Date): Promise<Set<string>> {
  const cached = passCache.crawlseoRankSites;
  if (cached?.at === now.getTime()) return cached.ids;
  const ids = db.externalRankEngine
    .findMany({
      where: {
        OR: rankProviderIds().map((source) => ({
          source,
          site: { user: { apiKeys: { some: { provider: source } } } },
        })),
      },
      select: { siteId: true },
      distinct: ["siteId"],
    })
    .then((rows) => new Set(rows.map((r) => r.siteId)));
  passCache.crawlseoRankSites = { at: now.getTime(), ids };
  ids.catch(() => {
    if (passCache.crawlseoRankSites?.ids === ids) passCache.crawlseoRankSites = undefined;
  });
  return ids;
}

/** Due once a day like the Bing sync, and only for a site with a provider engine and its key. */
export function rankSyncDueRule(
  intervalMs: number,
  db: Pick<PrismaClient, "externalRankEngine"> = appDb
): DueRule {
  return async (site, { now, lastQueuedAt }) => {
    if (lastQueuedAt && now.getTime() - lastQueuedAt.getTime() < intervalMs - slackMs(intervalMs)) return false;
    return (await linkedSites(db, now)).has(site.id);
  };
}

/** Registers the job type and, unless the interval is 0, its daily schedule. */
export function registerRankTracking(env: Env = process.env): void {
  registerJobHandler(rankSyncHandler);
  const intervalMs = rankSyncIntervalMs(env);
  if (intervalMs > 0) registerSchedule({ type: RANK_SYNC_JOB, isDue: rankSyncDueRule(intervalMs) });
}
