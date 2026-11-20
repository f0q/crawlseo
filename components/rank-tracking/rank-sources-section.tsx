"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Plug, RefreshCw, Save, Trash2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { pendingNote, waitForJob } from "@/lib/jobs/client";
import { engineLabel, suggestProjects } from "@/lib/rank-providers/common";
import { RANK_UI } from "@/lib/rank-providers/messages";
import type { LinkedEngine } from "@/lib/rank-providers/links";
import type { RankProjectWithEngines } from "@/lib/rank-providers/types";
import { RankImport } from "./rank-import";

const T = RANK_UI.settings;

const keyOf = (projectId: string, engineId: string) => `${projectId}\u0000${engineId}`;

export type ProviderOption = { id: string; name: string; hasKey: boolean };

const SELECT_CLASS =
  "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-brand-500 focus:outline-none";

/**
 * Site settings: every rank source of this site. Provider engines are linked
 * by picking a provider, loading its projects (the ones on this site's host
 * first, preselected when none is linked yet) and ticking engines; a CSV
 * import or the write API adds engines of their own. Any engine can be
 * removed with its positions.
 */
export function RankSourcesSection({
  siteId,
  domain,
  linked,
  providers,
}: {
  siteId: string;
  domain: string;
  linked: LinkedEngine[];
  providers: ProviderOption[];
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [projects, setProjects] = useState<RankProjectWithEngines[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = providers.find((p) => p.id === providerId);
  const linkedOfProvider = linked.filter((e) => e.source === providerId);
  const hasSynced = linked.some((e) => e.synced);

  const { suggested, others } = useMemo(() => {
    const all = projects ?? [];
    const match = new Set(suggestProjects(domain, all).map((p) => p.externalSiteId));
    return {
      suggested: all.filter((p) => match.has(p.externalSiteId)),
      others: all.filter((p) => !match.has(p.externalSiteId)),
    };
  }, [projects, domain]);

  function pickProvider(id: string) {
    setProviderId(id);
    setProjects(null);
    setSelected(new Set());
    setError(null);
  }

  async function loadProjects() {
    if (!provider) return;
    setBusy("load");
    setError(null);
    try {
      const res = await fetch(`/api/rank-providers/${encodeURIComponent(provider.id)}/projects`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load the projects");
      const list = data as RankProjectWithEngines[];
      setProjects(list);
      if (!list.length) setError(T.noProjects);
      const current = linkedOfProvider.map((e) => keyOf(e.externalSiteId, e.externalEngineId));
      // Nothing of this provider linked yet: preselect every engine of the projects on this domain.
      setSelected(
        new Set(
          current.length
            ? current
            : suggestProjects(domain, list).flatMap((p) => p.engines.map((e) => keyOf(p.externalSiteId, e.externalEngineId)))
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the projects");
    } finally {
      setBusy(null);
    }
  }

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function followJob(jobId: string) {
    const job = await waitForJob(jobId, {
      onUpdate: (j) => setMessage(pendingNote(j) ?? (j.status === "RUNNING" ? "Syncing…" : "Queued…")),
    });
    if (job.waiting) {
      setMessage(null);
      setError(pendingNote(job));
      return;
    }
    if (job.status === "FAILED") throw new Error(job.lastError || "Sync failed");
    const r = (job.result ?? {}) as { engines?: number; datesFetched?: number; rowsWritten?: number; failed?: string[] };
    setMessage(T.synced(r.engines ?? 0, r.datesFetched ?? 0, r.rowsWritten ?? 0));
    if (r.failed?.length) setError(T.partly(r.failed));
  }

  async function handleSave() {
    if (!provider) return;
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const engines = [...selected].map((key) => {
        const [externalSiteId, externalEngineId] = key.split("\u0000");
        return { externalSiteId, externalEngineId };
      });
      const res = await fetch(`/api/sites/${siteId}/rank-sources/${encodeURIComponent(provider.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setMessage(T.saved(data.added ?? 0, data.removed ?? 0));
      router.refresh();
      if (data.jobId) {
        setBusy("sync");
        await followJob(data.jobId);
        router.refresh();
      }
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy("sync");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/rank-sync`, { method: "POST" });
      const queued = await res.json();
      if (!res.ok) throw new Error(queued.error || "Sync failed");
      await followJob(queued.jobId);
      router.refresh();
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(engine: LinkedEngine) {
    setBusy(engine.id);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/rank-engines/${encodeURIComponent(engine.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setConfirming(null);
      setBusy(null);
    }
  }

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] leading-5 font-semibold text-text-strong">{T.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{T.description}</p>
        </div>
        {linked.length ? (
          <span className="mono-label flex shrink-0 items-center gap-1.5 rounded-md border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] text-success">
            <CheckCircle2 className="size-3.5" />
            {T.connected}
          </span>
        ) : (
          <span className="mono-label flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            <XCircle className="size-3.5" />
            {T.notConnected}
          </span>
        )}
      </div>

      {linked.length > 0 && (
        <ul className="mt-4 divide-y divide-border-soft text-sm">
          {linked.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 text-text-strong">
                {e.host} · {e.label}
                <span className="mono-label ml-2 rounded border border-border px-1 text-[10px] text-muted-foreground">
                  {e.sourceName}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="mono-label text-[11px] text-muted-foreground">
                  {e.lastSyncedAt ? T.syncedAt(formatDay(e.lastSyncedAt, { time: true })) : T.never}
                </span>
                {confirming === e.id ? (
                  <Button type="button" size="xs" variant="destructive" disabled={busy !== null} onClick={() => void handleRemove(e)}>
                    {busy === e.id && <Loader2 className="animate-spin" aria-hidden />}
                    {T.confirmRemove}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    aria-label={`${T.remove} ${e.label}`}
                    disabled={busy !== null}
                    onClick={() => setConfirming(e.id)}
                  >
                    <Trash2 aria-hidden />
                    {T.remove}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {connecting && (
        <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`${siteId}-provider`}>
              {T.provider}
            </label>
            <select
              id={`${siteId}-provider`}
              className={SELECT_CLASS}
              value={providerId}
              onChange={(e) => pickProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {provider?.hasKey ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void loadProjects()} disabled={busy !== null}>
                {busy === "load" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
                {busy === "load" ? T.loading : T.load(provider.name)}
              </Button>
            ) : provider ? (
              <span className="text-sm text-muted-foreground">
                {T.noProviderKey(provider.name)}{" "}
                <Link href={`/settings?connect=${encodeURIComponent(provider.id)}#rank-tracking`} className="text-link font-medium">
                  {T.addKey}
                </Link>
              </span>
            ) : null}
          </div>

          {projects && projects.length > 0 && (
            <div className="space-y-4">
              {[
                { title: T.suggested, list: suggested },
                { title: T.otherProjects, list: others },
              ]
                .filter((group) => group.list.length > 0)
                .map((group) => (
                  <fieldset key={group.title}>
                    <legend className="mono-label mb-2 text-[11px] text-muted-foreground">{group.title}</legend>
                    <div className="space-y-3">
                      {group.list.map((project) => (
                        <div key={project.externalSiteId}>
                          <p className="text-sm font-medium text-text-strong">{project.host || project.title}</p>
                          <div className="mt-1 flex flex-col gap-1">
                            {project.engines.map((engine) => {
                              const key = keyOf(project.externalSiteId, engine.externalEngineId);
                              return (
                                <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={selected.has(key)}
                                    onChange={(ev) => toggle(key, ev.target.checked)}
                                    className="size-4 accent-brand-500"
                                  />
                                  {engineLabel(engine)}
                                  <span className="font-data text-[11px] text-muted-foreground">#{engine.externalEngineId}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </fieldset>
                ))}
              <Button type="button" size="sm" onClick={() => void handleSave()} disabled={busy !== null}>
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                {T.save}
              </Button>
            </div>
          )}
        </div>
      )}

      {importing && (
        <RankImport
          siteId={siteId}
          onDone={() => {
            router.refresh();
          }}
          onClose={() => setImporting(false)}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {providers.length > 0 && !connecting && (
          <Button type="button" size="sm" variant="outline" onClick={() => setConnecting(true)} disabled={busy !== null}>
            <Plug className="size-3.5" aria-hidden />
            {T.connect}
          </Button>
        )}
        {!importing && (
          <Button type="button" size="sm" variant="outline" onClick={() => setImporting(true)} disabled={busy !== null}>
            <Upload className="size-3.5" aria-hidden />
            {RANK_UI.import.button}
          </Button>
        )}
        {hasSynced && (
          <Button type="button" size="sm" variant="outline" onClick={() => void handleSync()} disabled={busy !== null}>
            {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            {T.sync}
          </Button>
        )}
      </div>

      {message && <p className="mt-3 text-xs text-success">{message}</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
