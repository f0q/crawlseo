import type { Prisma, PrismaClient } from "@prisma/client";
// Yandex days go through gscDate, the one day-to-UTC-midnight conversion, so a
// Yandex row and a GSC row for the same day carry the same timestamp.
import { gscDate } from "@/lib/google/gsc-date";
import { accessTokenFor, cachedWebmasterUserId, YandexNotConnectedError } from "./connection";
import { YandexApiError, type YandexHttpOptions } from "./http";
import { createMetrikaClient, MAX_METRICS, VISIT_METRICS, type MetrikaClient, type StatRow } from "./metrika";
import { createWebmasterClient, type DayValue, type WebmasterClient } from "./webmaster";

/*
 * The daily Yandex sync of one site (agency fork): Webmaster (summary,
 * indexing, pages in search and SQI history, popular queries per week,
 * problems and sitemaps) and Metrika (visits per day in total, by traffic
 * source and by search engine, and reaches of the chosen goals). The first
 * sync backfills; later ones fetch the last few days again, because both
 * services still revise them.
 */

/** Metrika days loaded on the first sync. */
export const METRIKA_BACKFILL_DAYS = 90;
/** Metrika days fetched again on later syncs: the latest stored ones may still grow. */
export const METRIKA_REFETCH_DAYS = 3;
/** Webmaster history loaded on the first sync (indexing, pages in search, SQI): Webmaster keeps about a year. */
export const WEBMASTER_BACKFILL_DAYS = 365;
export const WEBMASTER_REFETCH_DAYS = 7;
/** Weeks of popular queries loaded on the first sync, and at most per sync. */
export const QUERY_BACKFILL_WEEKS = 12;
/** Webmaster query statistics lag; a week is taken once its Sunday is this many days old. */
export const QUERY_LAG_DAYS = 3;
/** Queries stored per week. */
export const QUERIES_PER_WEEK = 500;

const DAY_MS = 86_400_000;
const INSERT_BATCH = 2_000;

export type YandexSyncResult = {
  webmasterDays: number;
  queryWeeks: number;
  queries: number;
  metrikaDays: number;
  goalRows: number;
  /** Parts that failed while the others were written: "part: reason". */
  failed?: string[];
};

/** Nothing could be synced; `permanent` when no retry can help (not connected, refused, nothing linked). */
export class YandexSyncError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean
  ) {
    super(message);
    this.name = "YandexSyncError";
  }
}

export type YandexSyncOptions = {
  http?: YandexHttpOptions;
  now?: Date;
  /** Only one service, for the link route after a change. */
  only?: "webmaster" | "metrika";
};

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => dayOf(new Date(gscDate(day).getTime() + n * DAY_MS));

/** The Mondays of the last `count` complete weeks whose Sunday is at least QUERY_LAG_DAYS before today, oldest first. */
export function completeWeeks(today: string, count: number): string[] {
  const lastSunday = (() => {
    const d = gscDate(addDays(today, -QUERY_LAG_DAYS));
    const back = d.getUTCDay(); // 0 = Sunday
    return addDays(dayOf(d), -back);
  })();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(lastSunday, -6 - 7 * i));
  return out;
}

/** The weeks to fetch: every complete week not stored yet within the window, plus the newest stored one. */
export function weeksToFetch(today: string, stored: string[]): string[] {
  const window = completeWeeks(today, QUERY_BACKFILL_WEEKS);
  const have = new Set(stored);
  const newest = [...stored].sort().at(-1);
  return window.filter((w) => !have.has(w) || w === newest);
}

