import type { PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { getRankProvider } from "@/lib/rank-providers/registry";
import { projectFor, rolesOf, visibleProjects, type Actor } from "./access";
import { PROJECT_MESSAGES } from "./messages";
import { providerPlans, type ProviderPlan } from "./rank";
import { money, monthOf, monthRange, percentUsed, shiftMonth } from "./rank-usage";
import { budgetEntrySchema, budgetSchema, patchBudgetEntrySchema, zodMessage } from "./schema";

/*
 * The client budget of a project (agency fork): a monthly plan by category in
 * the project's currency, and the actual spending of a month: manual entries
 * (BudgetEntry, from the dashboard or an agent) plus the automatic service
 * costs, the rank checks the project started that month (RankCheckRun) times
 * the provider's price per check. Automatic costs are counted under
 * "services" and only when the provider's currency is the project's.
 */

const M = PROJECT_MESSAGES.budget;
type Db = PrismaClient;

export const DEFAULT_CATEGORIES = ["work", "services", "ads", "content", "links", "other"];
/** Where the automatic rank check costs go. */
export const AUTO_CATEGORY = "services";
const HISTORY_MONTHS = 6;

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } }, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, zodMessage(r.error));
  return r.data;
}

const toDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = () => toDay(new Date().toISOString().slice(0, 10));
const day = (d: Date) => d.toISOString().slice(0, 10);

async function budgetRow(db: Db, projectId: string) {
  const row = await db.projectBudget.findUnique({ where: { projectId } });
  return { currency: row?.currency ?? "RUB", categories: row?.categories ?? DEFAULT_CATEGORIES };
}

type PlanLines = { defaults: Map<string, number>; months: Map<string, Map<string, number>> };

async function planLines(db: Db, projectIds: string[]): Promise<Map<string, PlanLines>> {
  const rows = await db.budgetPlanLine.findMany({ where: { projectId: { in: projectIds } } });
  const out = new Map<string, PlanLines>();
  for (const id of projectIds) out.set(id, { defaults: new Map(), months: new Map() });
  for (const r of rows) {
    const p = out.get(r.projectId)!;
    if (!r.month) p.defaults.set(r.category, Number(r.amount));
    else {
      if (!p.months.has(r.month)) p.months.set(r.month, new Map());
      p.months.get(r.month)!.set(r.category, Number(r.amount));
    }
  }
  return out;
}

/** The plan of one month by category: the month's own line, else the default. */
function planOf(lines: PlanLines, month: string): Map<string, number> {
  const out = new Map(lines.defaults);
  for (const [c, v] of lines.months.get(month) ?? []) out.set(c, v);
  return out;
}

export type AutoCost = { provider: string; name: string; checks: number; pricePerCheck: number; currency: string; amount: number; counted: boolean };

/** Rank checks started per project, provider and month in [from, to). */
async function checksByMonth(db: Db, projectIds: string[], from: string, to: string) {
  const runs = await db.rankCheckRun.findMany({
    where: { projectId: { in: projectIds }, status: { in: ["started", "partial"] }, createdAt: { gte: monthRange(from).start, lt: monthRange(to).start } },
    select: { projectId: true, provider: true, createdAt: true, estimatedChecks: true },
  });
  const out = new Map<string, Map<string, number>>(); // `${projectId}|${month}` -> provider -> checks
  for (const r of runs) {
    const key = `${r.projectId}|${monthOf(r.createdAt)}`;
    if (!out.has(key)) out.set(key, new Map());
    const m = out.get(key)!;
    m.set(r.provider, (m.get(r.provider) ?? 0) + r.estimatedChecks);
  }
  return out;
}

function autoCosts(checks: Map<string, number> | undefined, plans: Map<string, ProviderPlan>, currency: string): AutoCost[] {
  return [...(checks ?? [])].map(([provider, n]) => {
    const plan = plans.get(provider);
    const price = plan?.pricePerCheck ?? 0;
    const cur = plan?.currency ?? currency;
    return {
      provider,
      name: getRankProvider(provider)?.name ?? provider,
      checks: n,
      pricePerCheck: price,
      currency: cur,
      amount: money(n * price),
      counted: cur === currency,
    };
  });
}

