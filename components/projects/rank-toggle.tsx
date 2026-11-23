"use client";

import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { cn } from "@/lib/utils";
import { projectUrl, send, SendError, useAction } from "./ui";

/**
 * Agency fork: the on/off of paid rank checks of a project in the data
 * sources panel. The same PATCH as the rank tracking section of the Data tab; over the provider's
 * limit it asks before sending "override".
 */
export function RankToggle({ slug, enabled, name }: { slug: string; enabled: boolean; name: string }) {
  const { busy, error, run } = useAction();
  const label = enabled ? M.sources.toggleOff : M.sources.toggleOn;

  async function toggle() {
    await run("toggle", async () => {
      try {
        return await send(projectUrl(slug, "rank-settings"), "PATCH", { enabled: !enabled });
      } catch (err) {
        if (err instanceof SendError && err.status === 409 && window.confirm(M.rank.overConfirm(err.message))) {
          return send(projectUrl(slug, "rank-settings"), "PATCH", { enabled: !enabled, override: true });
        }
        throw err;
      }
    });
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${label}: ${name}`}
        title={label}
        disabled={busy !== null}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60",
          enabled ? "border-brand-500 bg-brand-500" : "border-border bg-bg-section"
        )}
      >
        <span className={cn("inline-block size-3.5 rounded-full bg-bg shadow transition-transform", enabled ? "translate-x-[18px]" : "translate-x-[2px]")} />
      </button>
      {error && (
        <span role="alert" className="max-w-[160px] text-[11px] leading-4 text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
