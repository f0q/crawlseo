"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { billingState, type BillingState } from "@/lib/projects/billing-rule";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, useAction } from "./ui";
import { useTimeZone } from "@/components/timezone-provider";

const T = M.billing;
const day = (d: string | null) => (d ? formatDay(d, { year: true }) : "");

/** What the rule makes of the dates, in words. */
export function billingText(s: BillingState, timeZone?: string): string {
  if (!s.tracked) return T.state.none;
  const until = day(s.paidUntil);
  if (s.level === "paused") {
    return T.state.paused(T.state.reasons[s.pauseReason ?? "overdue"] ?? "", s.pausedAt ? formatDay(s.pausedAt, { year: true, timeZone }) : null);
  }
  if (s.level === "overdue") {
    const parts = [];
    if (s.overdueDays > 0) parts.push(T.state.overdue(s.overdueDays, s.pauseFrom ? day(s.pauseFrom) : null));
    if (s.contractEnded && s.contractEnd) parts.push(T.state.contractEnded(day(s.contractEnd)));
    return parts.join(" ");
  }
  if (s.level === "soon") return T.state.soon(until, s.daysLeft ?? 0);
  return T.state.ok(until, s.daysLeft ?? 0);
}

/**
 * Agency fork: Money > Client payment. Paid until, contract until and "never
 * pause", with the rule's outcome for the dates in the form (before saving,
 * too). Saved with PATCH /api/projects/{slug}; the server applies the rule at once.
 */
export function BillingSection({
  slug,
  paidUntil,
  contractEnd,
  neverPause,
  pausedAt,
  canEdit,
}: {
  slug: string;
  paidUntil: string | null;
  contractEnd: string | null;
  neverPause: boolean;
  pausedAt: string | null;
  canEdit: boolean;
}) {
  const timeZone = useTimeZone();
  const [form, setForm] = useState({ paidUntil: paidUntil ?? "", contractEnd: contractEnd ?? "", neverPause });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const dirty = form.paidUntil !== (paidUntil ?? "") || form.contractEnd !== (contractEnd ?? "") || form.neverPause !== neverPause;
  const preview = billingState({
    paidUntil: form.paidUntil || null,
    contractEnd: form.contractEnd || null,
    billingNeverPause: form.neverPause,
    paidPausedAt: dirty ? null : pausedAt,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const ok = await run("save", () =>
      send(projectUrl(slug), "PATCH", { paidUntil: form.paidUntil || null, contractEnd: form.contractEnd || null, billingNeverPause: form.neverPause })
    );
    if (ok) setSaved(true);
  }

  return (
    <Section title={T.title} description={T.description}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={T.paidUntil} hint={T.paidUntilHint}>
            <input
              className={inputClass}
              type="date"
              value={form.paidUntil}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, paidUntil: e.target.value })}
            />
          </Field>
          <Field label={T.contractEnd} hint={T.contractEndHint}>
            <input
              className={inputClass}
              type="date"
              value={form.contractEnd}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, contractEnd: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[14px] text-text-strong">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.neverPause}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, neverPause: e.target.checked })}
          />
          <span>
            {T.neverPause}
            <span className="block text-[12px] text-muted-foreground">{T.neverPauseHint}</span>
          </span>
        </label>
        <p
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-[13px]",
            preview.level === "paused" ? "border-danger/30 bg-danger-bg text-danger" : preview.level === "overdue" ? "border-warning/30 bg-warning-bg text-warning" : "border-border text-muted-foreground"
          )}
        >
          {billingText(preview, timeZone)}
        </p>
        <ErrorLine error={error} />
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy !== null || !dirty}>
              {busy ? T.saving : T.save}
            </Button>
            {saved && !dirty && <span className="text-[13px] text-success">{T.saved}</span>}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{T.readOnly}</p>
        )}
      </form>
    </Section>
  );
}
