"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { checksPerMonth, checksPerRun, limitState, NO_SOURCE, RANK_FREQUENCIES, RUNS_PER_MONTH, type RankFrequency } from "@/lib/projects/rank-usage";
import type { RankSettingsView } from "@/lib/projects/rank";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, SendError, useAction } from "./ui";
import { useTimeZone } from "@/components/timezone-provider";

const T = M.rank;

/** The view as it reaches the browser: dates as strings. */
export type RankSettingsData = Omit<RankSettingsView, "settings"> & {
  settings: Omit<RankSettingsView["settings"], "updatedAt"> & { updatedAt: string | null };
};

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const price = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);

/** A bar of used / planned against the limit. */
function Meter({ value, limit, label }: { value: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  const over = limit > 0 && value > limit;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[12px] text-muted-foreground">
        <span>{label}</span>
        <span className={cn("font-data", over && "text-danger")}>
          {fmt(value)}
          {limit > 0 && ` / ${fmt(limit)}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-section" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={limit || undefined}>
        <div className={cn("h-full rounded-full", over ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand-500")} style={{ width: `${limit > 0 ? pct : 0}%` }} />
      </div>
    </div>
  );
}

/** Project > Rank tracking: whether checks are started, where, how often, in which engines; usage against the limit. */
export function RankSettingsSection({ slug, data, canEdit }: { slug: string; data: RankSettingsData; canEdit: boolean }) {
  const timeZone = useTimeZone();
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [source, setSource] = useState(data.settings.source);
  const [frequency, setFrequency] = useState(data.settings.frequency as RankFrequency);
  const [engineIds, setEngineIds] = useState<string[]>(data.settings.engineIds);
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();

  const engines = data.engines.filter((e) => e.source === source);
  const provider = data.providers.find((p) => p.id === source);
  const global = data.global.find((g) => g.plan.provider === source);

  const perRun = checksPerRun(engines.filter((e) => engineIds.includes(e.id)).map((e) => ({ keywords: e.keywords ?? 0 })));
  const perMonth = checksPerMonth(perRun, frequency, enabled);
  const savedMine = data.settings.source === source && data.settings.enabled ? data.usage.perMonth : 0;
  const others = global ? global.planned - savedMine : 0;
  const limit = useMemo(() => (global ? limitState(global.plan.monthlyLimit, others, perMonth) : null), [global, others, perMonth]);

  async function save(override = false) {
    setSaved(false);
    setError(null);
    try {
      await send(projectUrl(slug, "rank-settings"), "PATCH", { enabled, source, frequency, engineIds, ...(override && { override: true }) });
    } catch (err) {
      if (err instanceof SendError && err.status === 409 && !override) {
        if (window.confirm(T.overConfirm(err.message))) return save(true);
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : M.common.error);
      return;
    }
    setSaved(true);
    await run("refresh", async () => undefined);
  }

  const startable = provider?.canStart && data.settings.enabled && data.settings.source === source;

  return (
    <div className="flex flex-col gap-5">
      <Section title={T.title} description={T.description}>
        {!canEdit && <p className="mb-3 text-[13px] text-muted-foreground">{T.readOnly}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <span className="text-[14px] text-text-strong">{T.enabled}</span>
              <span className="block text-[12px] text-muted-foreground">{T.enabledHint}</span>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={T.source}>
              <select
                className={inputClass}
                value={source}
                disabled={!canEdit}
                onChange={(e) => {
                  setSource(e.target.value);
                  setEngineIds([]);
                }}
              >
                <option value={NO_SOURCE}>{T.none}</option>
                {data.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={T.frequency}>
              <select className={inputClass} value={frequency} disabled={!canEdit} onChange={(e) => setFrequency(e.target.value as RankFrequency)}>
                {RANK_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {T.frequencies[f]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mono-label mb-1 text-[11px] text-muted-foreground">{T.engines}</legend>
            {source === NO_SOURCE ? (
              <p className="text-[13px] text-muted-foreground">{T.pickSource}</p>
            ) : engines.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{T.noEngines(provider?.name ?? source)}</p>
            ) : (
              <>
                {engines.map((e) => (
                  <label key={e.id} className="flex items-center gap-3 text-[14px] text-text-strong">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={engineIds.includes(e.id)}
                      disabled={!canEdit}
                      onChange={(ev) => setEngineIds((ids) => (ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id)))}
                    />
                    <span className="min-w-0 flex-1 truncate">{[e.domain, e.engine, e.region, e.device].filter(Boolean).join(", ")}</span>
                    <span className="font-data text-[12px] text-muted-foreground">{T.keywords(e.keywords)}</span>
                  </label>
                ))}
                <p className="text-[12px] text-muted-foreground">{T.enginesHint}</p>
              </>
            )}
          </fieldset>

          <div className="rounded-md border border-border p-3">
            <p className="mono-label mb-1 text-[11px] text-muted-foreground">{T.usage}</p>
            <p className="text-[14px] text-text-strong">{T.perMonth(perMonth)}</p>
            <p className="text-[12px] text-muted-foreground">{T.formula(perRun, String(Math.round(RUNS_PER_MONTH[frequency] * 100) / 100))}</p>
            {limit?.over && <p className="mt-1 text-[13px] text-danger">{T.overLimit(limit.total, limit.limit, provider?.name ?? source)}</p>}
            {!limit?.over && limit?.near && <p className="mt-1 text-[13px] text-warning">{T.nearLimit(limit.total, limit.limit)}</p>}
          </div>

          {provider && (
            <div className="text-[13px] leading-5 text-muted-foreground">
              <p className="mono-label text-[11px]">{T.starting}</p>
              <p>{provider.canStart ? T.startAuto(provider.name) : T.startManual(provider.name)}</p>
              {data.settings.source === source && data.starting.missingCabinetFor.length > 0 && (
                <p className="text-warning">{T.noCabinet(provider.name, data.starting.missingCabinetFor.join(", "))}</p>
              )}
            </div>
          )}

          <ErrorLine error={error} />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy !== null}>
                {busy ? T.saving : T.save}
              </Button>
              {saved && !error && <span className="text-[13px] text-success">{T.saved}</span>}
              {startable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    window.confirm(T.startConfirm(data.usage.perRun)) &&
                    run("start", () => send(projectUrl(slug, "rank-checks"), "POST", {}))
                  }
                >
                  {busy === "start" ? T.startingNow : T.startNow}
                </Button>
              )}
            </div>
          )}
        </form>
      </Section>

      <GlobalUsage data={data} />

      <Section title={T.runs}>
        {data.runs.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{T.noRuns}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
                <span className="text-text-strong">
                  {formatDay(r.createdAt, { year: true, time: true, timeZone })} · {T.status[r.status] ?? r.status}
                  {r.reason && <span className="text-muted-foreground"> ({T.reasons[r.reason] ?? r.reason})</span>}
                </span>
                <span className="mono-label text-[11px] text-muted-foreground">
                  {[r.provider, T.trigger[r.trigger] ?? r.trigger, T.checks(r.estimatedChecks)].join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Every provider: planned and started checks of all projects against the monthly limit; admins edit the plan. */
function GlobalUsage({ data }: { data: RankSettingsData }) {
  return (
    <Section title={T.global} description={T.globalHint}>
      <div className="flex flex-col gap-5">
        {data.global.map((g) => (
          <div key={g.plan.provider} className="flex flex-col gap-2">
            <p className="text-[14px] text-text-strong">
              {g.plan.name}
              <span className="ml-2 text-[12px] text-muted-foreground">
                {g.plan.planName && `${g.plan.planName} · `}
                {T.pricePerCheck(price(g.plan.pricePerCheck), g.plan.currency)}
              </span>
            </p>
            <Meter label={T.planned} value={g.planned} limit={g.plan.monthlyLimit} />
            <Meter label={T.used} value={g.used} limit={g.plan.monthlyLimit} />
            {g.limit.over && <p className="text-[13px] text-danger">{T.overLimit(g.planned, g.plan.monthlyLimit, g.plan.name)}</p>}
            {data.canEditPlans && <PlanForm plan={g.plan} />}
          </div>
        ))}
      </div>
    </Section>
  );
}

function PlanForm({ plan }: { plan: RankSettingsData["global"][number]["plan"] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    monthlyLimit: String(plan.monthlyLimit),
    planName: plan.planName,
    planPrice: String(plan.planPrice),
    planChecks: String(plan.planChecks),
    currency: plan.currency,
  });
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {T.editPlan}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(5,1fr)_auto] md:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("plan", () =>
          send("/api/projects/_rank-plans", "PATCH", {
            provider: plan.provider,
            monthlyLimit: Number(v.monthlyLimit),
            planName: v.planName,
            planPrice: Number(v.planPrice),
            planChecks: Number(v.planChecks),
            currency: v.currency,
          })
        );
        if (r) setOpen(false);
      }}
    >
      <Field label={T.limit}>
        <input className={inputClass} type="number" min={0} value={v.monthlyLimit} onChange={(e) => setV({ ...v, monthlyLimit: e.target.value })} />
      </Field>
      <Field label={T.planName}>
        <input className={inputClass} value={v.planName} onChange={(e) => setV({ ...v, planName: e.target.value })} />
      </Field>
      <Field label={T.planPrice}>
        <input className={inputClass} type="number" min={0} step="0.01" value={v.planPrice} onChange={(e) => setV({ ...v, planPrice: e.target.value })} />
      </Field>
      <Field label={T.planChecks}>
        <input className={inputClass} type="number" min={1} value={v.planChecks} onChange={(e) => setV({ ...v, planChecks: e.target.value })} />
      </Field>
      <Field label={T.currency}>
        <select className={inputClass} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
          <option value="RUB">RUB</option>
          <option value="USD">USD</option>
        </select>
      </Field>
      <Button type="submit" variant="outline" disabled={busy !== null}>
        {T.savePlan}
      </Button>
      <div className="md:col-span-6">
        <ErrorLine error={error} />
      </div>
    </form>
  );
}
