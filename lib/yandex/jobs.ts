import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { DAY } from "@/lib/jobs/config";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { registerSchedule, slackMs, type DueRule } from "@/lib/jobs/scheduler";
import { isPermanentJobError, JobError, type JobHandler } from "@/lib/jobs/types";
import { syncYandexForSite, YandexSyncError } from "./sync";

/*
 * The Yandex sync as one job type with a daily schedule (agency fork),
 * registered from extensions/index.ts. One job per site covers its Webmaster
 * host and its Metrika counter.
 */

export const YANDEX_SYNC_JOB = "yandex-sync";

type Env = Record<string, string | undefined>;

/** SCHEDULE_YANDEX_SYNC_HOURS (default 24); 0 turns the scheduled sync off. */
export function yandexSyncIntervalMs(env: Env = process.env): number {
  const raw = env.SCHEDULE_YANDEX_SYNC_HOURS?.trim();
  const hours = raw && /^\d+$/.test(raw) ? Number(raw) : 24;
  return hours * (DAY / 24);
}

export const yandexSyncHandler: JobHandler = {
  type: YANDEX_SYNC_JOB,
  class: "SHORT",
  maxAttempts: 3,
  isPermanent: isPermanentJobError,
  async run({ db, job }) {
    try {
      const result = await syncYandexForSite(db, job.siteId);
      return { ...result };
    } catch (err) {
      if (err instanceof YandexSyncError) {
        throw new JobError(err.message, { code: err.permanent ? "YANDEX_REFUSED" : undefined, permanent: err.permanent });
      }
      throw err;
    }
  },
};

/** Sites with a Yandex link whose owner is connected. Read once per scheduling pass. */
const passCache = globalThis as unknown as { crawlseoYandexSites?: { at: number; ids: Promise<Set<string>> } };

function linkedSites(db: Pick<PrismaClient, "yandexSiteLink">, now: Date): Promise<Set<string>> {
  const cached = passCache.crawlseoYandexSites;
  if (cached?.at === now.getTime()) return cached.ids;
  const ids = db.yandexSiteLink
    .findMany({
      where: {
        OR: [{ webmasterHostId: { not: null } }, { metrikaCounterId: { not: null } }],
        site: { user: { yandexConnection: { isNot: null } } },
      },
      select: { siteId: true },
    })
    .then((rows) => new Set(rows.map((r) => r.siteId)));
  passCache.crawlseoYandexSites = { at: now.getTime(), ids };
  ids.catch(() => {
    if (passCache.crawlseoYandexSites?.ids === ids) passCache.crawlseoYandexSites = undefined;
  });
  return ids;
}

/** Due once a day, and only for a linked site whose owner has a Yandex connection. */
export function yandexSyncDueRule(intervalMs: number, db: Pick<PrismaClient, "yandexSiteLink"> = appDb): DueRule {
  return async (site, { now, lastQueuedAt }) => {
    if (lastQueuedAt && now.getTime() - lastQueuedAt.getTime() < intervalMs - slackMs(intervalMs)) return false;
    return (await linkedSites(db, now)).has(site.id);
  };
}

/** Registers the job type and, unless the interval is 0, its daily schedule. */
export function registerYandex(env: Env = process.env): void {
  registerJobHandler(yandexSyncHandler);
  const intervalMs = yandexSyncIntervalMs(env);
  if (intervalMs > 0) registerSchedule({ type: YANDEX_SYNC_JOB, isDue: yandexSyncDueRule(intervalMs) });
}
