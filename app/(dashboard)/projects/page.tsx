import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { listProjects } from "@/lib/projects/service";
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
  const projects = actor ? await listProjects(actor) : [];
  const month = monthOf(new Date());
  const [budgets, rank] =
    actor && projects.length
      ? await Promise.all([budgetSummary(actor, month), rankUsageSummary(db, month, new Set(projects.map((p) => p.id)))])
      : [null, []];
  const B = M.budget;
  // A project's line of this month, when it has a plan or spending.
  const budgetOf = new Map((budgets?.projects ?? []).filter((b) => b.plan > 0 || b.actual !== 0).map((b) => [b.slug, b]));

  const actions = (
    <>
      <Link href="/sites" className={buttonVariants({ variant: "outline" })}>
        {T.allSites}
      </Link>
      <Link href="/projects/new" className={buttonVariants()}>
        <Plus aria-hidden />
        {T.newProject}
      </Link>
    </>
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.slug}`} className="panel group flex h-full flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[17px] leading-6 font-medium text-text-strong decoration-brand-500 underline-offset-4 group-hover:underline">
                  {p.name}
                </h2>
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
    </div>
  );
}