/** The first day to fetch: a backfill without stored days, else a few days before the newest one. */
export function startDay(today: string, newestStored: string | null, backfillDays: number, refetchDays: number): string {
  const earliest = addDays(today, -(backfillDays - 1));
  if (!newestStored) return earliest;
  const from = addDays(newestStored, -refetchDays);
  return from < earliest ? earliest : from;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function isPermanent(err: unknown): boolean {
  return err instanceof YandexNotConnectedError || (err instanceof YandexApiError && err.permanent);
}

async function newestDay(
  db: PrismaClient,
  model: "yandexWebmasterDaily" | "yandexMetrikaDaily",
  siteId: string
): Promise<string | null> {
  const row =
    model === "yandexWebmasterDaily"
      ? await db.yandexWebmasterDaily.findFirst({ where: { siteId }, orderBy: { date: "desc" }, select: { date: true } })
      : await db.yandexMetrikaDaily.findFirst({ where: { siteId }, orderBy: { date: "desc" }, select: { date: true } });
  return row ? dayOf(row.date) : null;
}

/* ------------------------------------------------------------------ */
/*  Webmaster                                                         */
/* ------------------------------------------------------------------ */

type WmDay = Omit<Prisma.YandexWebmasterDailyCreateManyInput, "siteId" | "date" | "id">;

export async function syncWebmaster(
  db: PrismaClient,
  site: { id: string; userId: string; hostId: string },
  wm: WebmasterClient,
  today: string
): Promise<{ days: number; weeks: number; queries: number; failed: string[] }> {
  const uid = await cachedWebmasterUserId(db, site.userId, () => wm.userId());
  const from = startDay(today, await newestDay(db, "yandexWebmasterDaily", site.id), WEBMASTER_BACKFILL_DAYS, WEBMASTER_REFETCH_DAYS);
  const failed: string[] = [];

  // One after another: Webmaster publishes no numeric limits, only 429s.
  const calls: (() => Promise<unknown>)[] = [
    () => wm.summary(uid, site.hostId),
    () => wm.indexingHistory(uid, site.hostId, from, today),
    () => wm.searchableHistory(uid, site.hostId, from, today),
    () => wm.sqiHistory(uid, site.hostId, from, today),
    () => wm.diagnostics(uid, site.hostId),
    () => wm.sitemaps(uid, site.hostId),
  ];
  const parts: PromiseSettledResult<unknown>[] = [];
  for (const call of calls) {
    try {
      parts.push({ status: "fulfilled", value: await call() });
    } catch (err) {
      parts.push({ status: "rejected", reason: err });
      // A refused token or host fails every call the same way.
      if (isPermanent(err) && parts.length === 1) break;
    }
  }
  const names = ["summary", "indexing history", "pages in search history", "SQI history", "diagnostics", "sitemaps"];
  parts.forEach((p, i) => {
    if (p.status === "rejected") failed.push(`Webmaster ${names[i]}: ${reason(p.reason)}`);
  });
  if (parts.every((p) => p.status === "rejected")) {
    const first = (parts[0] as PromiseRejectedResult).reason;
    throw first instanceof Error ? first : new Error(String(first));
  }
  const value = <T>(i: number): T | null => (parts[i]?.status === "fulfilled" ? (parts[i] as PromiseFulfilledResult<T>).value : null);
  const summary = value<Awaited<ReturnType<WebmasterClient["summary"]>>>(0);
  const indexing = value<Awaited<ReturnType<WebmasterClient["indexingHistory"]>>>(1);
  const searchable = value<DayValue[]>(2);
  const sqi = value<DayValue[]>(3);
  const problems = value<Awaited<ReturnType<WebmasterClient["diagnostics"]>>>(4);
  const sitemaps = value<Awaited<ReturnType<WebmasterClient["sitemaps"]>>>(5);

  const days = new Map<string, WmDay>();
  const put = (date: string, values: WmDay) => {
    if (date < from || date > today) return;
    days.set(date, { ...days.get(date), ...values });
  };
  if (indexing) {
    for (const [key, column] of [
      ["http2xx", "http2xx"],
      ["http3xx", "http3xx"],
      ["http4xx", "http4xx"],
      ["http5xx", "http5xx"],
      ["other", "httpOther"],
    ] as const) {
      for (const p of indexing[key]) put(p.date, { [column]: Math.round(p.value) });
    }
  }
  for (const p of searchable ?? []) put(p.date, { searchablePages: Math.round(p.value) });
  for (const p of sqi ?? []) put(p.date, { sqi: Math.round(p.value) });
  if (summary) {
    put(today, {
      ...(summary.sqi !== null && { sqi: summary.sqi }),
      ...(summary.searchablePages !== null && { searchablePages: summary.searchablePages }),
      excludedPages: summary.excludedPages,
      problemsFatal: summary.problems.fatal,
      problemsCritical: summary.problems.critical,
      problemsPossible: summary.problems.possible,
      problemsRecommendation: summary.problems.recommendation,
    });
  }

  // Popular queries, one request per missing week.
  const storedWeeks = (
    await db.yandexQueryWeekly.groupBy({ by: ["weekStart"], where: { siteId: site.id } })
  ).map((r) => dayOf(r.weekStart));
  const weekRows = new Map<string, Prisma.YandexQueryWeeklyCreateManyInput[]>();
  for (const week of weeksToFetch(today, storedWeeks)) {
    try {
      const queries = await wm.popularQueries(uid, site.hostId, week, addDays(week, 6), QUERIES_PER_WEEK);
      const seen = new Set<string>();
      weekRows.set(
        week,
        queries
          .filter((q) => !seen.has(q.query) && seen.add(q.query))
          .map((q) => ({
            siteId: site.id,
            weekStart: gscDate(week),
            query: q.query,
            shows: q.shows,
            clicks: q.clicks,
            avgShowPosition: q.avgShowPosition,
            avgClickPosition: q.avgClickPosition,
          }))
      );
    } catch (err) {
      failed.push(`Webmaster queries ${week}: ${reason(err)}`);
      if (isPermanent(err)) break;
    }
  }

  await db.$transaction(
    async (tx) => {
      const link = await tx.yandexSiteLink.findUnique({ where: { siteId: site.id }, select: { webmasterHostId: true } });
      if (link?.webmasterHostId !== site.hostId) throw new YandexSyncError("The Webmaster host changed during the sync; nothing written", false);
      for (const [date, values] of days) {
        await tx.yandexWebmasterDaily.upsert({
          where: { siteId_date: { siteId: site.id, date: gscDate(date) } },
          create: { siteId: site.id, date: gscDate(date), ...values },
          update: values,
        });
      }
      for (const [week, rows] of weekRows) {
        await tx.yandexQueryWeekly.deleteMany({ where: { siteId: site.id, weekStart: gscDate(week) } });
        for (const part of chunk(rows, INSERT_BATCH)) await tx.yandexQueryWeekly.createMany({ data: part, skipDuplicates: true });
      }
      await tx.yandexSiteLink.update({
        where: { siteId: site.id },
        data: {
          ...(problems && { webmasterProblems: problems as unknown as Prisma.InputJsonValue }),
          ...(sitemaps && { webmasterSitemaps: sitemaps as unknown as Prisma.InputJsonValue }),
          webmasterSyncedAt: new Date(),
          webmasterError: failed.length ? failed.join("; ").slice(0, 1000) : null,
        },
      });
    },
    { timeout: 60_000 }
  );

  return {
    days: days.size,
    weeks: weekRows.size,
    queries: [...weekRows.values()].reduce((n, rows) => n + rows.length, 0),
    failed,
  };
}

/* ------------------------------------------------------------------ */
/*  Metrika                                                           */
/* ------------------------------------------------------------------ */

type MetrikaRow = Prisma.YandexMetrikaDailyCreateManyInput;

const dateOfRow = (r: StatRow) => r.dimensions[0]?.name ?? r.dimensions[0]?.id ?? null;
const int = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Math.round(v));

