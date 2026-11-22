import type { Job, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sync")>()),
  syncYandexForSite: sync,
}));

import { getJobHandler } from "@/lib/jobs/handlers";
import { JobError } from "@/lib/jobs/types";
import { registerYandex, YANDEX_SYNC_JOB, yandexSyncDueRule, yandexSyncHandler, yandexSyncIntervalMs } from "./jobs";
import { YandexSyncError } from "./sync";

const HOUR = 3_600_000;
const site = (id: string) => ({ id, userId: "u", createdAt: new Date(0), gscProperty: null, bingSite: null });

function run() {
  const job = { id: "j", siteId: "s1", type: YANDEX_SYNC_JOB, attempts: 1, maxAttempts: 3 } as Job;
  return yandexSyncHandler.run({ db: {} as PrismaClient, job, workerId: "w", signal: new AbortController().signal });
}

afterEach(() => vi.clearAllMocks());

describe("schedule", () => {
  it("syncs daily by default and SCHEDULE_YANDEX_SYNC_HOURS=0 turns it off", () => {
    expect(yandexSyncIntervalMs({})).toBe(24 * HOUR);
    expect(yandexSyncIntervalMs({ SCHEDULE_YANDEX_SYNC_HOURS: "12" })).toBe(12 * HOUR);
    expect(yandexSyncIntervalMs({ SCHEDULE_YANDEX_SYNC_HOURS: "0" })).toBe(0);
  });

  it("is due for a linked site of a connected user a day after its last job, reading the links once per pass", async () => {
    const findMany = vi.fn(async () => [{ siteId: "s1" }]);
    const due = yandexSyncDueRule(24 * HOUR, { yandexSiteLink: { findMany } } as unknown as Pick<PrismaClient, "yandexSiteLink">);
    const now = new Date("2026-11-22T12:00:00Z");
    const ctx = { now, lastQueuedAt: null, firstSeenAt: now };
    expect(await due(site("s1"), ctx)).toBe(true);
    expect(await due(site("s2"), ctx)).toBe(false);
    expect(await due(site("s1"), { ...ctx, lastQueuedAt: new Date(now.getTime() - 5 * HOUR) })).toBe(false);
    expect(await due(site("s1"), { ...ctx, lastQueuedAt: new Date(now.getTime() - 23.9 * HOUR) })).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("registers the job type", () => {
    registerYandex({ SCHEDULE_YANDEX_SYNC_HOURS: "0" });
    expect(getJobHandler(YANDEX_SYNC_JOB)).toBe(yandexSyncHandler);
  });
});

describe("job errors", () => {
  it("a refused token fails at once, an outage is retried", async () => {
    sync.mockRejectedValue(new YandexSyncError("not connected", true));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ code: "YANDEX_REFUSED", permanent: true });
    sync.mockRejectedValue(new YandexSyncError("Metrika did not answer", false));
    expect(await run().catch((e) => e)).toMatchObject({ permanent: false });
  });

  it("returns the counts as the job result", async () => {
    sync.mockResolvedValue({ webmasterDays: 1, queryWeeks: 1, queries: 5, metrikaDays: 4, goalRows: 4 });
    expect(await run()).toEqual({ webmasterDays: 1, queryWeeks: 1, queries: 5, metrikaDays: 4, goalRows: 4 });
  });
});
