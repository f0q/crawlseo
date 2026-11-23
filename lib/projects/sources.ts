import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { DAY, scheduleConfig, type ScheduleConfig } from "@/lib/jobs/config";
import { GSC_SYNC_JOB, VITALS_JOB } from "@/lib/jobs/handlers";
import { RANK_SYNC_JOB } from "@/lib/rank-providers/jobs";
import { getRankProvider } from "@/lib/rank-providers/registry";
import { YANDEX_SYNC_JOB } from "@/lib/yandex/jobs";
import { atLeast, rolesOf, visibleProjects, type Actor } from "./access";
import { billingState, type BillingState } from "./billing";
import { isStoppedStatus } from "./collection";
import { PROJECT_MESSAGES } from "./messages";
import type { Role } from "./schema";

/*
 * The data sources of client projects (agency fork): one matrix of project
 * -> site -> source with the state of each, read from the tables that are
 * already there. Nothing is synced or changed here. The control panel
 * (/projects/sources), the projects home and the Overview tab all read it.
 *
 * Sources: positions (paid rank checks per project, the sync of results per
 * site), Google Search Console, Yandex Webmaster, Yandex Metrika, the site
 * crawl and Core Web Vitals. A site's error texts and links are given to its
 * owner only, like its numbers in the Overview; other members see the state.
 */

type Db = PrismaClient;

export const SOURCE_IDS = ["positions", "gsc", "webmaster", "metrika", "crawl", "vitals"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * ok: fresh; waiting: connected, the first sync has not finished yet; stale:
 * older than its threshold; error: the last attempt failed; off: turned off
 * (by hand or in the schedule settings); not-connected: nothing to collect
 * from yet; paused-billing: paid collection auto-paused by the billing rule;
 * paused-status: the project is paused or archived; no-site: the project has
 * no site.
 */
export const CELL_STATES = ["ok", "waiting", "stale", "error", "off", "not-connected", "paused-billing", "paused-status", "no-site"] as const;
export type CellState = (typeof CELL_STATES)[number];

/** Staleness thresholds (owner approved: Search Console 5 days, Yandex 2 days). */
export const GSC_STALE_DAYS = 5;
export const YANDEX_STALE_DAYS = 2;
/** The daily sync of rank results (rank-sync) of a site. */
export const RANK_SYNC_STALE_DAYS = 2;
/** Scheduled crawls, vitals checks and paid rank checks: stale after their own interval plus this. */
export const SCHEDULE_GRACE_DAYS = 2;

/** Rank check intervals in days, for staleness (monthly as 31). */
const RANK_INTERVAL_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 31 };

export type SourceCell = {
  state: CellState;
  /** The last successful sync or check, ISO; null when never or not shown. */
  lastSync: string | null;
  /** Why the last attempt failed; only for the site's owner. */
  error: string | null;
  /** The source costs money per check (rank checks of a provider that crawlseo starts). */
  paid: boolean;
  /** Where it is set up or shown; null when the viewer cannot open it. */
  href: string | null;
};

export type SourceSiteRow = { siteId: string; domain: string; yours: boolean; cells: Record<SourceId, SourceCell> };

export type SourceProjectRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  group: string | null;
  role: Role;
  sites: SourceSiteRow[];
  /** The project line: positions are the paid checks of the project, the other sources the worst state across its sites. */
  cells: Record<SourceId, SourceCell>;
  rank: { enabled: boolean; source: string; sourceName: string | null; frequency: string; canToggle: boolean };
  billing: BillingState;
};

export type SourceTotals = {
  bySource: Record<SourceId, Record<CellState, number>>;
  ok: number;
  stale: number;
  errors: number;
  /** Paid sources that are on and not paused. */
  paidActive: number;
};

export type SourcesMatrix = { projects: SourceProjectRow[]; totals: SourceTotals };

const M = PROJECT_MESSAGES.sources;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const olderThan = (d: Date | null, days: number, now: Date) => !d || now.getTime() - d.getTime() > days * DAY;

