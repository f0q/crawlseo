import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { listProjects } from "@/lib/projects/service";
import { groupProjects, type NavSite } from "@/lib/projects/navigation";
import { loadProjectNav } from "@/lib/projects/shell";
import { budgetSummary } from "@/lib/projects/budget";
import { rankUsageSummary } from "@/lib/projects/rank";
import { formatMoney, monthOf } from "@/lib/projects/rank-usage";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/projects/ui";
import { PlanBar } from "@/components/projects/budget-section";

const T = M.list;

/** Agency fork: the home after sign-in, every client project the user is a member of. */
export default async function ProjectsPage() {
  const session = await auth();
  const actor = sessionActor(session?.user);
  const [projects, nav] = actor ? await Promise.all([listProjects(actor), loadProjectNav(actor)]) : [[], null];
  // Sites of the user that are in none of their projects: listed below, never hidden.
  const unassigned = nav?.unassigned ?? [];
  const month = monthOf(new Date());
  const [budgets, rank] =
    actor && projects.length
      ? await Promise.all([budgetSummary(actor, month), rankUsageSummary(db, month, new Set(projects.map((p) => p.id)))])
      : [null, []];
  const B = M.budget;
  // A project's line of this month, when it has a plan or spending.
  const groups = groupProjects(projects);
  const budgetOf = new Map((budgets?.projects ?? []).filter((b) => b.plan > 0 || b.actual !== 0).map((b) => [b.slug, b]));

  const actions = (
    <Link href="/projects/new" className={buttonVariants()}>
      <Plus aria-hidden />
      {T.newProject}
    </Link>
  );

  if (projects.length === 0) {
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

  return (
    <div>
      <PageHeader title={T.title} meta={T.meta(projects.length)} actions={actions} />
      {budgets && (
        <section aria-labelledby="budget-summary" className="panel mb-5 p-5">
          <h2 id="budget-summary" className="mb-3 text-[15px] font-medium text-text-strong">
            {B.summaryTitle} <span className="font-data text-[12px] text-muted-foreground">{month}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              {budgets.totals.map((t) => (
                <div key={t.currency} className="flex flex-col gap-1">
                  <p className="text-[14px] text-text-strong">{B.summaryLine(formatMoney(t.plan), formatMoney(t.actual), t.currency, t.percent)}</p>
                  <PlanBar plan={t.plan} actual={t.actual} max={Math.max(t.plan, t.actual, 1)} label={`${t.currency}: ${t.actual} / ${t.plan}`} />
                </div>
              ))}
              <p className="text-[12px] text-muted-foreground">{B.summaryProjects(budgets.projects.filter((p) => p.plan > 0).length)}</p>
            </div>
            <div className="flex flex-col gap-1 text-[13px]">
              {rank.map((r) => (
                <p key={r.plan.provider} className={r.limit.over ? "text-danger" : "text-muted-foreground"}>
                  {M.rank.providerLine(r.plan.name, r.planned, r.used, r.plan.monthlyLimit)}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
      {groups.map((g) => (
      <section key={g.name ?? ""} aria-label={g.name ?? T.ungrouped} className="mb-8">
      {(groups.length > 1 || g.name) && <h2 className="mb-3 text-[15px] font-medium text-text-strong">{g.name ?? T.ungrouped}</h2>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {g.projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.slug}`} className="panel group flex h-full flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[17px] leading-6 font-medium text-text-strong decoration-brand-500 underline-offset-4 group-hover:underline">
                  {p.name}
                </h3>
                <p className="mt-0.5 truncate font-data text-[12px] text-muted-foreground">
                  {p.sites.length ? p.sites.map((s) => s.domain).join(", ") : T.noSites}
                </p>
              </div>
              <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-text-strong" />
            </div>
            {budgetOf.get(p.slug) && (
              <p className="font-data text-[12px] text-muted-foreground">
                {B.summaryLine(formatMoney(budgetOf.get(p.slug)!.plan), formatMoney(budgetOf.get(p.slug)!.actual), budgetOf.get(p.slug)!.currency, budgetOf.get(p.slug)!.percent)}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} />
              <span className="mono-label text-[11px] text-muted-foreground">{T.role((M.labels.role as Record<string, string>)[p.role] ?? p.role)}</span>
              <span className={cn("mono-label text-[11px]", p.openTasks ? "text-text-strong" : "text-muted-foreground")}>{T.openTasks(p.openTasks)}</span>
            </div>
            <p className="mt-auto line-clamp-2 border-t border-border pt-3 text-[13px] leading-5 text-muted-foreground">
              {p.lastJournal ? `${formatDay(p.lastJournal.date, { year: true })}: ${p.lastJournal.text}` : T.noJournal}
            </p>
          </Link>
        ))}
      </div>
      </section>
      ))}
      <UnassignedSites sites={unassigned} />
    </div>
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