/** Turns report rows into stored rows of one kind; rows without a valid day are skipped. */
export function metrikaRows(siteId: string, kind: "total" | "source" | "engine", rows: StatRow[]): MetrikaRow[] {
  const out: MetrikaRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const date = dateOfRow(r);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const dim = r.dimensions[1];
    const key = kind === "total" ? "" : (dim?.id ?? dim?.name ?? "undefined");
    const unique = `${date}\u0000${key}`;
    if (seen.has(unique)) continue;
    seen.add(unique);
    out.push({
      siteId,
      date: gscDate(date),
      kind,
      key,
      name: kind === "total" ? "" : (dim?.name ?? key),
      visits: int(r.metrics[0]),
      users: int(r.metrics[1]),
      bounceRate: kind === "total" ? (r.metrics[2] ?? null) : null,
      pageDepth: kind === "total" ? (r.metrics[3] ?? null) : null,
      avgDuration: kind === "total" ? (r.metrics[4] ?? null) : null,
    });
  }
  return out;
}

export async function syncMetrika(
  db: PrismaClient,
  site: { id: string; counterId: string; goalIds: string[] },
  mt: MetrikaClient,
  today: string
): Promise<{ days: number; goalRows: number; failed: string[] }> {
  const from = startDay(today, await newestDay(db, "yandexMetrikaDaily", site.id), METRIKA_BACKFILL_DAYS, METRIKA_REFETCH_DAYS);
  const base = { counterId: site.counterId, date1: from, date2: today };
  const failed: string[] = [];

  // Totals first: without them the other tables have nothing to stand on.
  const totals = await mt.stat({ ...base, dimensions: ["ym:s:date"], metrics: VISIT_METRICS });
  const extra = await Promise.allSettled([
    mt.stat({ ...base, dimensions: ["ym:s:date", "ym:s:lastTrafficSource"], metrics: ["ym:s:visits", "ym:s:users"] }),
    mt.stat({
      ...base,
      dimensions: ["ym:s:date", "ym:s:lastSearchEngineRoot"],
      metrics: ["ym:s:visits", "ym:s:users"],
      filters: "ym:s:lastTrafficSource=='organic'",
    }),
  ]);
  const [sources, engines] = extra.map((p, i) => {
    if (p.status === "fulfilled") return p.value;
    failed.push(`Metrika ${i === 0 ? "traffic sources" : "search engines"}: ${reason(p.reason)}`);
    return null;
  });

  // Goals with stored days follow the same window; a goal added later gets its own backfill.
  const storedGoals = new Set(
    (await db.yandexGoalDaily.groupBy({ by: ["goalId"], where: { siteId: site.id, goalId: { in: site.goalIds } } })).map((r) => r.goalId)
  );
  const earliest = startDay(today, null, METRIKA_BACKFILL_DAYS, METRIKA_REFETCH_DAYS);
  const goalGroups = [
    { ids: site.goalIds.filter((id) => storedGoals.has(id)), from },
    { ids: site.goalIds.filter((id) => !storedGoals.has(id)), from: earliest },
  ].filter((g) => g.ids.length);
  const goalWrites: { ids: string[]; from: string; rows: Prisma.YandexGoalDailyCreateManyInput[] }[] = [];
  for (const group of goalGroups) {
    for (const ids of chunk(group.ids, MAX_METRICS)) {
      try {
        const rows = await mt.stat({ ...base, date1: group.from, dimensions: ["ym:s:date"], metrics: ids.map((id) => `ym:s:goal${id}reaches`) });
        const out: Prisma.YandexGoalDailyCreateManyInput[] = [];
        for (const r of rows) {
          const date = dateOfRow(r);
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          ids.forEach((goalId, i) => out.push({ siteId: site.id, date: gscDate(date), goalId, reaches: int(r.metrics[i]) }));
        }
        goalWrites.push({ ids, from: group.from, rows: out });
      } catch (err) {
        failed.push(`Metrika goals: ${reason(err)}`);
      }
    }
  }

  const range = { gte: gscDate(from), lte: gscDate(today) };
  const rows = [
    ...metrikaRows(site.id, "total", totals),
    ...(sources ? metrikaRows(site.id, "source", sources) : []),
    ...(engines ? metrikaRows(site.id, "engine", engines) : []),
  ];
  const kinds = ["total", ...(sources ? ["source"] : []), ...(engines ? ["engine"] : [])];

  await db.$transaction(
    async (tx) => {
      const link = await tx.yandexSiteLink.findUnique({ where: { siteId: site.id }, select: { metrikaCounterId: true } });
      if (link?.metrikaCounterId !== site.counterId) throw new YandexSyncError("The Metrika counter changed during the sync; nothing written", false);
      await tx.yandexMetrikaDaily.deleteMany({ where: { siteId: site.id, date: range, kind: { in: kinds } } });
      for (const part of chunk(rows, INSERT_BATCH)) await tx.yandexMetrikaDaily.createMany({ data: part, skipDuplicates: true });
      for (const w of goalWrites) {
        await tx.yandexGoalDaily.deleteMany({
          where: { siteId: site.id, goalId: { in: w.ids }, date: { gte: gscDate(w.from), lte: gscDate(today) } },
        });
        for (const part of chunk(w.rows, INSERT_BATCH)) await tx.yandexGoalDaily.createMany({ data: part, skipDuplicates: true });
      }
      await tx.yandexSiteLink.update({
        where: { siteId: site.id },
        data: { metrikaSyncedAt: new Date(), metrikaError: failed.length ? failed.join("; ").slice(0, 1000) : null },
      });
    },
    { timeout: 60_000 }
  );

  return { days: new Set(rows.filter((r) => r.kind === "total").map((r) => dayOf(r.date as Date))).size, goalRows: goalWrites.reduce((n, w) => n + w.rows.length, 0), failed };
}