const cell = (state: CellState, extra: Partial<SourceCell> = {}): SourceCell => ({ state, lastSync: null, error: null, paid: false, href: null, ...extra });

/** Worst first: what the project line shows when its sites differ. */
const SEVERITY: Record<CellState, number> = {
  error: 8,
  stale: 7,
  "paused-billing": 6,
  "paused-status": 5,
  waiting: 4,
  ok: 3,
  off: 2,
  "not-connected": 1,
  "no-site": 0,
};

/** The worst cell of the sites; lastSync is the oldest among the cells in that state. */
export function worstCell(cells: SourceCell[]): SourceCell {
  if (cells.length === 0) return cell("no-site");
  const top = Math.max(...cells.map((c) => SEVERITY[c.state]));
  const same = cells.filter((c) => SEVERITY[c.state] === top);
  const syncs = same.map((c) => c.lastSync).filter((s): s is string => s !== null).sort();
  return { ...same[0], lastSync: syncs[0] ?? null, error: same.find((c) => c.error)?.error ?? null };
}

/** A site's interval of crawls or vitals in days: the owner's setting, else the server's; 0: off. */
function intervalDays(userDays: number | null | undefined, serverMs: number, config: ScheduleConfig): number {
  if (!config.enabled) return 0;
  const server = serverMs / DAY;
  if (server <= 0) return 0;
  return userDays === null || userDays === undefined || userDays < 0 ? server : userDays;
}