/** Manual entries summed per project, month and category over [from, to). */
async function entrySums(db: Db, projectIds: string[], from: string, to: string) {
  const rows = await db.budgetEntry.findMany({
    where: { projectId: { in: projectIds }, date: { gte: monthRange(from).start, lt: monthRange(to).start } },
    select: { projectId: true, date: true, category: true, amount: true },
  });
  const out = new Map<string, Map<string, number>>(); // `${projectId}|${month}` -> category -> amount
  for (const r of rows) {
    const key = `${r.projectId}|${monthOf(r.date)}`;
    if (!out.has(key)) out.set(key, new Map());
    const m = out.get(key)!;
    m.set(r.category, money((m.get(r.category) ?? 0) + Number(r.amount)));
  }
  return out;
}

type MonthTotals = { month: string; plan: number; actual: number; percent: number | null; rows: { category: string; plan: number; actual: number; auto: number }[] };

function monthTotals(month: string, categories: string[], plan: Map<string, number>, entries: Map<string, number> | undefined, auto: AutoCost[]): MonthTotals {
  const autoSum = money(auto.filter((a) => a.counted).reduce((s, a) => s + a.amount, 0));
  const cats = [...new Set([...categories, ...plan.keys(), ...(entries?.keys() ?? []), ...(autoSum ? [AUTO_CATEGORY] : [])])];
  const rows = cats.map((category) => {
    const a = category === AUTO_CATEGORY ? autoSum : 0;
    return { category, plan: plan.get(category) ?? 0, actual: money((entries?.get(category) ?? 0) + a), auto: a };
  });
  const p = money(rows.reduce((s, r) => s + r.plan, 0));
  const act = money(rows.reduce((s, r) => s + r.actual, 0));
  return { month, plan: p, actual: act, percent: percentUsed(p, act), rows };
}

