import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { loadProjectNav } from "@/lib/projects/shell";
import { projectsHome, type HomeReason, type HomeRow } from "@/lib/projects/home";
import type { NavSite } from "@/lib/projects/navigation";
import { formatMoney } from "@/lib/projects/rank-usage";
import { SourceDots } from "@/components/projects/source-cells";
import { getDisplayTimeZone } from "@/lib/timezone-server";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/projects/ui";
import { GroupTitle } from "@/components/projects/group-actions";
import { atLeast } from "@/lib/projects/access";
import { listGroupSummaries } from "@/lib/projects/groups";
import { sameGroup } from "@/lib/projects/group-names";

const T = M.list;
const H = M.home;

/**
 * Agency fork: the home after sign-in (UX step 2). A table of exceptions:
 * the projects that need attention and why, then the rest by group, the
 * prospects, the paused and archived, and the user's sites outside every
 * project (lib/projects/home.ts).
 */
export default async function ProjectsPage() {
  const session = await auth();
  const actor = sessionActor(session?.user);
  const [home, nav, groupSummaries] = actor
    ? await Promise.all([projectsHome(actor), loadProjectNav(actor), listGroupSummaries(actor)])
    : [null, null, []];
  const timeZone = await getDisplayTimeZone();
  // Sites of the user that are in none of their projects: listed below, never hidden.
  const unassigned = nav?.unassigned ?? [];

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link href="/projects/new" className={buttonVariants()}>
        <Plus aria-hidden />
        {T.newProject}
      </Link>
    </div>
  );

  if (!home || home.count === 0) {
    return (
      <div>
        <PageHeader title={T.title} description={T.description} actions={actions} />
        <EmptyState
          illustration="empty-sites"
          title={T.emptyTitle}
          description={T.emptyDescription}
          actionLabel={T.newProject}
          actionHref="/projects/new"
        />
        <UnassignedSites sites={unassigned} />
      </div>
    );
  }

  const s = home.summary;
  const summary = [
    ...s.budgets.map((b) => H.summary.spent(formatMoney(b.actual), formatMoney(b.plan), b.currency)),
    ...s.checks.map((c) => H.summary.checks(c.name, c.used, c.limit)),
    ...(s.overdue ? [H.summary.overdue(s.overdue)] : []),
  ];

  return (
    <div>
      <PageHeader title={T.title} meta={T.meta(home.count)} actions={actions} />
      {home.attentionCount > 0 && (
        <p className="mb-2 flex items-center gap-2 text-[13px] text-warning">
          <AlertTriangle aria-hidden className="size-4" />
          {H.attentionCount(home.attentionCount)}
        </p>
      )}
      {summary.length > 0 && (
        <p className="mb-5 text-[13px] text-muted-foreground">
          <span className="font-data">{s.month}</span>: {summary.join(" · ")}
        </p>
      )}
      {home.groups.map((g) => {
        const title = g.kind === "attention" ? H.attention : g.kind === "prospects" ? H.prospects : g.kind === "stopped" ? H.stopped : (g.name ? T.groupLabel(g.name) : T.ungrouped);
        const showTitle = g.kind !== "group" || g.name !== null;
        const table = <HomeTable rows={g.rows} attention={g.kind === "attention"} timeZone={timeZone} />;
        if (g.kind === "stopped") {
          return (
            <details key={g.key} className="mb-6">
              <summary className="mb-3 cursor-pointer text-[15px] font-medium text-text-strong">
                {title} <span className="font-data text-[12px] text-muted-foreground">{g.rows.length}</span>
              </summary>
              {table}
            </details>
          );
        }
        // Agency fork: a named group's heading has Rename and Ungroup for its owners and editors.
        if (g.kind === "group" && g.name) {
          // Prospects, paused and attention rows of the group are listed elsewhere; the actions cover the whole group.
          const summary = groupSummaries.find((x) => sameGroup(x.name, g.name));
          return (
            <section key={g.key} aria-label={title} className="mb-6">
              <GroupTitle
                name={g.name}
                shown={g.rows.length}
                count={summary?.count ?? g.rows.length}
                editable={summary?.editable ?? g.rows.filter((r) => atLeast(r.project.role, "editor")).length}
                variant="menu"
                className="mb-3"
              />
              {table}
            </section>
          );
        }
        return (
          <section key={g.key} aria-label={title} className="mb-6">
            {showTitle && (
              <h2 className={cn("mb-3 flex items-center gap-2 text-[15px] font-medium", g.kind === "attention" ? "text-warning" : "text-text-strong")}>
                {g.kind === "attention" && <AlertTriangle aria-hidden className="size-4" />}
                {title} <span className="font-data text-[12px] text-muted-foreground">{g.rows.length}</span>
              </h2>
            )}
            {table}
          </section>
        );
      })}
      <UnassignedSites sites={unassigned} />
    </div>
  );
}

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2.2fr)_96px_170px_120px_110px_minmax(0,2fr)] md:items-start md:gap-4";