/** The matrix of the projects the actor sees, or of one project (`slug`). */
export async function sourcesMatrix(actor: Actor, opts: { slug?: string; now?: Date; db?: Db; config?: ScheduleConfig } = {}): Promise<SourcesMatrix> {
  const db = opts.db ?? appDb;
  const now = opts.now ?? new Date();
  const config = opts.config ?? scheduleConfig();
  const projects = await db.project.findMany({
    where: { AND: [visibleProjects(actor), ...(opts.slug ? [{ slug: opts.slug }] : [])] },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      group: true,
      paidUntil: true,
      contractEnd: true,
      billingNeverPause: true,
      paidPausedAt: true,
      rankSettings: { select: { enabled: true, source: true, frequency: true } },
      sites: { select: { id: true, domain: true, userId: true, gscProperty: true, createdAt: true }, orderBy: { domain: "asc" } },
    },
    orderBy: [{ name: "asc" }],
  });
  const roles = await rolesOf(actor, projects.map((p) => p.id));
  const sites = projects.flatMap((p) => p.sites);
  const siteIds = sites.map((s) => s.id);
  const projectIds = projects.map((p) => p.id);
  const owners = [...new Set(sites.map((s) => s.userId))];
  const some = siteIds.length > 0;

  const latestJob = (type: string, status?: "SUCCEEDED") =>
    some
      ? db.job.findMany({
          where: { siteId: { in: siteIds }, type, ...(status && { status }) },
          orderBy: { createdAt: "desc" },
          distinct: ["siteId"],
          select: { siteId: true, status: true, finishedAt: true, lastError: true },
        })
      : Promise.resolve([]);

  const [gscLast, gscOk, gscPages, yandexLinks, yandexConnected, yandexJobs, crawlsDone, crawlsOk, vitals, vitalsLast, engines, rankSyncLast, userSettings, runs, successes] =
    await Promise.all([
      latestJob(GSC_SYNC_JOB),
      latestJob(GSC_SYNC_JOB, "SUCCEEDED"),
      some ? db.page.groupBy({ by: ["siteId"], where: { siteId: { in: siteIds } }, _max: { date: true } }) : [],
      some ? db.yandexSiteLink.findMany({ where: { siteId: { in: siteIds } } }) : [],
      owners.length ? db.yandexConnection.findMany({ where: { userId: { in: owners } }, select: { userId: true } }) : [],
      latestJob(YANDEX_SYNC_JOB),
      some
        ? db.crawl.findMany({
            where: { siteId: { in: siteIds }, status: { in: ["COMPLETED", "FAILED"] }, finishedAt: { not: null } },
            orderBy: { finishedAt: "desc" },
            distinct: ["siteId"],
            select: { siteId: true, status: true, finishedAt: true, error: true },
          })
        : [],
      some
        ? db.crawl.findMany({
            where: { siteId: { in: siteIds }, status: "COMPLETED", finishedAt: { not: null } },
            orderBy: { finishedAt: "desc" },
            distinct: ["siteId"],
            select: { siteId: true, finishedAt: true },
          })
        : [],
      some ? db.vitalsReport.groupBy({ by: ["siteId"], where: { siteId: { in: siteIds } }, _max: { date: true } }) : [],
      latestJob(VITALS_JOB),
      some ? db.externalRankEngine.findMany({ where: { siteId: { in: siteIds } }, select: { id: true, siteId: true, source: true, lastSyncedAt: true } }) : [],
      latestJob(RANK_SYNC_JOB),
      owners.length ? db.userSettings.findMany({ where: { userId: { in: owners } }, select: { userId: true, crawlScheduleDays: true, vitalsScheduleDays: true } }) : [],
      projectIds.length
        ? db.rankCheckRun.findMany({
            where: { projectId: { in: projectIds } },
            orderBy: { createdAt: "desc" },
            distinct: ["projectId"],
            select: { projectId: true, status: true, reason: true, createdAt: true },
          })
        : [],
      projectIds.length
        ? db.rankCheckRun.findMany({
            where: { projectId: { in: projectIds }, status: { in: ["started", "partial"] } },
            orderBy: { createdAt: "desc" },
            distinct: ["projectId"],
            select: { projectId: true, createdAt: true },
          })
        : [],
    ]);

  const bySite = <T extends { siteId: string }>(rows: T[]) => new Map(rows.map((r) => [r.siteId, r]));
  const gscLastBy = bySite(gscLast);
  const gscOkBy = bySite(gscOk);
  const gscPagesBy = new Map(gscPages.map((r) => [r.siteId, r._max.date]));
  const yandexBy = bySite(yandexLinks);
  const yandexJobBy = bySite(yandexJobs);
  const connected = new Set(yandexConnected.map((c) => c.userId));
  const crawlDoneBy = bySite(crawlsDone);
  const crawlOkBy = bySite(crawlsOk);
  const vitalsBy = new Map(vitals.map((r) => [r.siteId, r._max.date]));
  const vitalsJobBy = bySite(vitalsLast);
  const rankSyncBy = bySite(rankSyncLast);
  const settingsBy = new Map(userSettings.map((u) => [u.userId, u]));
  const runBy = new Map(runs.map((r) => [r.projectId, r]));
  const successBy = new Map(successes.map((r) => [r.projectId, r.createdAt]));

  const siteCells = (site: (typeof sites)[number]): Record<SourceId, SourceCell> => {
    const yours = site.userId === actor.userId;
    const link = (path: string) => (yours ? `/sites/${site.id}${path}` : null);
    const err = (text: string | null | undefined) => (yours ? (text ?? null) : null);

    // Positions of the site: the daily sync of rank results (free); the paid checks are on the project line.
    const mine = engines.filter((e) => e.siteId === site.id);
    let positions: SourceCell;
    if (mine.length === 0) positions = cell("not-connected", { href: link("/settings") });
    else {
      const synced = mine.map((e) => e.lastSyncedAt).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime());
      const last = synced[0] ?? null;
      const providerEngines = mine.filter((e) => getRankProvider(e.source));
      const job = rankSyncBy.get(site.id);
      const href = link("/positions");
      if (providerEngines.length && job?.status === "FAILED") positions = cell("error", { lastSync: iso(last), error: err(job.lastError), href });
      else if (!last) positions = cell("waiting", { href });
      else if (providerEngines.length && olderThan(last, RANK_SYNC_STALE_DAYS, now)) positions = cell("stale", { lastSync: iso(last), href });
      else positions = cell("ok", { lastSync: iso(last), href });
    }

    // Search Console.
    let gsc: SourceCell;
    if (!site.gscProperty) gsc = cell("not-connected", { href: link("/settings") });
    else {
      const job = gscLastBy.get(site.id);
      const last = gscOkBy.get(site.id)?.finishedAt ?? gscPagesBy.get(site.id) ?? null;
      const href = link("/keywords");
      if (job?.status === "FAILED") gsc = cell("error", { lastSync: iso(last), error: err(job.lastError), href });
      else if (!last) gsc = cell(job ? "waiting" : "stale", { href });
      else gsc = cell(olderThan(last, GSC_STALE_DAYS, now) ? "stale" : "ok", { lastSync: iso(last), href });
    }

    // Yandex Webmaster and Metrika: one link, synced independently.
    const y = yandexBy.get(site.id);
    const yJob = yandexJobBy.get(site.id);
    const yandex = (linked: boolean, syncedAt: Date | null, error: string | null): SourceCell => {
      if (!linked) return cell("not-connected", { href: link("/settings") });
      const href = link("/yandex");
      if (!connected.has(site.userId)) return cell("error", { lastSync: iso(syncedAt), error: err(M.yandexNotConnected), href });
      if (error) return cell("error", { lastSync: iso(syncedAt), error: err(error), href });
      if (!syncedAt) return yJob?.status === "FAILED" ? cell("error", { error: err(yJob.lastError), href }) : cell("waiting", { href });
      return cell(olderThan(syncedAt, YANDEX_STALE_DAYS, now) ? "stale" : "ok", { lastSync: iso(syncedAt), href });
    };
    const webmaster = yandex(Boolean(y?.webmasterHostId), y?.webmasterSyncedAt ?? null, y?.webmasterError ?? null);
    const metrika = yandex(Boolean(y?.metrikaCounterId), y?.metrikaSyncedAt ?? null, y?.metrikaError ?? null);

    // Crawl and vitals: scheduled per the owner's interval (Settings > Schedule).
    const us = settingsBy.get(site.userId);
    const scheduled = (days: number, last: Date | null, failed: string | null, href: string | null): SourceCell => {
      if (days <= 0) return cell("off", { lastSync: iso(last), href: yours ? "/settings" : null });
      if (failed !== null) return cell("error", { lastSync: iso(last), error: err(failed), href });
      const limit = days + SCHEDULE_GRACE_DAYS;
      if (!last) return olderThan(site.createdAt, limit, now) ? cell("stale", { href }) : cell("waiting", { href });
      return cell(olderThan(last, limit, now) ? "stale" : "ok", { lastSync: iso(last), href });
    };
    const done = crawlDoneBy.get(site.id);
    const crawl = scheduled(
      intervalDays(us?.crawlScheduleDays, config.crawlMs, config),
      crawlOkBy.get(site.id)?.finishedAt ?? null,
      done?.status === "FAILED" ? (done.error ?? M.failed) : null,
      link("/crawl")
    );
    const vJob = vitalsJobBy.get(site.id);
    const vitalsCell = scheduled(
      intervalDays(us?.vitalsScheduleDays, config.vitalsMs, config),
      vitalsBy.get(site.id) ?? null,
      vJob?.status === "FAILED" ? (vJob.lastError ?? M.failed) : null,
      link("/vitals")
    );

    return { positions, gsc, webmaster, metrika, crawl, vitals: vitalsCell };
  };

  const rows: SourceProjectRow[] = projects.map((p) => {
    const role = roles.get(p.id) ?? "viewer";
    const stopped = isStoppedStatus(p.status);
    const billing = billingState(p, now);
    const billingPaused = Boolean(p.paidPausedAt) || billing.shouldPause;

    const siteRows: SourceSiteRow[] = p.sites.map((s) => {
      const cells = siteCells(s);
      if (stopped) for (const id of SOURCE_IDS) if (!["not-connected", "off"].includes(cells[id].state)) cells[id] = { ...cells[id], state: "paused-status", error: null };
      return { siteId: s.id, domain: s.domain, yours: s.userId === actor.userId, cells };
    });

    // The paid checks of the project.
    const settings = p.rankSettings ?? { enabled: false, source: "none", frequency: "manual" };
    const provider = settings.source === "none" ? undefined : getRankProvider(settings.source);
    const paid = Boolean(provider?.startCheck && provider.cabinet);
    // Kept as is: /api/v1 returns this link; the project page redirects it to ?tab=data#rank (lib/projects/tabs.ts).
    const href = `/projects/${p.slug}?tab=rank`;
    const providerEngines = engines.filter((e) => p.sites.some((s) => s.id === e.siteId) && getRankProvider(e.source));
    const run = runBy.get(p.id);
    const success = successBy.get(p.id) ?? null;
    const sitePositions = worstCell(siteRows.map((r) => r.cells.positions));
    let positions: SourceCell;
    if (!provider && providerEngines.length === 0) positions = cell(p.sites.length ? "not-connected" : "no-site", { href });
    else if (stopped) positions = cell("paused-status", { lastSync: iso(success), paid, href });
    else if (!settings.enabled) positions = cell("off", { lastSync: iso(success) ?? sitePositions.lastSync, paid, href });
    else if (billingPaused && paid) positions = cell("paused-billing", { lastSync: iso(success), paid, href });
    else if (run && (run.status === "failed" || run.status === "skipped")) {
      const reason = run.reason ? ((PROJECT_MESSAGES.rank.reasons as Record<string, string>)[run.reason] ?? run.reason) : M.failed;
      positions = cell("error", { lastSync: iso(success), error: reason, paid, href });
    } else if (settings.frequency !== "manual" && olderThan(success, (RANK_INTERVAL_DAYS[settings.frequency] ?? 7) + SCHEDULE_GRACE_DAYS, now)) {
      positions = cell(success ? "stale" : "waiting", { lastSync: iso(success), paid, href });
    } else positions = cell("ok", { lastSync: iso(success), paid, href });
    // A failing or late sync of the results shows on the project line too.
    if ((positions.state === "ok" || positions.state === "waiting") && (sitePositions.state === "error" || sitePositions.state === "stale")) {
      positions = { ...positions, state: sitePositions.state, error: sitePositions.error };
    }

    const cells = { positions } as Record<SourceId, SourceCell>;
    for (const id of SOURCE_IDS) if (id !== "positions") cells[id] = worstCell(siteRows.map((r) => r.cells[id]));

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      group: p.group,
      role,
      sites: siteRows,
      cells,
      rank: {
        enabled: settings.enabled,
        source: settings.source,
        sourceName: provider?.name ?? null,
        frequency: settings.frequency,
        canToggle: atLeast(role, "editor") && Boolean(provider),
      },
      billing,
    };
  });

  return { projects: rows, totals: sourceTotals(rows) };
}

