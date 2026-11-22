"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { pendingNote, waitForJob } from "@/lib/jobs/client";
import { YANDEX_UI } from "@/lib/yandex/messages";

const T = YANDEX_UI.site;

type Host = { hostId: string; unicodeUrl: string; asciiUrl: string; verified: boolean };
type Counter = { id: string; name: string; site: string };
type Goal = { id: string; name: string; type: string };

export type SiteLinkState = {
  webmasterHostId: string | null;
  webmasterHostUrl: string | null;
  metrikaCounterId: string | null;
  metrikaCounterName: string | null;
  goals: { id: string; name: string }[];
  webmasterSyncedAt: string | null;
  metrikaSyncedAt: string | null;
  webmasterError: string | null;
  metrikaError: string | null;
};

const SELECT_CLASS =
  "w-full max-w-[420px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none";

/**
 * Site settings > Yandex (agency fork): the Webmaster host and the Metrika
 * counter of the site, picked from the account's own lists (read live, the
 * one matching the domain is preselected), the goals to track, and Sync now.
 */
export function YandexSiteSection({
  siteId,
  domain,
  connected,
  initial,
}: {
  siteId: string;
  domain: string;
  connected: boolean;
  initial: SiteLinkState;
}) {
  const router = useRouter();
  const [link, setLink] = useState(initial);
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [counters, setCounters] = useState<Counter[] | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [hostId, setHostId] = useState(initial.webmasterHostId ?? "");
  const [counterId, setCounterId] = useState(initial.metrikaCounterId ?? "");
  const [goalIds, setGoalIds] = useState<string[]>(initial.goals.map((g) => g.id));
  const [suggested, setSuggested] = useState<{ host: string | null; counter: string | null }>({ host: null, counter: null });
  const [busy, setBusy] = useState<"load" | "save" | "sync" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!connected) {
    return (
      <p className="panel px-5 py-4 text-sm text-muted-foreground">
        {T.notConnected}{" "}
        <Link href="/settings#connections" className="text-link font-medium">
          {T.connectLink}
        </Link>
      </p>
    );
  }

  async function loadGoals(id: string) {
    setGoals(null);
    if (!id) return;
    const res = await fetch(`/api/user/yandex/counters?counterId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setGoals(data.goals);
  }

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const q = `?domain=${encodeURIComponent(domain)}`;
      const [h, c] = await Promise.all([fetch(`/api/user/yandex/hosts${q}`), fetch(`/api/user/yandex/counters${q}`)]);
      const [hd, cd] = await Promise.all([h.json(), c.json()]);
      // One service may be refused (no access) while the other answers.
      const errors = [!h.ok && hd.error, !c.ok && cd.error].filter(Boolean);
      if (h.ok) setHosts(hd.hosts);
      if (c.ok) setCounters(cd.counters);
      setSuggested({ host: h.ok ? hd.suggested : null, counter: c.ok ? cd.suggested : null });
      if (h.ok && !hostId && hd.suggested) setHostId(hd.suggested);
      const counter = counterId || (c.ok ? cd.suggested : null) || "";
      if (c.ok && !counterId && cd.suggested) setCounterId(cd.suggested);
      if (counter) await loadGoals(counter);
      if (errors.length) setError(errors.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function runJob(jobId: string) {
    const job = await waitForJob(jobId, {
      onUpdate: (j) => setMessage(pendingNote(j) ?? (j.status === "RUNNING" ? T.syncing : T.queued)),
    });
    if (job.waiting) {
      setMessage(null);
      setError(pendingNote(job));
      return;
    }
    if (job.status === "FAILED") throw new Error(job.lastError || "Sync failed");
    const r = (job.result ?? {}) as { webmasterDays?: number; queryWeeks?: number; metrikaDays?: number; failed?: string[] };
    setMessage(T.synced(r));
    if (r.failed?.length) setError(T.partly(r.failed));
    router.refresh();
  }

  async function save() {
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/yandex`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webmasterHostId: hostId || null, metrikaCounterId: counterId || null, goalIds: counterId ? goalIds : [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setLink(data.link);
      setMessage(data.jobId ? T.saved : T.savedNoSync);
      router.refresh();
      if (data.jobId) await runJob(data.jobId);
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/yandex/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      await runJob(data.jobId);
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  const linked = !!(link.webmasterHostId || link.metrikaCounterId);
  const loaded = hosts !== null || counters !== null;

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] leading-5 font-semibold text-text-strong">{T.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{T.description}</p>
        </div>
        <span
          className={
            linked
              ? "mono-label flex shrink-0 items-center gap-1.5 rounded-md border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] text-success"
              : "mono-label flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
          }
        >
          {linked ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {linked ? YANDEX_UI.connection.connected : YANDEX_UI.connection.notConnected}
        </span>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{T.host}</dt>
          <dd className="font-medium text-text-strong">
            {link.webmasterHostUrl ?? T.none}
            {link.webmasterHostId && (
              <span className="ml-2 font-data text-[12px] font-normal text-muted-foreground">
                {link.webmasterSyncedAt ? formatDay(link.webmasterSyncedAt, { time: true }) : T.never}
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{T.counter}</dt>
          <dd className="font-medium text-text-strong">
            {link.metrikaCounterId ? `${link.metrikaCounterName ?? ""} (${link.metrikaCounterId})` : T.none}
            {link.metrikaCounterId && (
              <span className="ml-2 font-data text-[12px] font-normal text-muted-foreground">
                {link.metrikaSyncedAt ? formatDay(link.metrikaSyncedAt, { time: true }) : T.never}
              </span>
            )}
          </dd>
        </div>
        {link.goals.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{T.goals}</dt>
            <dd className="text-right text-text-strong">{link.goals.map((g) => g.name).join(", ")}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 space-y-3">
        {!loaded ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={load} disabled={busy !== null}>
              {busy === "load" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {busy === "load" ? T.loading : T.load}
            </Button>
            {linked && (
              <Button type="button" size="sm" variant="outline" onClick={sync} disabled={busy !== null}>
                {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                {T.sync}
              </Button>
            )}
          </div>
        ) : (
          <>
            {hosts && (
              <label className="block space-y-1">
                <span className="text-[13px] font-medium text-text-strong">{T.host}</span>
                <select className={SELECT_CLASS} value={hostId} onChange={(e) => setHostId(e.target.value)}>
                  <option value="">{T.none}</option>
                  {hosts.map((h) => (
                    <option key={h.hostId} value={h.hostId}>
                      {h.unicodeUrl || h.asciiUrl}
                      {h.hostId === suggested.host ? ` (${T.suggested})` : ""}
                      {h.verified ? "" : ` (${T.unverified})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {counters && (
              <label className="block space-y-1">
                <span className="text-[13px] font-medium text-text-strong">{T.counter}</span>
                <select
                  className={SELECT_CLASS}
                  value={counterId}
                  onChange={(e) => {
                    setCounterId(e.target.value);
                    setGoalIds([]);
                    void loadGoals(e.target.value).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
                  }}
                >
                  <option value="">{T.none}</option>
                  {counters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.site} ({c.id}){c.site && c.name ? `, ${c.site}` : ""}
                      {c.id === suggested.counter ? ` (${T.suggested})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {counterId && goals && (
              <fieldset className="space-y-1">
                <legend className="text-[13px] font-medium text-text-strong">{T.goals}</legend>
                {goals.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{T.noGoals}</p>
                ) : (
                  <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                    {goals.map((g) => (
                      <label key={g.id} className="flex items-center gap-2 text-[13px] text-text-strong">
                        <input
                          type="checkbox"
                          checked={goalIds.includes(g.id)}
                          onChange={(e) =>
                            setGoalIds((ids) => (e.target.checked ? [...ids, g.id] : ids.filter((id) => id !== g.id)))
                          }
                        />
                        <span className="truncate">{g.name || g.id}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={save} disabled={busy !== null}>
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                {T.save}
              </Button>
              {linked && (
                <Button type="button" size="sm" variant="outline" onClick={sync} disabled={busy !== null}>
                  {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                  {T.sync}
                </Button>
              )}
            </div>
          </>
        )}
        {message && <p className="text-xs text-success">{message}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