/** The Budget tab and GET .../budget: settings, plan, the month's entries, automatic costs, plan vs actual and 6 months of history. */
export async function getBudget(actor: Actor, slug: string, month = monthOf(new Date())) {
  const ref = await projectFor(actor, slug);
  const db = appDb;
  const { currency, categories } = await budgetRow(db, ref.id);
  const lines = (await planLines(db, [ref.id])).get(ref.id)!;
  const first = shiftMonth(month, HISTORY_MONTHS - 1);
  const next = shiftMonth(month, -1);
  const [sums, checks, plans] = await Promise.all([entrySums(db, [ref.id], first, next), checksByMonth(db, [ref.id], first, next), providerPlans(db)]);
  const { start, end } = monthRange(month);
  const entries = await db.budgetEntry.findMany({
    where: { projectId: ref.id, date: { gte: start, lt: end } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  const history: MonthTotals[] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const m = shiftMonth(month, i);
    history.push(monthTotals(m, categories, planOf(lines, m), sums.get(`${ref.id}|${m}`), autoCosts(checks.get(`${ref.id}|${m}`), plans, currency)));
  }
  const auto = autoCosts(checks.get(`${ref.id}|${month}`), plans, currency);
  return {
    role: ref.role,
    month,
    currency,
    categories,
    plan: {
      defaults: Object.fromEntries(lines.defaults),
      month: Object.fromEntries(lines.months.get(month) ?? []),
    },
    entries: entries.map((e) => ({
      id: e.id,
      date: day(e.date),
      category: e.category,
      amount: Number(e.amount),
      note: e.note,
      externalKey: e.externalKey,
      author: e.author,
      authorKind: e.authorKind,
    })),
    autoCosts: auto,
    summary: history[history.length - 1],
    history,
  };
}

export type BudgetView = Awaited<ReturnType<typeof getBudget>>;

/** Currency, categories and plan lines. */
export async function updateBudget(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(budgetSchema, body);
  const db = appDb;
  const current = await budgetRow(db, ref.id);
  const categories = input.categories ? [...new Set(input.categories)] : current.categories;
  await db.$transaction(async (tx) => {
    if (input.currency || input.categories) {
      await tx.projectBudget.upsert({
        where: { projectId: ref.id },
        create: { projectId: ref.id, currency: input.currency ?? current.currency, categories },
        update: { ...(input.currency && { currency: input.currency }), ...(input.categories && { categories }) },
      });
    }
    if (input.plan) {
      const month = input.plan.month ?? "";
      for (const [raw, amount] of Object.entries(input.plan.lines)) {
        const category = raw.trim().toLowerCase();
        if (amount !== null && !categories.includes(category)) {
          throw new ApiError(400, M.errors.unknownCategory(category, categories.join(", ")));
        }
        const where = { projectId_month_category: { projectId: ref.id, month, category } };
        if (amount === null) await tx.budgetPlanLine.deleteMany({ where: { projectId: ref.id, month, category } });
        else await tx.budgetPlanLine.upsert({ where, create: { projectId: ref.id, month, category, amount }, update: { amount } });
      }
    }
  });
  return getBudget(actor, slug, input.plan?.month ?? undefined);
}

function entryView(e: { id: string; date: Date; category: string; amount: unknown; note: string | null; externalKey: string | null; author: string; authorKind: string }) {
  return { id: e.id, date: day(e.date), category: e.category, amount: Number(e.amount), note: e.note, externalKey: e.externalKey, author: e.author, authorKind: e.authorKind };
}

/** Adds a spending entry; with externalKey, the same key again updates that entry (`created: false`). */
export async function addBudgetEntry(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(budgetEntrySchema, body);
  const { categories } = await budgetRow(appDb, ref.id);
  if (!categories.includes(input.category)) throw new ApiError(400, M.errors.unknownCategory(input.category, categories.join(", ")));
  const data = {
    date: input.date ? toDay(input.date) : today(),
    category: input.category,
    amount: input.amount,
    note: input.note,
  };
  if (input.externalKey) {
    const existing = await appDb.budgetEntry.findUnique({ where: { projectId_externalKey: { projectId: ref.id, externalKey: input.externalKey } } });
    if (existing) {
      const e = await appDb.budgetEntry.update({ where: { id: existing.id }, data });
      return { entry: entryView(e), created: false };
    }
  }
  const e = await appDb.budgetEntry.create({
    data: { projectId: ref.id, ...data, externalKey: input.externalKey ?? null, author: actor.label, authorKind: actor.kind },
  });
  return { entry: entryView(e), created: true };
}

async function ownEntry(projectId: string, id: string) {
  const e = await appDb.budgetEntry.findFirst({ where: { id, projectId } });
  if (!e) throw new ApiError(404, M.errors.entryNotFound);
  return e;
}

export async function patchBudgetEntry(actor: Actor, slug: string, id: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(patchBudgetEntrySchema, body);
  await ownEntry(ref.id, id);
  if (input.category) {
    const { categories } = await budgetRow(appDb, ref.id);
    if (!categories.includes(input.category)) throw new ApiError(400, M.errors.unknownCategory(input.category, categories.join(", ")));
  }
  const e = await appDb.budgetEntry.update({
    where: { id },
    data: {
      ...(input.date && { date: toDay(input.date) }),
      ...(input.category && { category: input.category }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.note !== undefined && { note: input.note }),
    },
  });
  return { entry: entryView(e) };
}

export async function deleteBudgetEntry(actor: Actor, slug: string, id: string) {
  const ref = await projectFor(actor, slug, "editor");
  await ownEntry(ref.id, id);
  await appDb.budgetEntry.delete({ where: { id } });
  return { deleted: true };
}

export type BudgetSummaryRow = { slug: string; name: string; currency: string; plan: number; actual: number; percent: number | null };

/** This month (or the given one) of every project the actor sees: plan, actual, % used, and totals per currency. */
export async function budgetSummary(actor: Actor, month = monthOf(new Date())) {
  const db = appDb;
  const projects = await db.project.findMany({ where: visibleProjects(actor), select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });
  const ids = projects.map((p) => p.id);
  const roles = await rolesOf(actor, ids);
  const next = shiftMonth(month, -1);
  const [budgets, lines, sums, checks, plans] = await Promise.all([
    db.projectBudget.findMany({ where: { projectId: { in: ids } } }),
    planLines(db, ids),
    entrySums(db, ids, month, next),
    checksByMonth(db, ids, month, next),
    providerPlans(db),
  ]);
  const rows: BudgetSummaryRow[] = projects
    .filter((p) => roles.has(p.id))
    .map((p) => {
      const b = budgets.find((x) => x.projectId === p.id);
      const currency = b?.currency ?? "RUB";
      const t = monthTotals(
        month,
        b?.categories ?? DEFAULT_CATEGORIES,
        planOf(lines.get(p.id)!, month),
        sums.get(`${p.id}|${month}`),
        autoCosts(checks.get(`${p.id}|${month}`), plans, currency)
      );
      return { slug: p.slug, name: p.name, currency, plan: t.plan, actual: t.actual, percent: t.percent };
    });
  const totals = new Map<string, { plan: number; actual: number }>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { plan: 0, actual: 0 };
    totals.set(r.currency, { plan: money(t.plan + r.plan), actual: money(t.actual + r.actual) });
  }
  return {
    month,
    projects: rows,
    totals: [...totals].map(([currency, t]) => ({ currency, ...t, percent: percentUsed(t.plan, t.actual) })),
  };
}
