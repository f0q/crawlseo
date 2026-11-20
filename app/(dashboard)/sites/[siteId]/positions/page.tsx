import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/format";
import { linkedEngines } from "@/lib/labrika/links";
import { LABRIKA_UI } from "@/lib/labrika/messages";
import { positionsReport, type Buckets } from "@/lib/labrika/report";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PositionsTable } from "@/components/labrika/positions-table";
import { PositionsTrendChart } from "@/components/labrika/positions-trend-chart";

const T = LABRIKA_UI;

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ engine?: string | string[] }>;
}

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

  const requested = [(await searchParams).engine].flat()[0];
  const engine = engines.find((e) => e.id === requested) ?? engines[0];
  const report = await positionsReport(db, engine.id);
  const { current, previous } = report.summary;
  const prev = (key: keyof Buckets) => (previous ? previous[key] : null);

  const meta = report.date
    ? [
        T.page.checkOf(formatDay(report.date, { year: true })),
        report.previousDate ? T.page.comparedTo(formatDay(report.previousDate, { year: true })) : T.page.noPrevious,
        ...(engine.lastSyncedAt ? [T.page.lastSynced(formatDay(engine.lastSyncedAt, { time: true }))] : []),
      ].join(" · ")
    : undefined;

  return (
    <div>
      <PageHeader title={T.page.title} meta={meta} description={T.page.description} />

      {engines.length > 1 && (
        <nav aria-label={T.page.engine} className="mb-5 flex flex-wrap gap-2">
          {engines.map((e) => (
            <Link
              key={e.id}
              href={`/sites/${siteId}/positions?engine=${encodeURIComponent(e.id)}`}
              aria-current={e.id === engine.id ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[13px] transition-colors",
                e.id === engine.id
                  ? "border-brand-500 bg-bg-soft font-medium text-text-strong"
                  : "border-border text-muted-foreground hover:text-text-strong"
              )}
            >
              {e.label}
            </Link>
          ))}
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
          <PositionsTable rows={report.keywords} />
        </div>
      )}
    </div>
  );
}
