import type { Job, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sync")>()),
  syncRanksForSite: sync,
}));

import { RankSyncError } from "./sync";
import { JobError } from "@/lib/jobs/types";
import { getJobHandler } from "@/lib/jobs/handlers";
import { RankKeyMissingError } from "./types";
import { RANK_SYNC_JOB, rankSyncDueRule, rankSyncHandler, rankSyncIntervalMs, registerRankTracking } from "./jobs";

const HOUR = 3_600_000;
const site = (id: string) => ({ id, userId: "u", createdAt: new Date(0), gscProperty: null, bingSite: null });

function engines(siteIds: string[]) {
  const findMany = vi.fn(async () => siteIds.map((siteId) => ({ siteId })));
  return { db: { externalRankEngine: { findMany } } as unknown as Pick<PrismaClient, "externalRankEngine">, findMany };
}

function run() {
  const job = { id: "j", siteId: "s1", type: RANK_SYNC_JOB, attempts: 1, maxAttempts: 3 } as Job;
  return rankSyncHandler.run({ db: {} as PrismaClient, job, workerId: "w", signal: new AbortController().signal });
}

afterEach(() => vi.clearAllMocks());

describe("schedule", () => {
  it("syncs daily by default and SCHEDULE_RANK_SYNC_HOURS=0 turns it off", () => {
    expect(rankSyncIntervalMs({})).toBe(24 * HOUR);
    expect(rankSyncIntervalMs({ SCHEDULE_RANK_SYNC_HOURS: "6" })).toBe(6 * HOUR);
    expect(rankSyncIntervalMs({ SCHEDULE_RANK_SYNC_HOURS: "0" })).toBe(0);
  });

  it("still takes the older SCHEDULE_LABRIKA_SYNC_HOURS, and the new name wins", () => {
    expect(rankSyncIntervalMs({ SCHEDULE_LABRIKA_SYNC_HOURS: "0" })).toBe(0);
    expect(rankSyncIntervalMs({ SCHEDULE_LABRIKA_SYNC_HOURS: "0", SCHEDULE_RANK_SYNC_HOURS: "12" })).toBe(12 * HOUR);
  });

  it("is due for a linked site a day after its last job, reading the links once per pass", async () => {
    const { db, findMany } = engines(["s1"]);
    const due = rankSyncDueRule(24 * HOUR, db);
    const now = new Date("2026-11-20T12:00:00Z");
    const firstSeenAt = now;
    expect(await due(site("s1"), { now, lastQueuedAt: null, firstSeenAt })).toBe(true);
    expect(await due(site("s2"), { now, lastQueuedAt: null, firstSeenAt })).toBe(false);
    expect(await due(site("s1"), { now, lastQueuedAt: new Date(now.getTime() - 5 * HOUR), firstSeenAt })).toBe(false);
    expect(await due(site("s1"), { now, lastQueuedAt: new Date(now.getTime() - 23 * HOUR), firstSeenAt })).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("registers the job type", () => {
    registerRankTracking({ SCHEDULE_RANK_SYNC_HOURS: "0" });
    expect(getJobHandler(RANK_SYNC_JOB)).toBe(rankSyncHandler);
  });
});

describe("job errors", () => {
  it("a missing key fails at once", async () => {
    sync.mockRejectedValue(new RankKeyMissingError("Labrika"));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err).toMatchObject({ code: "KEY_MISSING", permanent: true });
  });

  it("a refused request fails at once, a network failure is retried", async () => {
    sync.mockRejectedValue(new RankSyncError("403 serp_subscription_required", true));
    expect(await run().catch((e) => e)).toMatchObject({ permanent: true, code: "PROVIDER_REFUSED" });
    sync.mockRejectedValue(new RankSyncError("Labrika did not answer", false));
    expect(await run().catch((e) => e)).toMatchObject({ permanent: false });
  });

  it("returns the counts as the job result", async () => {
    sync.mockResolvedValue({ engines: 2, datesFetched: 3, rowsWritten: 90 });
    expect(await run()).toEqual({ engines: 2, datesFetched: 3, rowsWritten: 90 });
  });
});