function reasonText(r: HomeReason): string {
  if (r.kind === "error") return H.reasons.error(r.count);
  if (r.kind === "stale") return H.reasons.stale(r.count);
  if (r.kind === "alert") return H.reasons.alert(r.count);
  if (r.kind === "overdue") return H.reasons.overdue(r.days);
  if (r.kind === "contract-ended") return H.reasons.contractEnded;
  return H.reasons.paused;
}

/** One group as a table on wide screens; on a phone each row is a card with only what is not in order. */
function HomeTable({ rows, attention, timeZone }: { rows: HomeRow[]; attention: boolean; timeZone: string }) {
  return (
    <div className="panel divide-y divide-border">
      <div aria-hidden className={cn("mono-label hidden px-4 py-2 text-[11px] text-muted-foreground", ROW_GRID)}>
        <span>{H.project}</span>
        <span>{H.status}</span>
        <span>{H.data}</span>
        <span>{H.paidUntil}</span>
        <span>{H.tasks}</span>
        <span>{H.lastEntry}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <HomeRowView key={r.project.id} row={r} attention={attention} timeZone={timeZone} />
        ))}
      </ul>
    </div>
  );
}

function HomeRowView({ row, attention, timeZone }: { row: HomeRow; attention: boolean; timeZone: string }) {
  const p = row.project;
  const b = row.sources.billing;
  const late = b.level === "overdue" || b.level === "paused";
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3 text-[13px]", ROW_GRID)}>
      <div className="min-w-0">
        <span className="flex items-center gap-1.5">
          {row.reasons.length > 0 && <AlertTriangle aria-label={H.attention} className="size-4 shrink-0 text-warning" />}
          <Link href={`/projects/${p.slug}`} className="text-[15px] leading-6 font-medium text-text-strong decoration-brand-500 underline-offset-4 hover:underline">
            {p.name}
          </Link>
        </span>
        <p className="truncate font-data text-[12px] text-muted-foreground">{p.sites.length ? p.sites.map((x) => x.domain).join(", ") : T.noSites}</p>
        {row.reasons.length > 0 && <p className="mt-0.5 text-[12px] text-warning">{row.reasons.map(reasonText).join(" · ")}</p>}
      </div>
      <div>
        <StatusBadge status={p.status} />
      </div>
      <div className={cn(!(attention || row.reasons.length > 0) && "hidden md:block")}>
        <SourceDots row={row.sources} timeZone={timeZone} />
      </div>
      <div className={cn("font-data text-[12px]", late ? "text-warning" : "text-muted-foreground", !b.tracked && "hidden md:block")}>
        <span className="md:hidden">{H.paidUntil}: </span>
        {b.paidUntil ? formatDay(b.paidUntil, { year: true }) : H.noPaid}
        {b.overdueDays > 0 && <span className="block">{H.reasons.overdue(b.overdueDays)}</span>}
      </div>
      <div className={cn("text-[12px]", p.openTasks ? "text-text-strong" : "hidden text-muted-foreground md:block")}>
        <span className="md:hidden">{H.tasks}: </span>
        {H.openTasks(p.openTasks, row.review)}
      </div>
      <div className="hidden md:block">
        {/* line-clamp needs display:-webkit-box, so md:block lives on the wrapper */}
        <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground" title={row.lastEntry?.text}>
          {row.lastEntry ? `${formatDay(row.lastEntry.date, { year: true })}: ${row.lastEntry.text}` : T.noJournal}
        </p>
      </div>
    </li>
  );
}

/** Agency fork: the user's sites in none of their projects, with the one remaining link to All sites. */
function UnassignedSites({ sites }: { sites: NavSite[] }) {
  if (sites.length === 0) return null;
  return (
    <section id="unassigned" aria-labelledby="unassigned-title" className="panel mt-2 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="unassigned-title" className="text-[15px] font-medium text-text-strong">
          {T.unassignedTitle} <span className="font-data text-[12px] text-muted-foreground">{sites.length}</span>
        </h2>
        <Link href="/sites" className="text-link text-[13px] font-medium">
          {T.allSitesLink}
        </Link>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">{T.unassignedDescription}</p>
      <ul className="flex flex-wrap gap-2">
        {sites.map((s) => (
          <li key={s.id}>
            <Link href={`/sites/${s.id}`} className="inline-flex h-8 items-center rounded-md border border-border px-3 font-data text-[13px] text-text-strong hover:border-line-strong">
              {s.domain}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
