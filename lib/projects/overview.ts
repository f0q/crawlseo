import { db } from "@/lib/db";
import { getSitePeriodMetrics } from "@/lib/seo-metrics";
import { metrikaReport, webmasterReport, type Compare } from "@/lib/yandex/report";
import { getProject, listJournal, listTasks } from "./service";
import { sourcesMatrix } from "./sources";
import type { Actor } from "./access";
import type { TaskStatus } from "./schema";

/*
 * The Overview tab of a project (agency fork): what is going on, read from
 * data that is already there. Nothing new is collected and nothing is
 * changed. A site's numbers and alerts are shown only to its owner, like the
 * Yandex cards of the Data tab (other members see the domain).
 */

/** Alerts that fired within this many days count as active. */
export const ACTIVE_ALERT_DAYS = 7;
const DAYS = 28;
const MAX_TASKS = 6;
const MAX_JOURNAL = 5;

/**
 * A line the agent's platform sync writes on every run, e.g. "синхронизация
 * с платформой seo.aijam.pro (crawlseo-sync.py)". It says nothing about the
 * work, so the overview leaves it out. The full journal still has it.
 */
export function isServiceEntry(text: string): boolean {
  return text.length <= 200 && /crawlseo-sync(\.py)?\b/i.test(text);
}

/** Tasks that wait for someone first: review, then in progress, then to do; high priority and the earliest due first. */
const STATUS_ORDER: Record<string, number> = { review: 0, doing: 1, todo: 2 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

export type OverviewSite = {
  id: string;
  domain: string;
  yours: boolean;
  /** Search Console, the last 28 days against the 28 before; null without data or for another member's site. */
  gsc: { clicks: Compare; impressions: Compare; avgPosition: Compare } | null;
  /** Yandex Metrika and Webmaster, the same period; null when the site has no Yandex link. */
  yandex: { visits: Compare; searchVisits: Compare; goalReaches: Compare; sqi: Compare } | null;
};

export type OverviewAlert = { id: string; siteId: string; domain: string; type: string; lastFired: string };

export async function projectOverview(actor: Actor, slug: string, now = new Date()) {
  const { project, sites, counts } = await getProject(actor, slug);
  const [{ tasks }, { entries }, matrix] = await Promise.all([
    listTasks(actor, slug),
    listJournal(actor, slug, { limit: 50 }),
    // Agency fork UX step 2: the project's line of the data sources panel, with its billing state.
    sourcesMatrix(actor, { slug, now }),
  ]);
  const sources = matrix.projects[0] ?? null;

  const open = tasks
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999")
    );
  const byStatus: Partial<Record<TaskStatus, number>> = {};
  for (const t of open) byStatus[t.status as TaskStatus] = (byStatus[t.status as TaskStatus] ?? 0) + 1;
  const today = now.toISOString().slice(0, 10);

  const own = sites.filter((s) => s.yours);
  const ownIds = own.map((s) => s.id);
  const since = new Date(now.getTime() - ACTIVE_ALERT_DAYS * 86_400_000);
  const [alerts, withPages, yandexLinks, rank, lastRun] = await Promise.all([
    ownIds.length
      ? db.alert.findMany({
          where: { siteId: { in: ownIds }, enabled: true, lastFired: { gte: since } },
          select: { id: true, siteId: true, type: true, lastFired: true },
          orderBy: { lastFired: "desc" },
        })
      : [],
    ownIds.length ? db.page.groupBy({ by: ["siteId"], where: { siteId: { in: ownIds } }, _max: { date: true } }) : [],
    ownIds.length ? db.yandexSiteLink.findMany({ where: { siteId: { in: ownIds } }, select: { siteId: true } }) : [],
    db.projectRankSettings.findUnique({ where: { projectId: project.id }, select: { enabled: true, source: true, frequency: true } }),
    db.rankCheckRun.findFirst({
      where: { projectId: project.id, status: { in: ["started", "partial"] } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const gscThrough = new Map(withPages.map((r) => [r.siteId, r._max.date?.toISOString().slice(0, 10) ?? null]));
  const linked = new Set(yandexLinks.map((l) => l.siteId));
  const domainOf = new Map(sites.map((s) => [s.id, s.domain]));

  const siteRows: OverviewSite[] = await Promise.all(
    sites.map(async (s): Promise<OverviewSite> => {
      if (!s.yours) return { id: s.id, domain: s.domain, yours: false, gsc: null, yandex: null };
      const [gsc, yandex] = await Promise.all([
        gscThrough.has(s.id)
          ? getSitePeriodMetrics(s.id, DAYS)
              .then(({ current, previous }) => ({
                clicks: { current: current.clicks, previous: previous.clicks },
                impressions: { current: current.impressions, previous: previous.impressions },
                avgPosition: {
                  current: current.avgPosition ? round1(current.avgPosition) : null,
                  previous: previous.avgPosition ? round1(previous.avgPosition) : null,
                },
              }))
              .catch(() => null)
          : null,
        linked.has(s.id)
          ? Promise.all([metrikaReport(db, s.id, { days: DAYS }), webmasterReport(db, s.id, { days: DAYS, limit: 1 })]).then(([m, w]) => ({
              visits: m.totals.visits,
              searchVisits: m.totals.yandexSearchVisits,
              goalReaches: m.totals.goalReaches,
              sqi: w.cards.sqi,
            }))
          : null,
      ]);
      return { id: s.id, domain: s.domain, yours: true, gsc, yandex };
    })
  );

  return {
    project,
    counts,
    tasks: {
      open: open.length,
      byStatus,
      overdue: open.filter((t) => t.due !== null && t.due < today).length,
      items: open.slice(0, MAX_TASKS).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due, assignee: t.assignee })),
    },
    journal: entries
      .filter((e) => !isServiceEntry(e.text))
      .slice(0, MAX_JOURNAL)
      .map((e) => ({ id: e.id, date: e.date, text: e.text, link: e.link, author: e.author, siteId: e.siteId })),
    alerts: alerts.map(
      (a): OverviewAlert => ({ id: a.id, siteId: a.siteId, domain: domainOf.get(a.siteId) ?? "", type: a.type, lastFired: a.lastFired!.toISOString() })
    ),
    sites: siteRows,
    sources,
    rank: {
      enabled: rank?.enabled ?? false,
      source: rank?.source ?? "none",
      frequency: rank?.frequency ?? "manual",
      lastStarted: lastRun ? lastRun.createdAt.toISOString() : null,
    },
  };
}

export type ProjectOverview = Awaited<ReturnType<typeof projectOverview>>;

const round1 = (n: number) => Math.round(n * 10) / 10;
