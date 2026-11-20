"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { pendingNote, waitForJob } from "@/lib/jobs/client";
import { engineLabel, suggestLabrikaSites, type LabrikaSite } from "@/lib/labrika/labrika-parse";
import { LABRIKA_UI } from "@/lib/labrika/messages";
import type { LinkedEngine } from "@/lib/labrika/links";

const T = LABRIKA_UI.settings;

const keyOf = (siteUuid: string, engineId: string) => `${siteUuid}:${engineId}`;

/**
 * Site settings: which Labrika search engines feed this site. The projects
 * are read from Labrika on demand; the ones whose host is this site's domain
 * are listed first and preselected when nothing is linked yet.
 */
export function LabrikaSiteSection({
  siteId,
  domain,
  linked,
}: {
  siteId: string;
  domain: string;
  linked: LinkedEngine[];
}) {
  const router = useRouter();
  const [sites, setSites] = useState<LabrikaSite[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(linked.map((e) => keyOf(e.externalSiteId, e.externalEngineId)))
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { suggested, others } = useMemo(() => {
    const all = sites ?? [];
    const match = new Set(suggestLabrikaSites(domain, all).map((s) => s.siteUuid));
    return { suggested: all.filter((s) => match.has(s.siteUuid)), others: all.filter((s) => !match.has(s.siteUuid)) };
  }, [sites, domain]);

  async function loadSites() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/labrika/sites");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load Labrika projects");
      const list = data as LabrikaSite[];
      setSites(list);
      if (!list.length) setError(T.noProjects);
      // Nothing linked yet: preselect every engine of the projects on this domain.
      if (linked.length === 0) {
        const match = suggestLabrikaSites(domain, list);
        setSelected(new Set(match.flatMap((s) => s.engines.map((e) => keyOf(s.siteUuid, e.id)))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Labrika projects");
    } finally {
      setLoading(false);
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
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const engines = [...selected].map((key) => {
        const [siteUuid, engineId] = key.split(":");
        return { siteUuid, engineId };
      });
      const res = await fetch(`/api/sites/${siteId}/labrika`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setMessage(T.saved(data.added ?? 0, data.removed ?? 0));
      router.refresh();
      if (data.jobId) {
        setSyncing(true);
        await followJob(data.jobId);
        router.refresh();
      }
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
      setSyncing(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/labrika/sync`, { method: "POST" });
      const queued = await res.json();
      if (!res.ok) throw new Error(queued.error || "Sync failed");
      await followJob(queued.jobId);
      router.refresh();
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const busy = saving || syncing;

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] leading-5 font-semibold text-text-strong">{T.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{T.description}</p>
        </div>
        {linked.length ? (
          <span className="flex shrink-0 items-center gap-1.5 mono-label rounded-md border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] text-success">
            <CheckCircle2 className="size-3.5" />
            {T.connected}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 mono-label rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            <XCircle className="size-3.5" />
            {T.notConnected}
          </span>
        )}
      </div>

      {linked.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {linked.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-text-strong">
                {e.host} · {e.label}
              </span>
              <span className="mono-label text-[11px] text-muted-foreground">
                {e.lastSyncedAt ? T.syncedAt(formatDay(e.lastSyncedAt, { time: true })) : T.never}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sites && sites.length > 0 && (
        <div className="mt-4 space-y-4">
          {[
            { title: T.suggested, list: suggested },
            { title: T.otherProjects, list: others },
          ]
            .filter((group) => group.list.length > 0)
            .map((group) => (
              <fieldset key={group.title}>
                <legend className="mono-label mb-2 text-[11px] text-muted-foreground">{group.title}</legend>
                <div className="space-y-3">
                  {group.list.map((site) => (
                    <div key={site.siteUuid}>
                      <p className="text-sm font-medium text-text-strong">{site.host || site.title}</p>
                      <div className="mt-1 flex flex-col gap-1">
                        {site.engines.map((engine) => {
                          const key = keyOf(site.siteUuid, engine.id);
                          return (
                            <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                              <input
                                type="checkbox"
                                checked={selected.has(key)}
                                onChange={(ev) => toggle(key, ev.target.checked)}
                                className="size-4 accent-brand-500"
                              />
                              {engineLabel(engine)}
                              <span className="font-data text-[11px] text-muted-foreground">#{engine.id}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void loadSites()} disabled={loading || busy}>
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          {loading ? T.loading : T.load}
        </Button>

        {sites && (
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={busy}>
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            {T.save}
          </Button>
        )}

        {linked.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => void handleSync()} disabled={busy}>
            {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            {T.sync}
          </Button>
        )}
      </div>

      {message && <p className="mt-3 text-xs text-success">{message}</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