const HEALTHY_PAID: CellState[] = ["ok", "waiting", "stale", "error"];

/** Counts per source: the project line for positions, every site for the others. */
export function sourceTotals(rows: SourceProjectRow[]): SourceTotals {
  const empty = () => Object.fromEntries(CELL_STATES.map((s) => [s, 0])) as Record<CellState, number>;
  const bySource = Object.fromEntries(SOURCE_IDS.map((id) => [id, empty()])) as Record<SourceId, Record<CellState, number>>;
  let paidActive = 0;
  for (const p of rows) {
    bySource.positions[p.cells.positions.state]++;
    if (p.cells.positions.paid && HEALTHY_PAID.includes(p.cells.positions.state)) paidActive++;
    for (const id of SOURCE_IDS) {
      if (id === "positions") continue;
      if (p.sites.length === 0) bySource[id]["no-site"]++;
      for (const s of p.sites) bySource[id][s.cells[id].state]++;
    }
  }
  const sum = (state: CellState) => SOURCE_IDS.reduce((n, id) => n + bySource[id][state], 0);
  return { bySource, ok: sum("ok"), stale: sum("stale"), errors: sum("error"), paidActive };
}

/** Whether a project line has a source that needs a look: an error or stale data. */
export function sourcesNeedAttention(row: Pick<SourceProjectRow, "cells">): boolean {
  return SOURCE_IDS.some((id) => row.cells[id].state === "error" || row.cells[id].state === "stale");
}
