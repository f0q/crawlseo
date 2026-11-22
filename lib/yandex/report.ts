import type { PrismaClient } from "@prisma/client";
import { gscDate } from "@/lib/google/gsc-date";
import { linkView, type LinkView } from "./links";
import { addDays, dayOf } from "./sync";
import type { WebmasterProblem, WebmasterSitemap } from "./webmaster";

/*
 * What the Yandex page, the project cards, /api/v1 and the MCP read: a
 * period's numbers against the period before, and the daily series. Shared,
 * so every screen shows the same figures.
 */

type Db = Pick<PrismaClient, "yandexSiteLink" | "yandexWebmasterDaily" | "yandexQueryWeekly" | "yandexMetrikaDaily" | "yandexGoalDaily">;

export type Compare = { current: number | null; previous: number | null };

export type Period = { from: string; to: string; previousFrom: string; previousTo: string; days: number };

/** `days` ending on `end`, and the same number of days before them. */
export function periodEnding(end: string, days: number): Period {
  return {
    from: addDays(end, -(days - 1)),
    to: end,
    previousFrom: addDays(end, -(2 * days - 1)),
    previousTo: addDays(end, -days),
    days,
  };
}

const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

/** Whether a search engine id or name is Yandex. */
export function isYandexEngine(key: string, name: string): boolean {
  return key.toLowerCase() === "yandex" || /yandex|яндекс/i.test(name);
}

const SEVERITY_ORDER = ["FATAL", "CRITICAL", "POSSIBLE_PROBLEM", "RECOMMENDATION"];

/* ------------------------------------------------------------------ */
/*  Metrika                                                           */
/* ------------------------------------------------------------------ */

export type MetrikaReport = {
  link: LinkView;
  period: Period | null;
  totals: {
    visits: Compare;
    usersPerDay: Compare;
    yandexSearchVisits: Compare;
    searchVisits: Compare;
    goalReaches: Compare;
    bounceRate: Compare;
    pageDepth: Compare;
    avgDurationSeconds: Compare;
  };
  sources: { key: string; name: string; visits: number; previousVisits: number }[];
  engines: { key: string; name: string; visits: number; previousVisits: number }[];
  goals: { id: string; name: string; reaches: number; previousReaches: number }[];
  /** One point per day of the period: total visits and visits by source key. */
  daily: { date: string; visits: number; users: number; bySource: Record<string, number> }[];
};

function weighted(rows: { visits: number; value: number | null }[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const r of rows) {
    if (r.value === null) continue;
    sum += r.value * r.visits;
    weight += r.visits;
  }
  return weight > 0 ? Math.round((sum / weight) * 100) / 100 : null;
}

