import { db as appDb } from "@/lib/db";
import type { Actor } from "./access";
import { budgetSummary } from "./budget";
import { isStoppedStatus } from "./collection";
import { groupProjects } from "./navigation";
import { ACTIVE_ALERT_DAYS, isServiceEntry } from "./overview";
import { rankUsageSummary } from "./rank";
import { monthOf } from "./rank-usage";
import { listProjects, type ProjectSummary } from "./service";
import { SOURCE_IDS, sourcesMatrix, type SourceProjectRow, type SourceTotals } from "./sources";

/*
 * The projects home (agency fork, UX step 2): a table of exceptions. Who
 * needs attention and why, then the rest by group, the prospects, the paused
 * and archived. Read from the sources matrix (./sources.ts), alerts, the
 * billing state, tasks and the journal; nothing is changed.
 *
 * A project needs attention (unless it is paused or archived) when a source
 * fails or is stale, an alert of one of the viewer's own sites fired within
 * ACTIVE_ALERT_DAYS, the payment is overdue or paid collection is paused by
 * the billing rule.
 */

/** Journal entries read per project to find the latest one that is not an agent sync line. */
const JOURNAL_LOOKBACK = 30;

export type HomeReason =
  | { kind: "error" | "stale" | "alert"; count: number }
  | { kind: "overdue"; days: number }
  | { kind: "contract-ended" | "paused" };

export type HomeRow = {
  project: ProjectSummary;
  sources: SourceProjectRow;
  reasons: HomeReason[];
  /** Open tasks in review. */
  review: number;
  /** The latest journal entry that is not an agent sync line. */
  lastEntry: { date: string; text: string } | null;
};

export type HomeGroup = { key: string; name: string | null; kind: "attention" | "group" | "prospects" | "stopped"; rows: HomeRow[] };

export type ProjectsHome = {
  groups: HomeGroup[];
  totals: SourceTotals;
  summary: {
    month: string;
    budgets: { currency: string; plan: number; actual: number }[];
    checks: { name: string; used: number; limit: number }[];
    overdue: number;
  };
  count: number;
};

/** Why a project needs attention; empty when it does not. */
export function attentionReasons(row: { status: string; sources: SourceProjectRow; alerts: number }): HomeReason[] {
  if (isStoppedStatus(row.status)) return [];
  const out: HomeReason[] = [];
  const errors = SOURCE_IDS.filter((id) => row.sources.cells[id].state === "error").length;
  const stale = SOURCE_IDS.filter((id) => row.sources.cells[id].state === "stale").length;
  if (errors) out.push({ kind: "error", count: errors });
  if (stale) out.push({ kind: "stale", count: stale });
  if (row.alerts) out.push({ kind: "alert", count: row.alerts });
  const b = row.sources.billing;
  if (b.level === "paused") out.push({ kind: "paused" });
  else if (b.level === "overdue") {
    if (b.overdueDays > 0) out.push({ kind: "overdue", days: b.overdueDays });
    if (b.contractEnded) out.push({ kind: "contract-ended" });
  }
  return out;
}

export async function projectsHome(actor: Actor, now = new Date()): Promise<ProjectsHome> {
  const db = appDb;
  const projects = await listProjects(actor);
  const month = monthOf(now);
  if (projects.length === 0) {
    return { groups: [], totals: sourcesMatrixTotalsEmpty(), summary: { month, budgets: [], checks: [], overdue: 0 }, count: 0 };
  }
  const ids = projects.map((p) => p.id);
  const since = new Date(now.getTime() - ACTIVE_ALERT_DAYS * 86_400_000);
  const [matrix, alerts, review, journals, budgets, rank] = await Promise.all([
    sourcesMatrix(actor, { now }),
    db.alert.findMany({
      where: { enabled: true, lastFired: { gte: since }, site: { projectId: { in: ids }, userId: actor.userId } },
      select: { site: { select: { projectId: true } } },
    }),
    db.projectTask.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: "review" }, _count: { _all: true } }),
    Promise.all(
      ids.map((id) =>
        db.journalEntry.findMany({
          where: { projectId: id },
          select: { date: true, text: true },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: JOURNAL_LOOKBACK,
        })
      )
    ),
    budgetSummary(actor, month),
    rankUsageSummary(db, month, new Set(ids)),
  ]);

  const alertsBy = new Map<string, number>();
  for (const a of alerts) if (a.site.projectId) alertsBy.set(a.site.projectId, (alertsBy.get(a.site.projectId) ?? 0) + 1);
  const reviewBy = new Map(review.map((r) => [r.projectId, r._count._all]));
  const sourcesBy = new Map(matrix.projects.map((p) => [p.id, p]));

  const rows: HomeRow[] = projects.flatMap((p, i) => {
    const sources = sourcesBy.get(p.id);
    if (!sources) return [];
    const entry = journals[i].find((e) => !isServiceEntry(e.text));
    return [
      {
        project: p,
        sources,
        reasons: attentionReasons({ status: p.status, sources, alerts: alertsBy.get(p.id) ?? 0 }),
        review: reviewBy.get(p.id) ?? 0,
        lastEntry: entry ? { date: entry.date.toISOString().slice(0, 10), text: entry.text } : null,
      },
    ];
  });

  const attention = rows.filter((r) => r.reasons.length > 0);
  const rest = rows.filter((r) => r.reasons.length === 0);
  const stopped = rest.filter((r) => isStoppedStatus(r.project.status));
  const prospects = rest.filter((r) => r.project.status === "prospect");
  const active = rest.filter((r) => !isStoppedStatus(r.project.status) && r.project.status !== "prospect");

  const groups: HomeGroup[] = [];
  if (attention.length) groups.push({ key: "attention", name: null, kind: "attention", rows: attention });
  for (const g of groupProjects(active.map((r) => ({ ...r, name: r.project.name, status: r.project.status, group: r.project.group })))) {
    groups.push({ key: `group:${g.name ?? ""}`, name: g.name, kind: "group", rows: g.projects });
  }
  if (prospects.length) groups.push({ key: "prospects", name: null, kind: "prospects", rows: prospects });
  if (stopped.length) groups.push({ key: "stopped", name: null, kind: "stopped", rows: stopped });

  return {
    groups,
    totals: matrix.totals,
    summary: {
      month,
      budgets: budgets.totals.filter((t) => t.plan > 0 || t.actual !== 0).map((t) => ({ currency: t.currency, plan: t.plan, actual: t.actual })),
      checks: rank.filter((r) => r.used > 0 || r.planned > 0).map((r) => ({ name: r.plan.name, used: r.used, limit: r.plan.monthlyLimit })),
      overdue: matrix.projects.filter((p) => p.billing.level === "overdue" || p.billing.level === "paused").length,
    },
    count: projects.length,
  };
}

function sourcesMatrixTotalsEmpty(): SourceTotals {
  return { bySource: {} as SourceTotals["bySource"], ok: 0, stale: 0, errors: 0, paidActive: 0 };
}