/* ------------------------------------------------------------------ */
/*  Both                                                              */
/* ------------------------------------------------------------------ */

/**
 * Syncs what is linked to the site. Webmaster failing does not stop Metrika
 * and the other way round; when everything fails it throws, permanent only
 * when no failure can be retried.
 */
export async function syncYandexForSite(db: PrismaClient, siteId: string, opts: YandexSyncOptions = {}): Promise<YandexSyncResult> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, yandexLink: true },
  });
  if (!site) throw new YandexSyncError("Site not found", true);
  const link = site.yandexLink;
  const wantWm = !!link?.webmasterHostId && opts.only !== "metrika";
  const wantMt = !!link?.metrikaCounterId && opts.only !== "webmaster";
  if (!wantWm && !wantMt) throw new YandexSyncError("This site has no Yandex Webmaster host or Metrika counter linked", true);

  let token: string;
  try {
    token = await accessTokenFor(db, site.userId, { ...opts.http, now: opts.now });
  } catch (err) {
    throw new YandexSyncError(reason(err), isPermanent(err));
  }
  const today = dayOf(opts.now ?? new Date());
  const result: YandexSyncResult = { webmasterDays: 0, queryWeeks: 0, queries: 0, metrikaDays: 0, goalRows: 0 };
  const failed: string[] = [];
  const errors: unknown[] = [];

  if (wantWm) {
    try {
      const r = await syncWebmaster(db, { id: siteId, userId: site.userId, hostId: link!.webmasterHostId! }, createWebmasterClient(token, opts.http), today);
      Object.assign(result, { webmasterDays: r.days, queryWeeks: r.weeks, queries: r.queries });
      failed.push(...r.failed);
    } catch (err) {
      errors.push(err);
      failed.push(`Webmaster: ${reason(err)}`);
      await db.yandexSiteLink.updateMany({ where: { siteId }, data: { webmasterError: reason(err).slice(0, 1000) } });
    }
  }
  if (wantMt) {
    try {
      const r = await syncMetrika(db, { id: siteId, counterId: link!.metrikaCounterId!, goalIds: link!.metrikaGoalIds }, createMetrikaClient(token, opts.http), today);
      Object.assign(result, { metrikaDays: r.days, goalRows: r.goalRows });
      failed.push(...r.failed);
    } catch (err) {
      errors.push(err);
      failed.push(`Metrika: ${reason(err)}`);
      await db.yandexSiteLink.updateMany({ where: { siteId }, data: { metrikaError: reason(err).slice(0, 1000) } });
    }
  }

  const attempted = Number(wantWm) + Number(wantMt);
  if (errors.length === attempted) {
    throw new YandexSyncError(failed.join("; "), errors.every(isPermanent));
  }
  console.log(
    `[Yandex Sync] ${siteId}: ${result.webmasterDays} Webmaster day(s), ${result.queryWeeks} query week(s), ${result.metrikaDays} Metrika day(s)`
  );
  return failed.length ? { ...result, failed } : result;
}
