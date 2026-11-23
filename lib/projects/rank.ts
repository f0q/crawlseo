import type { Prisma, PrismaClient } from "@prisma/client";
import { db as appDb } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { ApiError } from "@/lib/api-v1/params";
import { getRankProvider, listRankProviders } from "@/lib/rank-providers/registry";
import type { RankCabinetLogin, RankCheckTarget, RankProvider, RankProviderClientOptions } from "@/lib/rank-providers/types";
import { isInstanceAdmin, projectFor, type Actor } from "./access";
import { paidCollectionGuard } from "./collection";
import { PROJECT_MESSAGES } from "./messages";
import {
  checksPerMonth,
  checksPerRun,
  limitState,
  monthOf,
  monthRange,
  NO_SOURCE,
  pricePerCheck,
  RUNS_PER_MONTH,
  type LimitState,
  type RankFrequency,
} from "./rank-usage";
import { providerPlanSchema, rankSettingsSchema, zodMessage } from "./schema";

/*
 * Rank check settings of a project (agency fork): whether crawlseo starts
 * position checks for it, with which provider, how often and in which of the
 * engines linked to its sites; the usage log (RankCheckRun) of every start;
 * and the monthly limit and price of each provider account (RankProviderPlan).
 *
 * Safety: a project without settings, or with `enabled` false, is never
 * started, by the schedule or by hand. A save that would take the planned
 * checks of all projects over the provider's monthly limit is refused unless
 * the caller overrides it; a scheduled run that would go over the limit is
 * skipped and logged.
 */

const M = PROJECT_MESSAGES.rank;
type Db = PrismaClient;
type Env = Record<string, string | undefined>;

const SUCCESS = ["started", "partial"];
/** A skipped or failed scheduled run is tried again after a day, not every pass. */
const RETRY_MS = 24 * 60 * 60_000;
/** Like the site schedules: a run that drifts a little earlier does not wait a whole interval. */
const SLACK_MS = 2 * 60 * 60_000;
/** Projects started per scheduling pass; the rest wait for the next pass (10 minutes). */
export const RANK_CHECKS_PER_PASS = 3;

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } }, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, zodMessage(r.error));
  return r.data;
}

// ============ PROVIDER PLANS ============

export type ProviderPlan = {
  provider: string;
  name: string;
  monthlyLimit: number;
  planName: string;
  planPrice: number;
  planChecks: number;
  currency: string;
  pricePerCheck: number;
  /** Saved in Settings; false: the defaults (provider billing and RANK_CHECK_* variables). */
  custom: boolean;
};

const envKey = (provider: string) => provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The provider's default plan, with RANK_CHECK_LIMIT_<ID> and RANK_CHECK_PRICE_<ID> ("360/5000") over it. */
export function defaultPlan(provider: RankProvider, env: Env = process.env): ProviderPlan {
  const b = provider.billing ?? { planName: "", planPrice: 0, planChecks: 1, currency: "RUB", monthlyLimit: 0 };
  const limitRaw = env[`RANK_CHECK_LIMIT_${envKey(provider.id)}`]?.trim();
  const priceRaw = env[`RANK_CHECK_PRICE_${envKey(provider.id)}`]?.trim();
  const monthlyLimit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : b.monthlyLimit;
  const price = priceRaw ? /^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/.exec(priceRaw) : null;
  const planPrice = price ? Number(price[1]) : b.planPrice;
  const planChecks = price ? Math.max(1, Number(price[2])) : b.planChecks;
  return {
    provider: provider.id,
    name: provider.name,
    monthlyLimit,
    planName: b.planName,
    planPrice,
    planChecks,
    currency: b.currency,
    pricePerCheck: pricePerCheck({ planPrice, planChecks }),
    custom: false,
  };
}

