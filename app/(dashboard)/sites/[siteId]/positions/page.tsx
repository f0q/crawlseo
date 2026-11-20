import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/format";
import { linkedEngines, type LinkedEngine } from "@/lib/rank-providers/links";
import { RANK_UI } from "@/lib/rank-providers/messages";
import { comparisonRows, positionsReport, type Buckets } from "@/lib/rank-providers/report";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PositionsTable, type PositionsComparison } from "@/components/rank-tracking/positions-table";
import { PositionsTrendChart } from "@/components/rank-tracking/positions-trend-chart";

const T = RANK_UI;

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ engine?: string | string[]; compare?: string | string[] }>;
}

/** The engine's source, as a small badge next to its name. */
function SourceBadge({ engine }: { engine: LinkedEngine }) {
  return (
    <span className="mono-label ml-1.5 rounded border border-border px-1 py-0 text-[10px] leading-4 text-muted-foreground">
      {engine.userLabel ? `${engine.sourceName}: ${engine.userLabel}` : engine.sourceName}
    </span>
  );
}

const sourceTitle = (e: LinkedEngine) => (e.userLabel ? `${e.sourceName}: ${e.userLabel}` : e.sourceName);

/** A bucket card: the count on the check and its change since the previous one. */
function BucketCard({
  label,
  value,
  previous,
  higherIsBetter = true,
}: {
  label: string;
  value: number;
  previous: number | null;
  higherIsBetter?: boolean;
}) {
  const delta = previous === null ? null : value - previous;
  const good = delta !== null && (higherIsBetter ? delta > 0 : delta < 0);
  return (
    <div className="panel flex min-w-0 flex-col gap-2 px-5 py-[18px]">
      <p className="text-[13px] leading-5 text-muted-foreground">{label}</p>
      <p className="font-data text-[30px] leading-9 font-medium tracking-[-0.02em] text-text-strong">{value}</p>
      <p
        className={cn(
          "mono-label truncate text-[12px] leading-4 whitespace-nowrap",
          delta === null || delta === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger"
        )}
      >
        {delta === null
          ? T.cards.firstCheck
          : delta === 0
            ? T.cards.noChange
            : T.cards.vsPrevious(delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`)}
      </p>
    </div>
  );
}

export default async function PositionsPage({ params, searchParams }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const engines = await linkedEngines(db, siteId);
  if (engines.length === 0) {
    return (
      <div>
        <PageHeader title={T.page.title} description={T.page.description} />
        <EmptyState
          illustration="empty-keywords"
          title={T.page.noLinkTitle}
          description={T.page.noLinkDescription}
          actionLabel={T.page.noLinkAction}
          actionHref={`/sites/${siteId}/settings`}
        />
      </div>
    );
  }

  const query = await searchParams;
  const requested = [query.engine].flat()[0];
  const engine = engines.find((e) => e.id === requested) ?? engines[0];
  const report = await positionsReport(db, engine.id);

  // Another source of the same search engine, region and device: shown side by side, the first one by default.
  const candidates = engines.filter((e) => e.id !== engine.id && e.matchKey === engine.matchKey);
  const wantedCompare = [query.compare].flat()[0];
  const compareEngine =
    wantedCompare === "none" ? undefined : (candidates.find((e) => e.id === wantedCompare) ?? candidates[0]);
  let comparison: PositionsComparison | undefined;
  let comparisonMeta: string | undefined;
  if (compareEngine && report.date) {
    const other = await comparisonRows(db, compareEngine.id, report.date);
    if (other.date) {
      comparison = { source: sourceTitle(compareEngine), byKeyword: Object.fromEntries(other.byKeyword) };
      comparisonMeta = T.page.comparisonOf(sourceTitle(compareEngine), formatDay(other.date, { year: true }));
    }
  }
  const href = (engineId: string, compare?: string) =>
    `/sites/${siteId}/positions?engine=${encodeURIComponent(engineId)}${compare ? `&compare=${encodeURIComponent(compare)}` : ""}`;
  const { current, previous } = report.summary;
  const prev = (key: keyof Buckets) => (previous ? previous[key] : null);

  const meta = report.date
    ? [
        T.page.checkOf(formatDay(report.date, { year: true })),
        report.previousDate ? T.page.comparedTo(formatDay(report.previousDate, { year: true })) : T.page.noPrevious,
        ...(engine.lastSyncedAt ? [T.page.lastSynced(formatDay(engine.lastSyncedAt, { time: true }))] : []),
        ...(comparisonMeta ? [comparisonMeta] : []),
      ].join(" · ")
    : undefined;

  return (
    <div>
      <PageHeader title={T.page.title} meta={meta} description={T.page.description} />

      {engines.length > 0 && (
        <nav aria-label={T.page.engine} className="mb-5 flex flex-wrap gap-2">
          {engines.map((e) => (
            <Link
              key={e.id}
              href={href(e.id)}
              aria-current={e.id === engine.id ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[13px] transition-colors",
                e.id === engine.id
                  ? "border-brand-500 bg-bg-soft font-medium text-text-strong"
                  : "border-border text-muted-foreground hover:text-text-strong"
              )}
            >
              {e.label}
              <SourceBadge engine={e} />
            </Link>
          ))}
        </nav>
      )}

      {candidates.length > 0 && (
        <nav aria-label={T.page.compare} className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground" title={T.page.compareHint}>
            {T.page.compare}:
          </span>
          {[...candidates.map((c) => ({ id: c.id, title: sourceTitle(c) })), { id: "none", title: T.page.compareNone }].map((c) => {
            const active = c.id === "none" ? !compareEngine : compareEngine?.id === c.id;
            return (
              <Link
                key={c.id}
                href={href(engine.id, c.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 transition-colors",
                  active ? "border-brand-500 bg-bg-soft font-medium text-text-strong" : "border-border text-muted-foreground hover:text-text-strong"
                )}
              >
                {c.title}
              </Link>
            );
          })}
        </nav>
      )}

      {!report.date ? (
        <EmptyState illustration="empty-gsc-wait" title={T.page.noDataTitle} description={T.page.noDataDescription} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <BucketCard label={T.cards.top3} value={current.top3} previous={prev("top3")} />
            <BucketCard label={T.cards.top10} value={current.top10} previous={prev("top10")} />
            <BucketCard label={T.cards.top30} value={current.top30} previous={prev("top30")} />
            <BucketCard
              label={T.cards.notRanked}
              value={current.notRanked}
              previous={prev("notRanked")}
              higherIsBetter={false}
            />
          </div>
          <PositionsTrendChart points={report.trend} />
          <PositionsTable rows={report.keywords} comparison={comparison} />
        </div>
      )}
    </div>
  );
}
