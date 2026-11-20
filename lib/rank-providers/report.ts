import { Prisma, type PrismaClient } from "@prisma/client";
import { gscDate } from "@/lib/google/gsc-date";

/*
 * What the Positions page and /api/v1 show for one engine: the keywords on a
 * check day against the check before it, how many sit in the top 3, 10 and
 * 30, and those counts over time, for an engine of any source. A second
 * engine of another source can be read alongside for comparison.
 */

export type Buckets = { top3: number; top10: number; top30: number; notRanked: number; total: number };

export type KeywordPosition = {
  keyword: string;
  frequency: number | null;
  frequencyExact: number | null;
  position: number | null;
  previousPosition: number | null;
  /** Places gained since the previous check (positive is better); null unless ranked on both. */
  change: number | null;
  /** "new": ranked now, not before. "lost": ranked before, not now. */
  movement: "new" | "lost" | null;
  url: string | null;
};

export type TrendPoint = Buckets & { date: string };

export type PositionsReport = {
  /** Every check day stored, newest first. */
  dates: string[];
  date: string | null;
  previousDate: string | null;
  summary: { current: Buckets; previous: Buckets | null };
  keywords: KeywordPosition[];
  trend: TrendPoint[];
};

type Row = { keyword: string; position: number | null; url: string | null; frequency: number | null; frequencyExact: number | null };

/** Cumulative buckets: the top 3 count also in the top 10 and the top 30. */
export function bucketsOf(positions: (number | null)[]): Buckets {
  const b: Buckets = { top3: 0, top10: 0, top30: 0, notRanked: 0, total: positions.length };
  for (const p of positions) {
    if (p === null) b.notRanked++;
    else {
      if (p <= 3) b.top3++;
      if (p <= 10) b.top10++;
      if (p <= 30) b.top30++;
    }
  }
  return b;
}

/** Each keyword of the check with its position on the previous one. A keyword new to this check has no previous row. */
export function compareChecks(current: Row[], previous: Row[] | null): KeywordPosition[] {
  const before = new Map((previous ?? []).map((r) => [r.keyword, r]));
  return current.map((r) => {
    const prev = before.get(r.keyword);
    const previousPosition = prev?.position ?? null;
    const change = r.position !== null && previousPosition !== null ? previousPosition - r.position : null;
    const movement =
      prev && r.position !== null && previousPosition === null
        ? "new"
        : prev && r.position === null && previousPosition !== null
          ? "lost"
          : null;
    return {
      keyword: r.keyword,
      frequency: r.frequency,
      frequencyExact: r.frequencyExact,
      position: r.position,
      previousPosition,
      change,
      movement,
      url: r.url,
    };
  });
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function checkDates(db: Pick<PrismaClient, "externalRank">, engineId: string): Promise<string[]> {
  const rows = await db.externalRank.groupBy({ by: ["date"], where: { engineId }, orderBy: { date: "desc" } });
  return rows.map((r) => day(r.date));
}

export async function rowsOn(db: Pick<PrismaClient, "externalRank">, engineId: string, date: string): Promise<Row[]> {
  return db.externalRank.findMany({
    where: { engineId, date: gscDate(date) },
    select: { keyword: true, position: true, url: true, frequency: true, frequencyExact: true },
    orderBy: { keyword: "asc" },
  });
}

/** The bucket counts of the last `checks` check days, oldest first, counted in the database. */
export async function bucketTrend(
  db: Pick<PrismaClient, "$queryRaw">,
  engineId: string,
  since: string | null
): Promise<TrendPoint[]> {
  if (!since) return [];
  const rows = await db.$queryRaw<
    { date: Date; top3: bigint; top10: bigint; top30: bigint; notRanked: bigint; total: bigint }[]
  >(Prisma.sql`
    SELECT "date",
      COUNT(*) FILTER (WHERE "position" <= 3) AS "top3",
      COUNT(*) FILTER (WHERE "position" <= 10) AS "top10",
      COUNT(*) FILTER (WHERE "position" <= 30) AS "top30",
      COUNT(*) FILTER (WHERE "position" IS NULL) AS "notRanked",
      COUNT(*) AS "total"
    FROM "ExternalRank"
    WHERE "engineId" = ${engineId} AND "date" >= ${gscDate(since)}
    GROUP BY "date"
    ORDER BY "date" ASC`);
  return rows.map((r) => ({
    date: day(r.date),
    top3: Number(r.top3),
    top10: Number(r.top10),
    top30: Number(r.top30),
    notRanked: Number(r.notRanked),
    total: Number(r.total),
  }));
}

/**
 * The report for one engine on `date` (the latest check by default), against
 * the check before it, with the trend over the last `trendChecks` checks.
 * A date that has no check gives an empty report with the dates there are.
 * `from` and `to` (YYYY-MM-DD, both included) limit the checks considered.
 */
export async function positionsReport(
  db: Pick<PrismaClient, "externalRank" | "$queryRaw">,
  engineId: string,
  opts: { date?: string; trendChecks?: number; from?: string; to?: string } = {}
): Promise<PositionsReport> {
  const dates = (await checkDates(db, engineId)).filter(
    (d) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
  );
  const index = opts.date ? dates.indexOf(opts.date) : 0;
  const date = index >= 0 ? (dates[index] ?? null) : null;
  const previousDate = date ? (dates[index + 1] ?? null) : null;
  const trendChecks = Math.max(1, opts.trendChecks ?? 60);

  const [current, previous, trend] = await Promise.all([
    date ? rowsOn(db, engineId, date) : Promise.resolve([]),
    previousDate ? rowsOn(db, engineId, previousDate) : Promise.resolve(null),
    bucketTrend(db, engineId, dates[Math.min(trendChecks, dates.length) - 1] ?? null).then((points) =>
      opts.to ? points.filter((p) => p.date <= opts.to!) : points
    ),
  ]);

  return {
    dates,
    date,
    previousDate,
    summary: {
      current: bucketsOf(current.map((r) => r.position)),
      previous: previous ? bucketsOf(previous.map((r) => r.position)) : null,
    },
    keywords: compareChecks(current, previous),
    trend,
  };
}

export type ComparedPosition = { position: number | null; url: string | null };

/**
 * The latest check of another engine (another source of the same search
 * engine, region and device), keyword to position, for the comparison column.
 * `onOrBefore` picks the latest check up to that day.
 */
export async function comparisonRows(
  db: Pick<PrismaClient, "externalRank">,
  engineId: string,
  onOrBefore?: string
): Promise<{ date: string | null; byKeyword: Map<string, ComparedPosition> }> {
  const dates = await checkDates(db, engineId);
  const date = (onOrBefore ? dates.find((d) => d <= onOrBefore) : dates[0]) ?? dates.at(-1) ?? null;
  if (!date) return { date: null, byKeyword: new Map() };
  const rows = await rowsOn(db, engineId, date);
  return { date, byKeyword: new Map(rows.map((r) => [r.keyword.toLowerCase(), { position: r.position, url: r.url }])) };
}