export async function providerPlans(db: Db = appDb): Promise<Map<string, ProviderPlan>> {
  const rows = await db.rankProviderPlan.findMany();
  const out = new Map<string, ProviderPlan>();
  for (const p of listRankProviders()) {
    const row = rows.find((r) => r.provider === p.id);
    if (!row) {
      out.set(p.id, defaultPlan(p));
      continue;
    }
    const planPrice = Number(row.planPrice);
    out.set(p.id, {
      provider: p.id,
      name: p.name,
      monthlyLimit: row.monthlyLimit,
      planName: row.planName,
      planPrice,
      planChecks: row.planChecks,
      currency: row.currency,
      pricePerCheck: pricePerCheck({ planPrice, planChecks: row.planChecks }),
      custom: true,
    });
  }
  return out;
}

/** Who may change the limits and prices: instance admins; anyone signed in when none are configured. */
export function canEditPlans(actor: Actor): boolean {
  const configured = (process.env.CRAWLSEO_ADMIN_EMAILS ?? "").split(",").some((e) => e.trim());
  return configured ? isInstanceAdmin(actor.email) : actor.kind === "human";
}

export async function updateProviderPlan(actor: Actor, body: unknown): Promise<ProviderPlan> {
  if (!canEditPlans(actor)) throw new ApiError(403, M.errors.planForbidden);
  const input = parse(providerPlanSchema, body);
  if (!getRankProvider(input.provider)) throw new ApiError(400, M.errors.unknownProvider);
  const { provider, ...data } = input;
  await appDb.rankProviderPlan.upsert({
    where: { provider },
    create: { provider, ...data, updatedBy: actor.label },
    update: { ...data, updatedBy: actor.label },
  });
  return (await providerPlans()).get(provider)!;
}

// ============ ENGINES AND USAGE ============

/** Keywords on the latest check of each engine; null when it has none yet. */
export async function engineKeywordCounts(db: Db, engineIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(engineIds.map((id) => [id, null]));
  if (engineIds.length === 0) return out;
  const latest = await db.externalRank.groupBy({ by: ["engineId"], where: { engineId: { in: engineIds } }, _max: { date: true } });
  await Promise.all(
    latest.map(async (l) => {
      if (!l._max.date) return;
      out.set(l.engineId, await db.externalRank.count({ where: { engineId: l.engineId, date: l._max.date } }));
    })
  );
  return out;
}

const sumKeywords = (ids: string[], counts: Map<string, number | null>) => checksPerRun(ids.map((id) => ({ keywords: counts.get(id) ?? 0 })));

type PlannedProject = { projectId: string; slug: string; name: string; frequency: string; perRun: number; perMonth: number };

/**
 * What every enabled project of a provider plans a month, with its engines
 * as they are now (an engine moved out of the project no longer counts).
 */
export async function plannedUsage(db: Db, providerId: string): Promise<PlannedProject[]> {
  const settings = await db.projectRankSettings.findMany({
    where: { enabled: true, source: providerId, frequency: { not: "manual" } },
    select: { projectId: true, frequency: true, engineIds: true, project: { select: { slug: true, name: true } } },
  });
  const ids = [...new Set(settings.flatMap((s) => s.engineIds))];
  const engines = ids.length
    ? await db.externalRankEngine.findMany({ where: { id: { in: ids }, source: providerId }, select: { id: true, site: { select: { projectId: true } } } })
    : [];
  const counts = await engineKeywordCounts(db, engines.map((e) => e.id));
  return settings.map((s) => {
    const valid = s.engineIds.filter((id) => engines.some((e) => e.id === id && e.site.projectId === s.projectId));
    const perRun = sumKeywords(valid, counts);
    return {
      projectId: s.projectId,
      slug: s.project.slug,
      name: s.project.name,
      frequency: s.frequency,
      perRun,
      perMonth: checksPerMonth(perRun, s.frequency as RankFrequency),
    };
  });
}

/** Checks started in a month: of one provider, optionally of one project. */
export async function usedInMonth(db: Db, where: { provider?: string; projectId?: string }, month: string): Promise<number> {
  const { start, end } = monthRange(month);
  const r = await db.rankCheckRun.aggregate({
    where: { ...where, status: { in: SUCCESS }, createdAt: { gte: start, lt: end } },
    _sum: { estimatedChecks: true },
  });
  return r._sum.estimatedChecks ?? 0;
}

