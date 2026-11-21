"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import type { BudgetView } from "@/lib/projects/budget";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { BUDGET_CURRENCIES, formatMoney } from "@/lib/projects/rank-usage";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, useAction } from "./ui";

const T = M.budget;

/** Plan and actual of one row as two bars on a shared scale. */
export function PlanBar({ plan, actual, max, label }: { plan: number; actual: number; max: number; label: string }) {
  const w = (n: number) => `${max > 0 ? Math.min(100, (n / max) * 100) : 0}%`;
  const over = plan > 0 && actual > plan;
  return (
    <div className="flex flex-col gap-0.5" aria-label={label}>
      <div className="h-1.5 rounded-full bg-bg-section">
        <div className="h-full rounded-full bg-border" style={{ width: w(plan) }} />
      </div>
      <div className="h-1.5 rounded-full bg-bg-section">
        <div className={cn("h-full rounded-full", over ? "bg-danger" : "bg-brand-500")} style={{ width: w(actual) }} />
      </div>
    </div>
  );
}

/** Project > Budget: the plan by category, spending entries, automatic costs, plan vs actual and the last months. */
export function BudgetSection({ slug, data, canEdit }: { slug: string; data: BudgetView; canEdit: boolean }) {
  const c = data.currency;
  const max = Math.max(1, ...data.summary.rows.flatMap((r) => [r.plan, r.actual]));
  const histMax = Math.max(1, ...data.history.flatMap((h) => [h.plan, h.actual]));

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={T.title}
        description={T.description}
        actions={
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="tab" value="budget" />
            <Field label={T.month}>
              <input className={cn(inputClass, "w-40")} type="month" name="month" defaultValue={data.month} />
            </Field>
            <Button type="submit" variant="outline" size="sm">
              {T.show}
            </Button>
          </form>
        }
      >
        <p className="mb-4 text-[15px] text-text-strong">
          {T.summaryLine(formatMoney(data.summary.plan), formatMoney(data.summary.actual), c, data.summary.percent)}
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="mono-label text-left text-[11px] text-muted-foreground">
              <th className="py-1 font-normal">{T.category}</th>
              <th className="py-1 text-right font-normal">{T.plan}</th>
              <th className="py-1 text-right font-normal">{T.actual}</th>
              <th className="hidden w-1/3 py-1 pl-4 font-normal sm:table-cell" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.summary.rows.map((r) => (
              <tr key={r.category}>
                <td className="py-2 text-text-strong">{r.category}</td>
                <td className="py-2 text-right font-data">{formatMoney(r.plan)}</td>
                <td className={cn("py-2 text-right font-data", r.plan > 0 && r.actual > r.plan && "text-danger")}>
                  {formatMoney(r.actual)}
                  {r.auto > 0 && <span className="block text-[11px] text-muted-foreground">{T.auto}: {formatMoney(r.auto)}</span>}
                </td>
                <td className="hidden py-2 pl-4 sm:table-cell">
                  <PlanBar plan={r.plan} actual={r.actual} max={max} label={`${r.category}: ${r.actual} / ${r.plan}`} />
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2 text-text-strong">{T.total}</td>
              <td className="py-2 text-right font-data">{formatMoney(data.summary.plan)}</td>
              <td className="py-2 text-right font-data">{formatMoney(data.summary.actual)}</td>
              <td className="hidden py-2 pl-4 text-[12px] text-muted-foreground sm:table-cell">{T.used(data.summary.percent)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 text-[13px] text-muted-foreground">
          <p className="mono-label text-[11px]">{T.auto}</p>
          {data.autoCosts.length === 0 ? (
            <p>{T.noAuto}</p>
          ) : (
            data.autoCosts.map((a) => (
              <p key={a.provider}>
                {T.autoLine(a.name, a.checks, String(a.pricePerCheck), a.currency, formatMoney(a.amount))}
                {!a.counted && ` (${T.autoOtherCurrency(a.currency)})`}
              </p>
            ))
          )}
        </div>
      </Section>

      <EntriesSection slug={slug} data={data} canEdit={canEdit} />
      <PlanSection slug={slug} data={data} canEdit={canEdit} />

      <Section title={T.history}>
        <ul className="flex flex-col gap-3">
          {data.history.map((h) => (
            <li key={h.month} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 text-[13px]">
              <span className="font-data text-muted-foreground">{h.month}</span>
              <PlanBar plan={h.plan} actual={h.actual} max={histMax} label={`${h.month}: ${h.actual} / ${h.plan}`} />
              <span className="font-data text-text-strong">
                {formatMoney(h.actual)} / {formatMoney(h.plan)}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {canEdit && <SettingsForm slug={slug} data={data} />}
    </div>
  );
}

function EntriesSection({ slug, data, canEdit }: { slug: string; data: BudgetView; canEdit: boolean }) {
  const inMonth = new Date().toISOString().slice(0, 7) === data.month;
  const [date, setDate] = useState(inMonth ? new Date().toISOString().slice(0, 10) : `${data.month}-01`);
  const [category, setCategory] = useState(data.categories[0] ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await run("add", () => send(projectUrl(slug, "budget-entries"), "POST", { date, category, amount: Number(amount), note: note || null }));
    if (r) {
      setAmount("");
      setNote("");
    }
  }

  return (
    <Section title={T.entries}>
      {canEdit && (
        <form onSubmit={add} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[160px_160px_140px_1fr_auto] md:items-end">
          <Field label={T.date}>
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label={T.category}>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {data.categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`${T.amount}, ${data.currency}`}>
            <input className={inputClass} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label={T.note}>
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <Button type="submit" variant="outline" disabled={busy !== null}>
            {busy === "add" ? T.adding : T.add}
          </Button>
        </form>
      )}
      <ErrorLine error={error} />
      {data.entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{T.noEntries}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="text-text-strong">
                  {formatDay(e.date, { year: true })} · {e.category} · {formatMoney(e.amount, data.currency)}
                </span>
                {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                <span className="mono-label ml-2 text-[11px] text-muted-foreground">
                  {e.authorKind === "agent" && <Bot aria-label={T.agent} className="mr-1 inline size-3" />}
                  {e.author}
                </span>
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => window.confirm(T.deleteConfirm) && run(e.id, () => send(projectUrl(slug, "budget-entries", e.id), "DELETE"))}
                >
                  {T.delete}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function PlanSection({ slug, data, canEdit }: { slug: string; data: BudgetView; canEdit: boolean }) {
  const initial = (o: Record<string, number>) => Object.fromEntries(data.categories.map((cat) => [cat, o[cat] === undefined ? "" : String(o[cat])]));
  const [defaults, setDefaults] = useState<Record<string, string>>(() => initial(data.plan.defaults));
  const [month, setMonth] = useState<Record<string, string>>(() => initial(data.plan.month));
  const { busy, error, run } = useAction();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run("plan", async () => {
      await send(projectUrl(slug, "budget"), "PATCH", { plan: { month: null, lines: Object.fromEntries(data.categories.map((cat) => [cat, num(defaults[cat] ?? "")])) } });
      await send(projectUrl(slug, "budget"), "PATCH", { plan: { month: data.month, lines: Object.fromEntries(data.categories.map((cat) => [cat, num(month[cat] ?? "")])) } });
    });
  }

  return (
    <Section title={T.planTitle} description={T.planHint}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="mono-label text-left text-[11px] text-muted-foreground">
              <th className="py-1 font-normal">{T.category}</th>
              <th className="py-1 font-normal">
                {T.everyMonth}, {data.currency}
              </th>
              <th className="py-1 font-normal">
                {T.thisMonth} ({data.month})
              </th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((cat) => (
              <tr key={cat}>
                <td className="py-1 pr-3 text-text-strong">{cat}</td>
                <td className="py-1 pr-3">
                  <input
                    aria-label={`${cat}, ${T.everyMonth}`}
                    className={inputClass}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!canEdit}
                    value={defaults[cat] ?? ""}
                    onChange={(e) => setDefaults({ ...defaults, [cat]: e.target.value })}
                  />
                </td>
                <td className="py-1">
                  <input
                    aria-label={`${cat}, ${T.thisMonth}`}
                    className={inputClass}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={!canEdit}
                    value={month[cat] ?? ""}
                    onChange={(e) => setMonth({ ...month, [cat]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorLine error={error} />
        {canEdit && (
          <div>
            <Button type="submit" disabled={busy !== null}>
              {busy ? T.saving : T.savePlan}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

function SettingsForm({ slug, data }: { slug: string; data: BudgetView }) {
  const [currency, setCurrency] = useState(data.currency);
  const [categories, setCategories] = useState(data.categories.join(", "));
  const { busy, error, run } = useAction();
  return (
    <Section title={`${T.currency}, ${T.categories.toLowerCase()}`}>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_auto] md:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          await run("settings", () =>
            send(projectUrl(slug, "budget"), "PATCH", {
              currency,
              categories: categories
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          );
        }}
      >
        <Field label={T.currency}>
          <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {BUDGET_CURRENCIES.map((cur) => (
              <option key={cur} value={cur}>
                {cur}
              </option>
            ))}
          </select>
        </Field>
        <Field label={T.categories} hint={T.categoriesHint}>
          <input className={inputClass} value={categories} onChange={(e) => setCategories(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" disabled={busy !== null}>
          {T.saveSettings}
        </Button>
        <div className="md:col-span-3">
          <ErrorLine error={error} />
        </div>
      </form>
    </Section>
  );
}
