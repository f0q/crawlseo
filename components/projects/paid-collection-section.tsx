"use client";

import { useState } from "react";
import Link from "next/link";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import type { PaidCollection } from "@/lib/projects/paid-collection";
import { projectTabHref } from "@/lib/projects/tabs";
import { cn } from "@/lib/utils";
import { ErrorLine, projectUrl, Section, send, useAction } from "./ui";

const T = M.paid;
const ORDER = ["rank", "ai"] as const;

/**
 * Agency fork: Money > Paid collection. One switch per paid source, with what
 * the guard says now (runs, off, paused by payment, stopped by the project's
 * status). Changing a switch is the dashboard's only (PATCH .../paid-collection).
 */
export function PaidCollectionSection({ slug, data, canEdit }: { slug: string; data: PaidCollection; canEdit: boolean }) {
  const [state, setState] = useState(data);
  const { busy, error, run } = useAction();

  async function toggle(source: (typeof ORDER)[number], on: boolean) {
    const next = await run(source, () => send<PaidCollection>(projectUrl(slug, "paid-collection"), "PATCH", { [source]: on }));
    if (next) setState(next);
  }

  return (
    <Section title={T.title} description={T.description}>
      <ul className="flex flex-col divide-y divide-border-soft">
        {ORDER.map((source) => {
          const s = state[source];
          const runs = s.guard.allowed;
          const label = runs ? T.state.allowed : s.enabled ? `${T.onButBlocked}: ${T.state[s.guard.reason].toLowerCase()}` : T.state.off;
          return (
            <li key={source} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-text-strong">{T.sources[source].label}</p>
                <p className="text-[12px] leading-5 text-muted-foreground">
                  {T.sources[source].hint}
                  {source === "rank" && (
                    <>
                      {" "}
                      <Link href={projectTabHref(slug, "data", { section: "rank" })} className="text-link">
                        {T.rankSettings}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[12px]",
                    runs ? "border-success/30 bg-success-bg text-success" : s.enabled ? "border-warning/30 bg-warning-bg text-warning" : "border-border text-muted-foreground"
                  )}
                >
                  {label}
                </span>
                <label className="flex items-center gap-2 text-[13px] text-text-strong">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={T.sources[source].label}
                    checked={s.enabled}
                    disabled={!canEdit || busy !== null}
                    onChange={(e) => toggle(source, e.target.checked)}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorLine error={error} />
      {!canEdit && <p className="mt-2 text-[13px] text-muted-foreground">{T.readOnly}</p>}
    </Section>
  );
}