export type ProviderUsage = {
  plan: ProviderPlan;
  canStart: boolean;
  /** Planned checks a month of every enabled project. */
  planned: number;
  /** Checks started this month. */
  used: number;
  cost: number;
  limit: LimitState;
  /** The visible projects' share; the rest is summed as `otherPlanned`. */
  projects: PlannedProject[];
  otherPlanned: number;
};

/** Every provider: planned and used checks across all projects against its monthly limit. */
export async function rankUsageSummary(db: Db, month: string, visible?: Set<string>): Promise<ProviderUsage[]> {
  const plans = await providerPlans(db);
  const out: ProviderUsage[] = [];
  for (const p of listRankProviders()) {
    const plan = plans.get(p.id)!;
    const projects = await plannedUsage(db, p.id);
    const planned = projects.reduce((s, x) => s + x.perMonth, 0);
    const used = await usedInMonth(db, { provider: p.id }, month);
    const mine = visible ? projects.filter((x) => visible.has(x.projectId)) : projects;
    out.push({
      plan,
      canStart: Boolean(p.startCheck && p.cabinet),
      planned,
      used,
      cost: Math.round(used * plan.pricePerCheck * 100) / 100,
      limit: limitState(plan.monthlyLimit, 0, planned),
      projects: mine,
      otherPlanned: planned - mine.reduce((s, x) => s + x.perMonth, 0),
    });
  }
  return out;
}

// ============ SETTINGS ============

const DEFAULTS = { enabled: false, source: NO_SOURCE, frequency: "manual", engineIds: [] as string[], updatedAt: null as Date | null, updatedBy: null as string | null };

