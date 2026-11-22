import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import type { ProjectOverview } from "@/lib/projects/overview";
import { getRankProvider } from "@/lib/rank-providers/registry";
import { cn } from "@/lib/utils";
import { YandexStatCard } from "@/components/yandex/stat-card";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { SourcesStrip } from "@/components/projects/source-cells";

/** The billing lines of the Overview's "Needs attention". */
function billingAttention(data: ProjectOverview): string[] {
  const b = data.sources?.billing;
  if (!b) return [];
  const B = M.billing.banner;
  if (b.level === "paused") return [B.paused];
  if (b.level !== "overdue") return [];
  return [
    ...(b.overdueDays > 0 ? [B.overdue(b.overdueDays, b.pauseFrom ? formatDay(b.pauseFrom, { year: true }) : null)] : []),
    ...(b.contractEnded && b.contractEnd ? [B.contractEnded(formatDay(b.contractEnd, { year: true }))] : []),
  ];
}

const T = M.overview;

const tabHref = (slug: string, tab: string) => `/projects/${slug}?tab=${tab}`;

/**
 * Agency fork: the default tab of a project. It only shows and leads on:
 * what needs attention, each site's numbers, rank tracking, open tasks and
 * the latest journal entries. Nothing here edits anything.
 */
export function OverviewSection({ slug, data }: { slug: string; data: ProjectOverview }) {
  const reviewing = data.tasks.byStatus.review ?? 0;
  const attention = [
    ...data.alerts.map((a) => ({
      key: a.id,
      text: T.alertFired(T.alertTypes[a.type] ?? a.type, a.domain, formatDay(a.lastFired, { time: true })),
      href: `/sites/${a.siteId}/alerts`,
      action: T.openAlerts,
    })),
    ...(data.tasks.overdue ? [{ key: "overdue", text: T.overdue(data.tasks.overdue), href: tabHref(slug, "tasks"), action: M.tabs.tasks }] : []),
    ...(reviewing ? [{ key: "review", text: T.review(reviewing), href: tabHref(slug, "tasks"), action: M.tabs.tasks }] : []),
    // Agency fork UX step 2: an overdue payment or paid collection paused by the billing rule.
    ...billingAttention(data).map((text, i) => ({ key: `billing-${i}`, text, href: tabHref(slug, "budget"), action: M.tabs.budget })),
  ];
  const rankSource = data.rank.source === "none" ? null : (getRankProvider(data.rank.source)?.name ?? data.rank.source);
  const frequency = (M.rank.frequencies as Record<string, string>)[data.rank.frequency] ?? data.rank.frequency;

  return (
    <div className="flex flex-col gap-5">
      {attention.length > 0 && (
        <section aria-labelledby="overview-attention" className="panel border-warning/40 p-5">
          <h2 id="overview-attention" className="mb-3 flex items-center gap-2 text-[15px] font-medium text-text-strong">
            <AlertTriangle aria-hidden className="size-4 text-warning" />
            {T.attention}
          </h2>
          <ul className="flex flex-col gap-2">
            {attention.map((a) => (
              <li key={a.key} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                <span className="text-text-strong">{a.text}</span>
                <Link href={a.href} className="text-link text-[13px] font-medium">
                  {a.action}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="overview-numbers" className="panel p-5">
        <h2 id="overview-numbers" className="text-[15px] font-medium text-text-strong">
          {T.numbersTitle}
        </h2>
        {data.sites.length === 0 ? (
          <div className="mt-2 flex flex-col items-start gap-2">
            <p className="text-[13px] text-muted-foreground">{T.noSites}</p>
            <Link href={tabHref(slug, "sites")} className="text-link text-[13px] font-medium">
              {T.addDomain}
            </Link>
          </div>
        ) : (
          <>
            {data.sites.length > 1 && <p className="mt-1 text-[13px] text-muted-foreground">{T.numbersDescription}</p>}
            <div className="mt-4 flex flex-col gap-6">
              {data.sites.map((s) => (
                <SiteNumbers key={s.id} site={s} showDomain={data.sites.length > 1} />
              ))}
            </div>
          </>
        )}
      </section>

      {data.sources && (
        <section aria-labelledby="overview-sources" className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="overview-sources" className="text-[15px] font-medium text-text-strong">
              {M.sources.dataTitle}
            </h2>
            <Link href={`/projects/sources#p-${slug}`} className="text-link text-[13px] font-medium">
              {M.sources.allSources}
            </Link>
          </div>
          <SourcesStrip row={data.sources} />
        </section>
      )}

      <section aria-labelledby="overview-rank" className="panel flex flex-wrap items-baseline justify-between gap-2 p-5">
        <h2 id="overview-rank" className="text-[15px] font-medium text-text-strong">
          {T.rankTitle}
        </h2>
        <p className={cn("text-[14px]", data.rank.enabled ? "text-text-strong" : "text-muted-foreground")}>
          {data.rank.enabled && rankSource ? T.rankOn(rankSource, frequency) : T.rankOff}
          {data.rank.enabled && (
            <span className="text-muted-foreground">
              {" · "}
              {data.rank.lastStarted ? T.rankLast(formatDay(data.rank.lastStarted, { year: true })) : T.rankNever}
            </span>
          )}
        </p>
        <Link href={tabHref(slug, "rank")} className="text-link text-[13px] font-medium">
          {T.rankSettings}
        </Link>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section aria-labelledby="overview-tasks" className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="overview-tasks" className="text-[15px] font-medium text-text-strong">
              {T.tasksTitle(data.tasks.open)}
            </h2>
            <Link href={tabHref(slug, "tasks")} className="text-link text-[13px] font-medium">
              {T.allTasks}
            </Link>
          </div>
          {data.tasks.items.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{T.noTasks}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.tasks.items.map((t) => (
                <li key={t.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                  <span className="text-[14px] text-text-strong">{t.title}</span>
                  <span className="mono-label text-[11px] text-muted-foreground">
                    {[M.labels.taskStatus[t.status as keyof typeof M.labels.taskStatus] ?? t.status, t.priority === "high" ? M.labels.priority.high : null, t.due ? T.due(formatDay(t.due, { year: true })) : null, t.assignee]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="overview-journal" className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="overview-journal" className="text-[15px] font-medium text-text-strong">
              {T.journalTitle}
            </h2>
            <Link href={tabHref(slug, "journal")} className="text-link text-[13px] font-medium">
              {T.allJournal}
            </Link>
          </div>
          {data.journal.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{T.noJournal}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.journal.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                  <span className="mono-label text-[11px] text-muted-foreground">
                    {formatDay(e.date, { year: true })} · {e.author}
                  </span>
                  <span className="line-clamp-3 text-[14px] leading-5 text-text-strong">{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SiteNumbers({ site, showDomain }: { site: ProjectOverview["sites"][number]; showDomain: boolean }) {
  const links = site.yours
    ? ([
        ["positions", T.links.positions],
        ["keywords", T.links.keywords],
        ["yandex", T.links.yandex],
        ["pages", T.links.pages],
        ["crawl", T.links.crawl],
        ["opportunities", T.links.opportunities],
      ] as const)
    : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {site.yours ? (
          <Link href={`/sites/${site.id}`} className={cn("font-medium text-text-strong hover:underline", !showDomain && "font-data text-[13px] text-muted-foreground")}>
            {site.domain}
          </Link>
        ) : (
          <span className="font-medium text-text-strong">{site.domain}</span>
        )}
      </div>
      {!site.yours ? (
        <p className="text-[13px] text-muted-foreground">{T.notYours}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="mono-label text-[11px] text-muted-foreground">{T.google}</p>
            {site.gsc ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <YandexStatCard compact label={T.gscClicks} {...site.gsc.clicks} />
                <YandexStatCard compact label={T.gscImpressions} {...site.gsc.impressions} />
                <YandexStatCard compact label={T.gscPosition} higherIsBetter={false} {...site.gsc.avgPosition} />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{T.noGsc}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="mono-label text-[11px] text-muted-foreground">{T.yandex}</p>
            {site.yandex ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <YandexStatCard compact label={YANDEX_UI.cards.visits} {...site.yandex.visits} />
                <YandexStatCard compact label={YANDEX_UI.cards.yandexSearch} {...site.yandex.searchVisits} />
                <YandexStatCard compact label={YANDEX_UI.cards.goals} {...site.yandex.goalReaches} />
                <YandexStatCard compact label={YANDEX_UI.cards.sqi} {...site.yandex.sqi} />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{T.noYandex}</p>
            )}
          </div>
          <nav aria-label={site.domain} className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {links.map(([sub, label]) => (
              <Link key={sub} href={`/sites/${site.id}/${sub}`} className="text-link inline-flex items-center gap-1 font-medium">
                {label}
                <ArrowRight aria-hidden className="size-3" />
              </Link>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
