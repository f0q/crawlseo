"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";

/* Small shared pieces of the project screens (agency fork). */

export const inputClass =
  "h-[38px] w-full rounded-md border border-border bg-bg-section px-3 text-[14px] text-text-strong placeholder:text-muted-foreground focus:border-brand-500 focus:bg-bg focus:outline-none disabled:opacity-60";
export const textareaClass =
  "w-full rounded-md border border-border bg-bg-section px-3 py-2 text-[14px] leading-[22px] text-text-strong placeholder:text-muted-foreground focus:border-brand-500 focus:bg-bg focus:outline-none disabled:opacity-60";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="mono-label text-[11px] text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Section({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[17px] leading-6 font-medium text-text-strong">{title}</h2>
          {description && <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const STATUS_CLASS: Record<string, string> = {
  client: "border-success/40 text-success",
  prospect: "border-brand-500/40 text-brand-500",
  paused: "border-border text-muted-foreground",
  archived: "border-border text-muted-foreground line-through",
};

export function StatusBadge({ status }: { status: string }) {
  const label = (M.labels.status as Record<string, string>)[status] ?? status;
  return (
    <span className={cn("mono-label inline-flex h-6 items-center rounded-md border px-2 text-[11px]", STATUS_CLASS[status] ?? "border-border")}>
      {label}
    </span>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] leading-5 text-danger">
      {error}
    </p>
  );
}

/** A refused request: the server's message and the HTTP status. */
export class SendError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** A request to /api/projects; throws the error message the server answered with. */
export async function send<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body instanceof FormData
      ? { body }
      : body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new SendError(data.error || M.common.error, res.status);
  return data;
}

/** Runs one request at a time and keeps its error; refreshes the page after a success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(name: string, fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> {
    setBusy(name);
    setError(null);
    try {
      const r = await fn();
      if (opts.refresh !== false) router.refresh();
      return r;
    } catch (err) {
      setError(err instanceof Error ? err.message : M.common.error);
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run };
}

export const projectUrl = (slug: string, ...rest: string[]) =>
  `/api/projects/${[slug, ...rest].map(encodeURIComponent).join("/")}`;
