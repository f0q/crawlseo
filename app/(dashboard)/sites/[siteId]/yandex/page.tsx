import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/format";
import { problemLabel, sourceLabel, YANDEX_UI } from "@/lib/yandex/messages";
import { metrikaReport, webmasterReport, type MetrikaReport, type WebmasterReport } from "@/lib/yandex/report";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { YandexStatCard } from "@/components/yandex/stat-card";
import { YandexTrafficChart } from "@/components/yandex/traffic-chart";

const T = YANDEX_UI;
const PERIODS = [7, 28, 90] as const;

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}

/** Agency fork: the site in Yandex Metrika and Yandex Webmaster (lib/yandex). */
export default async function YandexPage({ params, searchParams }: Props) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { userId: true, domain: true } });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const wanted = Number([(await searchParams).days].flat()[0]);
  const days = (PERIODS as readonly number[]).includes(wanted) ? wanted : 28;
  const [metrika, webmaster] = await Promise.all([metrikaReport(db, siteId, { days }), webmasterReport(db, siteId, { days, limit: 50 })]);
  const link = metrika.link;

  if (!link.webmasterHostId && !link.metrikaCounterId) {
    return (
      <div>
        <PageHeader title={T.page.title} description={T.page.description} />
        <EmptyState
          illustration="empty-gsc-wait"
          title={T.page.noLinkTitle}
          description={T.page.noLinkDescription}
          actionLabel={T.page.noLinkAction}
          actionHref={`/sites/${siteId}/settings`}
        />
      </div>
    );
  }

  const meta = [
    T.page.period(days),
    T.page.vsPrevious,
    ...(link.metrikaSyncedAt ? [`${T.page.metrika} ${T.page.updated(formatDay(link.metrikaSyncedAt, { time: true }))}`] : []),
    ...(link.webmasterSyncedAt ? [`${T.page.webmaster} ${T.page.updated(formatDay(link.webmasterSyncedAt, { time: true }))}`] : []),
  ].join(" · ");

  return (
    <div>
      <PageHeader title={T.page.title} meta={meta} description={T.page.description} />
      <nav aria-label={T.page.title} className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((d) => (
          <Link
            key={d}
            href={`/sites/${siteId}/yandex?days=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={
              d === days
                ? "rounded-md border border-brand-500 bg-bg-soft px-3 py-1.5 text-[13px] font-medium text-text-strong"
                : "rounded-md border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:text-text-strong"
            }
          >
            {T.page.period(d)}
          </Link>
        ))}
      </nav>

      <div className="space-y-8">
        {link.metrikaCounterId ? <MetrikaBlock report={metrika} /> : <p className="panel px-5 py-4 text-sm text-muted-foreground">{T.page.notLinkedMetrika}</p>}
        {link.webmasterHostId ? <WebmasterBlock report={webmaster} /> : <p className="panel px-5 py-4 text-sm text-muted-foreground">{T.page.notLinkedWebmaster}</p>}
      </div>
    </div>
  );
}

function SyncError({ what, error }: { what: string; error: string | null }) {
  if (!error) return null;
  return <p className="mb-3 text-xs text-danger">{T.page.syncError(what, error)}</p>;
}

function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] leading-5 font-semibold text-text-strong">{children}</h2>
      {extra && <span className="text-[12px] text-muted-foreground">{extra}</span>}
    </div>
  );
}

function MetrikaBlock({ report }: { report: MetrikaReport }) {
  const { totals, link } = report;
  if (!report.period) {
    return (
      <section>
        <SectionTitle extra={link.metrikaCounterName}>{T.page.metrika}</SectionTitle>
        <SyncError what={T.page.metrika} error={link.metrikaError} />
        <EmptyState illustration="empty-gsc-wait" title={T.page.noDataTitle} description={T.page.noDataDescription} />
      </section>
    );
  }
  return (
    <section>
      <SectionTitle extra={`${link.metrikaCounterName ?? ""} (${link.metrikaCounterId}) · ${formatDay(report.period.from)} to ${formatDay(report.period.to, { year: true })}`}>
        {T.page.metrika}
      </SectionTitle>
      <SyncError what={T.page.metrika} error={link.metrikaError} />
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <YandexStatCard label={T.cards.visits} {...totals.visits} />
          <YandexStatCard label={T.cards.users} {...totals.usersPerDay} />
          <YandexStatCard label={T.cards.yandexSearch} {...totals.yandexSearchVisits} />
          <YandexStatCard label={T.cards.goals} {...totals.goalReaches} />
        </div>
        <YandexTrafficChart points={report.daily} sources={report.sources} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <BreakdownTable
            title={T.chart.title}
            rows={report.sources.map((s) => ({ key: s.key, label: sourceLabel(s.key, s.name), value: s.visits, previous: s.previousVisits }))}
            empty={T.page.noDataTitle}
          />
          <BreakdownTable
            title={T.engines.title}
            rows={report.engines.map((s) => ({ key: s.key, label: s.name || s.key, value: s.visits, previous: s.previousVisits }))}
            empty={T.engines.none}
          />
          <BreakdownTable
            title={T.goals.title}
            rows={report.goals.map((g) => ({ key: g.id, label: g.name, value: g.reaches, previous: g.previousReaches }))}
            empty={T.goals.none}
          />
        </div>
      </div>
    </section>
  );
}

function BreakdownTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { key: string; label: string; value: number; previous: number }[];
  empty: string;
}) {
  return (
    <div className="panel px-5 py-4">
      <h3 className="mb-2 text-[14px] leading-5 font-semibold text-text-strong">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map((r) => {
              const d = r.value - r.previous;
              return (
                <tr key={r.key} className="border-t border-border-soft first:border-t-0">
                  <td className="py-1.5 pr-2 text-text-strong">{r.label}</td>
                  <td className="py-1.5 text-right font-data">{r.value.toLocaleString("en-US")}</td>
                  <td className={`w-16 py-1.5 text-right font-data text-[12px] ${d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted-foreground"}`}>
                    {d === 0 ? "=" : d > 0 ? `+${d}` : `−${Math.abs(d)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WebmasterBlock({ report }: { report: WebmasterReport }) {
  const { cards, link } = report;
  const asOf = report.latestDate ? T.cards.asOf(formatDay(report.latestDate, { year: true })) : undefined;
  if (!report.latestDate && report.queries.length === 0) {
    return (
      <section>
        <SectionTitle extra={link.webmasterHostUrl}>{T.page.webmaster}</SectionTitle>
        <SyncError what={T.page.webmaster} error={link.webmasterError} />
        <EmptyState illustration="empty-gsc-wait" title={T.page.noDataTitle} description={T.page.noDataDescription} />
      </section>
    );
  }
  return (
    <section>
      <SectionTitle extra={link.webmasterHostUrl}>{T.page.webmaster}</SectionTitle>
      <SyncError what={T.page.webmaster} error={link.webmasterError} />
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <YandexStatCard label={T.cards.sqi} {...cards.sqi} hint={asOf} />
          <YandexStatCard label={T.cards.searchable} {...cards.searchablePages} hint={asOf} />
          <YandexStatCard label={T.cards.excluded} {...cards.excludedPages} higherIsBetter={false} hint={asOf} />
          <YandexStatCard label={T.cards.problems} {...cards.problems} higherIsBetter={false} hint={asOf} />
        </div>

        <div className="panel overflow-x-auto px-5 py-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] leading-5 font-semibold text-text-strong">{T.queries.title}</h3>
            {report.week && (
              <span className="text-[12px] text-muted-foreground">
                {T.queries.week(formatDay(report.week.from), formatDay(report.week.to, { year: true }))}
              </span>
            )}
          </div>
          {report.queries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{T.queries.none}</p>
          ) : (
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th className="py-1.5 pr-2 font-normal">{T.queries.query}</th>
                  <th className="py-1.5 text-right font-normal">{T.queries.shows}</th>
                  <th className="py-1.5 text-right font-normal">{T.queries.clicks}</th>
                  <th className="py-1.5 text-right font-normal">{T.queries.ctr}</th>
                  <th className="py-1.5 text-right font-normal">{T.queries.position}</th>
                  <th className="py-1.5 text-right font-normal">{T.queries.clickPosition}</th>
                </tr>
              </thead>
              <tbody>
                {report.queries.map((q) => (
                  <tr key={q.query} className="border-t border-border-soft">
                    <td className="max-w-[320px] truncate py-1.5 pr-2 text-text-strong" title={q.query}>
                      {q.query}
                    </td>
                    <td className="py-1.5 text-right font-data">{q.shows ?? "-"}</td>
                    <td className="py-1.5 text-right font-data">{q.clicks ?? "-"}</td>
                    <td className="py-1.5 text-right font-data">{q.ctr === null ? "-" : `${q.ctr}%`}</td>
                    <td className="py-1.5 text-right font-data">{q.avgShowPosition === null ? "-" : q.avgShowPosition.toFixed(1)}</td>
                    <td className="py-1.5 text-right font-data">{q.avgClickPosition === null ? "-" : q.avgClickPosition.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="panel px-5 py-4">
            <h3 className="mb-2 text-[14px] leading-5 font-semibold text-text-strong">{T.problems.title}</h3>
            {report.problems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{T.problems.none}</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {report.problems.map((p) => (
                  <li key={p.code} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-text-strong">{problemLabel(p.code)}</span>
                    <span
                      className={`mono-label rounded border px-1.5 text-[11px] ${
                        p.severity === "FATAL" || p.severity === "CRITICAL" ? "border-danger/30 text-danger" : "border-border text-muted-foreground"
                      }`}
                    >
                      {T.problems.severity[p.severity] ?? p.severity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel px-5 py-4">
            <h3 className="mb-2 text-[14px] leading-5 font-semibold text-text-strong">{T.problems.sitemaps}</h3>
            {report.sitemaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">-</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {report.sitemaps.map((s) => (
                  <li key={s.url} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="truncate font-data text-[12px] text-text-strong">{s.url}</span>
                    <span className="text-[12px] text-muted-foreground">{T.problems.sitemapLine(s.urlsCount, s.errorsCount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