export async function metrikaReport(db: Db, siteId: string, opts: { days?: number; end?: string } = {}): Promise<MetrikaReport> {
  const days = opts.days ?? 28;
  const link = linkView(await db.yandexSiteLink.findUnique({ where: { siteId } }));
  const latest = await db.yandexMetrikaDaily.findFirst({ where: { siteId, kind: "total" }, orderBy: { date: "desc" }, select: { date: true } });
  const empty: MetrikaReport = {
    link,
    period: null,
    totals: {
      visits: { current: null, previous: null },
      usersPerDay: { current: null, previous: null },
      yandexSearchVisits: { current: null, previous: null },
      searchVisits: { current: null, previous: null },
      goalReaches: { current: null, previous: null },
      bounceRate: { current: null, previous: null },
      pageDepth: { current: null, previous: null },
      avgDurationSeconds: { current: null, previous: null },
    },
    sources: [],
    engines: [],
    goals: [],
    daily: [],
  };
  if (!latest) return empty;

  const period = periodEnding(opts.end ?? dayOf(latest.date), days);
  const range = { gte: gscDate(period.previousFrom), lte: gscDate(period.to) };
  const [rows, goals, earliest] = await Promise.all([
    db.yandexMetrikaDaily.findMany({ where: { siteId, date: range }, orderBy: { date: "asc" } }),
    db.yandexGoalDaily.findMany({ where: { siteId, date: range, goalId: { in: link.goals.map((g) => g.id) } } }),
    db.yandexMetrikaDaily.findFirst({ where: { siteId, kind: "total" }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  // A previous period that starts before the first stored day is unknown, not smaller.
  const hasPrevious = !!earliest && dayOf(earliest.date) <= period.previousFrom;

  const cur = rows.filter((r) => inRange(dayOf(r.date), period.from, period.to));
  const prev = rows.filter((r) => inRange(dayOf(r.date), period.previousFrom, period.previousTo));
  const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => number) => list.reduce((n, r) => n + pick(r), 0);
  const compare = (c: number | null, p: number | null): Compare => ({ current: c, previous: hasPrevious ? p : null });

  const totalCur = cur.filter((r) => r.kind === "total");
  const totalPrev = prev.filter((r) => r.kind === "total");
  const engineCur = cur.filter((r) => r.kind === "engine");
  const enginePrev = prev.filter((r) => r.kind === "engine");
  const yandexVisits = (list: typeof rows) => sum(list.filter((r) => isYandexEngine(r.key, r.name)), (r) => r.visits);
  const goalSum = (from: string, to: string, id?: string) =>
    goals.filter((g) => (!id || g.goalId === id) && inRange(dayOf(g.date), from, to)).reduce((n, g) => n + g.reaches, 0);

  const breakdown = (kind: string) => {
    const map = new Map<string, { key: string; name: string; visits: number; previousVisits: number }>();
    for (const r of rows.filter((x) => x.kind === kind)) {
      const entry = map.get(r.key) ?? { key: r.key, name: r.name || r.key, visits: 0, previousVisits: 0 };
      if (inRange(dayOf(r.date), period.from, period.to)) entry.visits += r.visits;
      else if (inRange(dayOf(r.date), period.previousFrom, period.previousTo)) entry.previousVisits += r.visits;
      map.set(r.key, entry);
    }
    return [...map.values()].filter((e) => e.visits || e.previousVisits).sort((a, b) => b.visits - a.visits || b.previousVisits - a.previousVisits);
  };

  const daily: MetrikaReport["daily"] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const total = totalCur.find((r) => dayOf(r.date) === d);
    const bySource: Record<string, number> = {};
    for (const r of cur) if (r.kind === "source" && dayOf(r.date) === d) bySource[r.key] = r.visits;
    daily.push({ date: d, visits: total?.visits ?? 0, users: total?.users ?? 0, bySource });
  }

  return {
    link,
    period,
    totals: {
      visits: compare(sum(totalCur, (r) => r.visits), sum(totalPrev, (r) => r.visits)),
      usersPerDay: compare(Math.round(sum(totalCur, (r) => r.users) / days), Math.round(sum(totalPrev, (r) => r.users) / days)),
      yandexSearchVisits: compare(yandexVisits(engineCur), yandexVisits(enginePrev)),
      searchVisits: compare(sum(engineCur, (r) => r.visits), sum(enginePrev, (r) => r.visits)),
      goalReaches: link.goals.length
        ? compare(goalSum(period.from, period.to), goalSum(period.previousFrom, period.previousTo))
        : { current: null, previous: null },
      bounceRate: compare(weighted(totalCur.map((r) => ({ visits: r.visits, value: r.bounceRate }))), weighted(totalPrev.map((r) => ({ visits: r.visits, value: r.bounceRate })))),
      pageDepth: compare(weighted(totalCur.map((r) => ({ visits: r.visits, value: r.pageDepth }))), weighted(totalPrev.map((r) => ({ visits: r.visits, value: r.pageDepth })))),
      avgDurationSeconds: compare(
        weighted(totalCur.map((r) => ({ visits: r.visits, value: r.avgDuration }))),
        weighted(totalPrev.map((r) => ({ visits: r.visits, value: r.avgDuration })))
      ),
    },
    sources: breakdown("source"),
    engines: breakdown("engine"),
    goals: link.goals.map((g) => ({
      id: g.id,
      name: g.name,
      reaches: goalSum(period.from, period.to, g.id),
      previousReaches: goalSum(period.previousFrom, period.previousTo, g.id),
    })),
    daily,
  };
}

/* ------------------------------------------------------------------ */
/*  Webmaster                                                         */
/* ------------------------------------------------------------------ */

export type QueryRow = {
  query: string;
  shows: number | null;
  clicks: number | null;
  ctr: number | null;
  avgShowPosition: number | null;
  avgClickPosition: number | null;
  previousShows: number | null;
  previousAvgShowPosition: number | null;
};

export type WebmasterReport = {
  link: LinkView;
  period: Period | null;
  latestDate: string | null;
  cards: { sqi: Compare; searchablePages: Compare; excludedPages: Compare; problems: Compare };
  problems: WebmasterProblem[];
  sitemaps: WebmasterSitemap[];
  week: { from: string; to: string } | null;
  totalQueries: number;
  queries: QueryRow[];
  daily: { date: string; sqi: number | null; searchablePages: number | null; excludedPages: number | null; http2xx: number | null; http3xx: number | null; http4xx: number | null; http5xx: number | null }[];
};

type WmRow = Awaited<ReturnType<Db["yandexWebmasterDaily"]["findMany"]>>[number];

/** The newest value of a column on or before `day` (any day when no bound). */
function valueAt(rows: WmRow[], pick: (r: WmRow) => number | null, day?: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (day && dayOf(rows[i].date) > day) continue;
    const v = pick(rows[i]);
    if (v !== null) return v;
  }
  return null;
}

const problemTotal = (r: WmRow) =>
  r.problemsFatal === null && r.problemsCritical === null && r.problemsPossible === null && r.problemsRecommendation === null
    ? null
    : (r.problemsFatal ?? 0) + (r.problemsCritical ?? 0) + (r.problemsPossible ?? 0) + (r.problemsRecommendation ?? 0);

export async function webmasterReport(db: Db, siteId: string, opts: { days?: number; limit?: number } = {}): Promise<WebmasterReport> {
  const days = opts.days ?? 28;
  const limit = opts.limit ?? 50;
  const linkRow = await db.yandexSiteLink.findUnique({ where: { siteId } });
  const link = linkView(linkRow);
  const problems = ((linkRow?.webmasterProblems ?? []) as WebmasterProblem[])
    .filter((p) => p.state === "PRESENT")
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.code.localeCompare(b.code));
  const sitemaps = (linkRow?.webmasterSitemaps ?? []) as WebmasterSitemap[];

  const rows = await db.yandexWebmasterDaily.findMany({ where: { siteId }, orderBy: { date: "asc" } });
  const latestDate = rows.length ? dayOf(rows[rows.length - 1].date) : null;
  const period = latestDate ? periodEnding(latestDate, days) : null;
  const card = (pick: (r: WmRow) => number | null): Compare => ({
    current: valueAt(rows, pick),
    previous: period ? valueAt(rows, pick, period.previousTo) : null,
  });

  // The newest stored week of queries, and the week before for the change.
  const weeks = await db.yandexQueryWeekly.groupBy({ by: ["weekStart"], where: { siteId }, orderBy: { weekStart: "desc" }, take: 2 });
  let queries: QueryRow[] = [];
  let totalQueries = 0;
  let week: WebmasterReport["week"] = null;
  if (weeks.length) {
    const [latestWeek, previousWeek] = weeks.map((w) => w.weekStart);
    week = { from: dayOf(latestWeek), to: addDays(dayOf(latestWeek), 6) };
    const [cur, prev] = await Promise.all([
      db.yandexQueryWeekly.findMany({ where: { siteId, weekStart: latestWeek } }),
      previousWeek ? db.yandexQueryWeekly.findMany({ where: { siteId, weekStart: previousWeek } }) : Promise.resolve([]),
    ]);
    const before = new Map(prev.map((q) => [q.query, q]));
    totalQueries = cur.length;
    queries = cur
      .sort((a, b) => (b.shows ?? -1) - (a.shows ?? -1) || a.query.localeCompare(b.query))
      .slice(0, limit)
      .map((q) => ({
        query: q.query,
        shows: q.shows,
        clicks: q.clicks,
        ctr: q.shows && q.clicks !== null ? Math.round((q.clicks / q.shows) * 10000) / 100 : null,
        avgShowPosition: q.avgShowPosition,
        avgClickPosition: q.avgClickPosition,
        previousShows: before.get(q.query)?.shows ?? null,
        previousAvgShowPosition: before.get(q.query)?.avgShowPosition ?? null,
      }));
  }

  return {
    link,
    period,
    latestDate,
    cards: {
      sqi: card((r) => r.sqi),
      searchablePages: card((r) => r.searchablePages),
      excludedPages: card((r) => r.excludedPages),
      problems: card(problemTotal),
    },
    problems,
    sitemaps,
    week,
    totalQueries,
    queries,
    daily: period
      ? rows
          .filter((r) => inRange(dayOf(r.date), period.from, period.to))
          .map((r) => ({
            date: dayOf(r.date),
            sqi: r.sqi,
            searchablePages: r.searchablePages,
            excludedPages: r.excludedPages,
            http2xx: r.http2xx,
            http3xx: r.http3xx,
            http4xx: r.http4xx,
            http5xx: r.http5xx,
          }))
      : [],
  };
}