async function settingsRow(db: Db, projectId: string) {
  const row = await db.projectRankSettings.findUnique({ where: { projectId } });
  return row
    ? { enabled: row.enabled, source: row.source, frequency: row.frequency, engineIds: row.engineIds, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : { ...DEFAULTS };
}

async function projectEngines(db: Db, projectId: string) {
  return db.externalRankEngine.findMany({
    where: { site: { projectId } },
    select: {
      id: true,
      siteId: true,
      source: true,
      externalSiteId: true,
      externalEngineId: true,
      engine: true,
      region: true,
      device: true,
      label: true,
      site: { select: { domain: true, userId: true, user: { select: { email: true } } } },
    },
    orderBy: [{ source: "asc" }, { site: { domain: "asc" } }, { engine: "asc" }, { region: "asc" }],
  });
}

const engineLabel = (e: { engine: string; region: string; device: string; site: { domain: string } }) =>
  [e.site.domain, e.engine, e.region, e.device].filter(Boolean).join(", ");

/** The owners of these sites who have no cabinet login stored for the provider. */
async function ownersWithoutCabinet(db: Db, provider: RankProvider, owners: { userId: string; email: string | null }[]): Promise<string[]> {
  if (!provider.cabinet || owners.length === 0) return [];
  const keyProvider = provider.cabinet.keyProvider;
  const have = await db.apiKey.findMany({ where: { provider: keyProvider, userId: { in: owners.map((o) => o.userId) } }, select: { userId: true } });
  const missing = owners.filter((o) => !have.some((h) => h.userId === o.userId));
  return [...new Set(missing.map((o) => o.email ?? o.userId))];
}

/** Everything the rank tracking section (Data tab) and GET .../rank-settings show. */
export async function getRankSettings(actor: Actor, slug: string, now = new Date()) {
  const ref = await projectFor(actor, slug);
  const db = appDb;
  const settings = await settingsRow(db, ref.id);
  const engines = await projectEngines(db, ref.id);
  const counts = await engineKeywordCounts(db, engines.map((e) => e.id));
  const provider = settings.source === NO_SOURCE ? undefined : getRankProvider(settings.source);
  const included = engines.filter((e) => e.source === settings.source && settings.engineIds.includes(e.id));
  const perRun = sumKeywords(included.map((e) => e.id), counts);
  const frequency = settings.frequency as RankFrequency;
  const perMonth = checksPerMonth(perRun, frequency, settings.enabled);

  const month = monthOf(now);
  const usage = await rankUsageSummary(db, month, new Set([ref.id]));
  const mineUsage = provider ? usage.find((u) => u.plan.provider === provider.id) : undefined;

  let starting: { mode: "auto" | "manual" | "none"; missingCabinetFor: string[] } = { mode: "none", missingCabinetFor: [] };
  if (provider) {
    const canStart = Boolean(provider.startCheck && provider.cabinet);
    const owners = [...new Map((included.length ? included : engines.filter((e) => e.source === provider.id)).map((e) => [e.site.userId, { userId: e.site.userId, email: e.site.user.email }])).values()];
    starting = {
      mode: canStart ? "auto" : "manual",
      missingCabinetFor: canStart ? await ownersWithoutCabinet(db, provider, owners) : [],
    };
  }

  const runs = await db.rankCheckRun.findMany({ where: { projectId: ref.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return {
    role: ref.role,
    settings: { ...settings, engineIds: settings.engineIds.filter((id) => engines.some((e) => e.id === id)) },
    providers: listRankProviders().map((p) => ({ id: p.id, name: p.name, canStart: Boolean(p.startCheck && p.cabinet) })),
    engines: engines.map((e) => ({
      id: e.id,
      siteId: e.siteId,
      domain: e.site.domain,
      source: e.source,
      engine: e.engine,
      region: e.region,
      device: e.device,
      label: e.label,
      keywords: counts.get(e.id) ?? null,
      included: settings.engineIds.includes(e.id),
    })),
    usage: {
      perRun,
      runsPerMonth: Math.round(RUNS_PER_MONTH[frequency] * 100) / 100,
      perMonth,
      usedThisMonth: await usedInMonth(db, { projectId: ref.id }, month),
      month,
    },
    limit: mineUsage ? limitState(mineUsage.plan.monthlyLimit, mineUsage.planned - (mineUsage.projects[0]?.perMonth ?? 0), perMonth) : null,
    starting,
    global: usage,
    canEditPlans: canEditPlans(actor),
    runs: runs.map(runView),
  };
}

export type RankSettingsView = Awaited<ReturnType<typeof getRankSettings>>;

type EngineDetail = { id: string; label: string; keywords: number; started: boolean; error?: string };

function runView(r: Prisma.RankCheckRunGetPayload<object>) {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    provider: r.provider,
    trigger: r.trigger,
    status: r.status,
    reason: r.reason,
    engineIds: r.engineIds,
    engines: (Array.isArray(r.details) ? r.details : []) as EngineDetail[],
    estimatedChecks: r.estimatedChecks,
    createdBy: r.createdBy,
  };
}

/** Saves the settings. Refused with 409 when they would take the provider over its monthly limit, unless `override`. */
export async function updateRankSettings(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(rankSettingsSchema, body);
  const db = appDb;
  const current = await settingsRow(db, ref.id);
  const next = {
    enabled: input.enabled ?? current.enabled,
    source: input.source ?? current.source,
    frequency: input.frequency ?? current.frequency,
    engineIds: input.engineIds ?? (input.source !== undefined && input.source !== current.source ? [] : current.engineIds),
  };
  const provider = next.source === NO_SOURCE ? undefined : getRankProvider(next.source);
  if (next.source !== NO_SOURCE && !provider) throw new ApiError(400, M.errors.unknownSource(next.source));
  if (next.enabled && !provider) throw new ApiError(400, M.errors.needSource);
  if (!provider) next.engineIds = [];

  next.engineIds = [...new Set(next.engineIds)];
  const engines = next.engineIds.length
    ? await db.externalRankEngine.findMany({ where: { id: { in: next.engineIds }, source: next.source, site: { projectId: ref.id } }, select: { id: true } })
    : [];
  // Ids of engines that left the project or the source since: drop them when they come back unchanged, refuse new ones.
  const unknown = next.engineIds.filter((id) => !engines.some((e) => e.id === id));
  if (unknown.length && input.engineIds !== undefined && unknown.some((id) => !current.engineIds.includes(id))) {
    throw new ApiError(400, M.errors.engineWrongSource);
  }
  next.engineIds = next.engineIds.filter((id) => engines.some((e) => e.id === id));

  if (provider && next.enabled && next.frequency !== "manual" && !input.override) {
    const ids = [...new Set([...next.engineIds, ...current.engineIds])];
    const counts = await engineKeywordCounts(db, ids);
    const mine = checksPerMonth(sumKeywords(next.engineIds, counts), next.frequency as RankFrequency);
    const before =
      current.enabled && current.source === next.source
        ? checksPerMonth(sumKeywords(current.engineIds, counts), current.frequency as RankFrequency)
        : 0;
    const others = (await plannedUsage(db, provider.id)).filter((p) => p.projectId !== ref.id).reduce((s, p) => s + p.perMonth, 0);
    const plan = (await providerPlans(db)).get(provider.id)!;
    const state = limitState(plan.monthlyLimit, others, mine);
    if (state.over && mine > before) throw new ApiError(409, M.errors.overLimit(state.total, state.limit, provider.name));
  }

  await db.projectRankSettings.upsert({
    where: { projectId: ref.id },
    create: { projectId: ref.id, ...next, updatedBy: actor.label },
    update: { ...next, updatedBy: actor.label },
  });
  return getRankSettings(actor, slug);
}

/** The usage log of a project: the runs of a month (default: the current one), newest first. */
export async function listRankRuns(actor: Actor, slug: string, month: string) {
  const ref = await projectFor(actor, slug);
  const { start, end } = monthRange(month);
  const runs = await appDb.rankCheckRun.findMany({
    where: { projectId: ref.id, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
  });
  const plans = await providerPlans();
  const checks = runs.filter((r) => SUCCESS.includes(r.status)).reduce((s, r) => s + r.estimatedChecks, 0);
  const byProvider = new Map<string, number>();
  for (const r of runs) if (SUCCESS.includes(r.status)) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + r.estimatedChecks);
  return {
    month,
    checks,
    costs: [...byProvider].map(([provider, n]) => {
      const plan = plans.get(provider);
      const price = plan?.pricePerCheck ?? 0;
      return { provider, checks: n, pricePerCheck: price, currency: plan?.currency ?? "RUB", amount: Math.round(n * price * 100) / 100 };
    }),
    runs: runs.map(runView),
  };
}

// ============ STARTING CHECKS ============

export type RunOptions = {
  trigger: "schedule" | "manual";
  /** Start even when it takes the month over the provider's limit (manual only). */
  override?: boolean;
  now?: Date;
  createdBy?: string;
  /** For tests: the provider's HTTP. */
  providerOptions?: RankProviderClientOptions;
};

async function cabinetLogin(db: Db, userId: string, keyProvider: string): Promise<RankCabinetLogin | null> {
  const key = await db.apiKey.findUnique({ where: { userId_provider: { userId, provider: keyProvider } } });
  if (!key?.encryptedLogin) return null;
  try {
    return { login: decrypt(key.encryptedLogin), password: decrypt(key.encryptedPassword) };
  } catch {
    // Encrypted under another NEXTAUTH_SECRET: as good as missing.
    return null;
  }
}

const NO_CABINET = "no-cabinet-login";

/**
 * Starts a check of the project's selected engines and logs it in
 * RankCheckRun, started or not. Returns null, and logs nothing, when checks
 * are off for the project: a disabled project never runs.
 */
export async function runRankCheck(db: Db, projectId: string, opts: RunOptions) {
  const now = opts.now ?? new Date();
  // Agency fork: the one guard of paid collection (manual on/off, billing auto-pause, project status).
  if (!(await paidCollectionGuard(db, projectId, now)).allowed) return null;
  const s = await db.projectRankSettings.findUnique({ where: { projectId } });
  if (!s?.enabled) return null;
  const record = (data: Omit<Prisma.RankCheckRunUncheckedCreateInput, "projectId" | "provider" | "trigger">) =>
    db.rankCheckRun.create({ data: { projectId, provider: s.source, trigger: opts.trigger, createdBy: opts.createdBy ?? null, createdAt: now, ...data } });

  const provider = getRankProvider(s.source);
  if (!provider) return record({ status: "skipped", reason: "no-provider" });
  const engines = s.engineIds.length
    ? await db.externalRankEngine.findMany({
        where: { id: { in: s.engineIds }, source: provider.id, site: { projectId } },
        select: { id: true, externalSiteId: true, externalEngineId: true, engine: true, region: true, device: true, site: { select: { userId: true, domain: true } } },
      })
    : [];
  if (engines.length === 0) return record({ status: "skipped", reason: "no-engines" });
  const engineIds = engines.map((e) => e.id);
  if (!provider.startCheck || !provider.cabinet) return record({ status: "skipped", reason: "not-supported", engineIds });

  const counts = await engineKeywordCounts(db, engineIds);
  const keywords = (id: string) => counts.get(id) ?? 0;
  const estimate = sumKeywords(engineIds, counts);
  const plan = (await providerPlans(db)).get(provider.id)!;
  const used = await usedInMonth(db, { provider: provider.id }, monthOf(now));
  const overLimit = plan.monthlyLimit > 0 && used + estimate > plan.monthlyLimit;
  if (overLimit && !(opts.override && opts.trigger === "manual")) {
    return record({
      status: "skipped",
      reason: "over-limit",
      engineIds,
      details: engines.map((e) => ({ id: e.id, label: engineLabel(e), keywords: keywords(e.id), started: false })),
    });
  }

  // One cabinet session per site owner: each owner's engines are in their own provider account.
  const results = new Map<string, { started: boolean; error?: string }>();
  const owners = [...new Set(engines.map((e) => e.site.userId))];
  for (const userId of owners) {
    const mine = engines.filter((e) => e.site.userId === userId);
    const login = await cabinetLogin(db, userId, provider.cabinet.keyProvider);
    if (!login) {
      for (const e of mine) results.set(e.id, { started: false, error: NO_CABINET });
      continue;
    }
    const targets: RankCheckTarget[] = [];
    for (const e of mine) {
      let t = targets.find((x) => x.externalSiteId === e.externalSiteId);
      if (!t) targets.push((t = { externalSiteId: e.externalSiteId, externalEngineIds: [], allEnginesOfSite: false }));
      t.externalEngineIds.push(e.externalEngineId);
    }
    try {
      const answer = await provider.startCheck(login, targets, opts.providerOptions);
      for (const e of mine) {
        const r = answer.find((a) => a.externalEngineId === e.externalEngineId);
        results.set(e.id, r ? { started: r.started, ...(r.error && { error: r.error }) } : { started: false, error: "no answer for this engine" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const e of mine) results.set(e.id, { started: false, error });
    }
  }

  const details: EngineDetail[] = engines.map((e) => ({ id: e.id, label: engineLabel(e), keywords: keywords(e.id), ...results.get(e.id)! }));
  const started = details.filter((d) => d.started);
  const failed = details.filter((d) => !d.started);
  const estimatedChecks = started.reduce((sum, d) => sum + d.keywords, 0);
  if (started.length === details.length) return record({ status: "started", engineIds, details, estimatedChecks });
  if (started.length > 0) return record({ status: "partial", reason: failed[0].error ?? null, engineIds, details, estimatedChecks });
  if (failed.every((d) => d.error === NO_CABINET)) return record({ status: "skipped", reason: NO_CABINET, engineIds, details });
  return record({ status: "failed", reason: (failed.find((d) => d.error !== NO_CABINET)?.error ?? "failed").slice(0, 500), engineIds, details });
}

/** "Start a check now" from the dashboard: the same run, logged as manual. */
export async function startRankCheckNow(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const override = Boolean((body as { override?: unknown } | null)?.override === true);
  const guard = await paidCollectionGuard(appDb, ref.id);
  if (!guard.allowed && guard.reason === "status") throw new ApiError(400, M.errors.pausedByStatus);
  if (!guard.allowed && guard.reason === "billing") throw new ApiError(400, M.errors.pausedByBilling);
  const s = await appDb.projectRankSettings.findUnique({ where: { projectId: ref.id } });
  if (!s?.enabled) throw new ApiError(400, M.errors.disabled);
  const provider = getRankProvider(s.source);
  if (!provider?.startCheck) throw new ApiError(400, M.errors.notSupported(provider?.name ?? s.source));
  const run = await runRankCheck(appDb, ref.id, { trigger: "manual", override, createdBy: actor.label });
  return { run: run ? runView(run) : null };
}

// ============ SCHEDULE ============

/** When a run that succeeded at `last` is next due. */
export function nextDue(last: Date, frequency: RankFrequency): Date | null {
  if (frequency === "manual") return null;
  if (frequency === "weekly") return new Date(last.getTime() + 7 * 86_400_000);
  if (frequency === "biweekly") return new Date(last.getTime() + 14 * 86_400_000);
  const y = last.getUTCFullYear();
  const m = last.getUTCMonth() + 1;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(last.getUTCDate(), days), last.getUTCHours(), last.getUTCMinutes()));
}

/**
 * Whether a project is due: never started, or its last started run (by hand
 * or scheduled) is one interval old; and its last scheduled attempt that was
 * skipped or failed is at least a day old, so a missing login or the limit
 * is logged once a day rather than every pass.
 */
export function isDue(
  frequency: RankFrequency,
  lastSuccess: Date | null,
  lastScheduledAttempt: { at: Date; success: boolean } | null,
  now: Date
): boolean {
  if (frequency === "manual") return false;
  if (lastSuccess) {
    const due = nextDue(lastSuccess, frequency)!;
    if (now.getTime() < due.getTime() - SLACK_MS) return false;
  }
  if (lastScheduledAttempt && !lastScheduledAttempt.success && (!lastSuccess || lastScheduledAttempt.at > lastSuccess)) {
    if (now.getTime() - lastScheduledAttempt.at.getTime() < RETRY_MS - SLACK_MS) return false;
  }
  return true;
}

/** The enabled projects whose scheduled check is due now. */
export async function dueRankProjects(db: Db, now: Date): Promise<string[]> {
  const enabled = await db.projectRankSettings.findMany({
    where: { enabled: true, source: { not: NO_SOURCE }, frequency: { not: "manual" } },
    select: { projectId: true, frequency: true },
    orderBy: { updatedAt: "asc" },
  });
  const due: string[] = [];
  for (const s of enabled) {
    // Paused or archived projects and projects whose paid collection is auto-paused are never due.
    if (!(await paidCollectionGuard(db, s.projectId, now)).allowed) continue;
    const [success, attempt] = await Promise.all([
      db.rankCheckRun.findFirst({ where: { projectId: s.projectId, status: { in: SUCCESS } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.rankCheckRun.findFirst({ where: { projectId: s.projectId, trigger: "schedule" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
    ]);
    const last = attempt ? { at: attempt.createdAt, success: SUCCESS.includes(attempt.status) } : null;
    if (isDue(s.frequency as RankFrequency, success?.createdAt ?? null, last, now)) due.push(s.projectId);
  }
  return due;
}

/** One scheduling pass: starts up to RANK_CHECKS_PER_PASS due projects. */
export async function runDueRankChecks(db: Db, ctx: { now: Date; providerOptions?: RankProviderClientOptions; max?: number }) {
  const due = (await dueRankProjects(db, ctx.now)).slice(0, ctx.max ?? RANK_CHECKS_PER_PASS);
  const runs = [];
  for (const projectId of due) {
    try {
      runs.push(await runRankCheck(db, projectId, { trigger: "schedule", now: ctx.now, createdBy: "schedule", providerOptions: ctx.providerOptions }));
    } catch (err) {
      console.error("[rank-checks]", projectId, err instanceof Error ? err.message : err);
    }
  }
  return runs.filter((r) => r !== null);
}
