"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDay } from "@/lib/format";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { useTimeZone } from "@/components/timezone-provider";

const T = YANDEX_UI.connection;

export type YandexConnectionState = {
  configured: boolean;
  connected: boolean;
  login: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
  /** https://oauth.yandex.ru/authorize?... with this instance's client id, or null when not configured. */
  authorizeUrl: string | null;
};

const INPUT_CLASS =
  "w-full max-w-[260px] rounded-lg border border-border bg-background px-3 py-2 font-data text-sm text-foreground focus:border-brand-500 focus:bg-bg focus:outline-none aria-invalid:border-danger";

/**
 * Settings > Connections > Yandex (agency fork). The OAuth app is of the "API
 * access" type, whose redirect is Yandex's own verification_code page:
 * Connect opens Yandex in a new tab, Yandex shows a code, the user pastes it
 * here and the server exchanges it for tokens.
 */
export function YandexConnectionRow({ initial }: { initial: YandexConnectionState }) {
  const timeZone = useTimeZone();
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = !state.configured ? T.notConfigured : state.connected ? T.connected : T.notConnected;

  function openYandex() {
    if (!state.authorizeUrl) return;
    window.open(state.authorizeUrl, "_blank", "noopener,noreferrer");
    setExpanded(true);
  }

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError(YANDEX_UI.errors.badCode);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/yandex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      setState((s) => ({ ...s, ...data, connected: true }));
      setExpanded(false);
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const detail = state.connected
    ? [
        state.login ? T.as(state.login) : T.asUnknown,
        state.expiresAt ? T.expires(formatDay(state.expiresAt, { year: true, timeZone })) : null,
        state.connectedAt ? T.since(formatDay(state.connectedAt, { year: true, timeZone })) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <li className="px-5 py-4" data-provider="yandex">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-soft text-text-strong">
            <BarChart3 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-[15px] leading-5 font-medium text-text-strong">{T.name}</h3>
              <span
                className={
                  state.connected
                    ? "mono-label inline-flex shrink-0 items-center rounded-md border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] leading-4 text-success"
                    : "mono-label inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground"
                }
              >
                {badge}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{T.description}</p>
            {detail && <p className="mt-1 font-data text-[12px] leading-4 text-muted-foreground">{detail}</p>}
            {!state.configured && <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{T.notConfiguredHelp}</p>}
          </div>
        </div>
        {state.configured && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[50px] sm:pl-0">
            <Button size="sm" variant={state.connected ? "outline" : "default"} onClick={openYandex}>
              <ExternalLink className="size-3.5" aria-hidden />
              {state.connected ? T.reconnect : T.connect}
            </Button>
            {state.connected && (
              <DisconnectYandexDialog
                onDone={() => {
                  setState((s) => ({ ...s, connected: false, login: null, expiresAt: null, connectedAt: null }));
                  router.refresh();
                }}
              />
            )}
          </div>
        )}
      </div>

      {expanded && state.configured && (
        <form onSubmit={submit} className="mt-4 max-w-[560px] space-y-2 pl-[50px]">
          <p className="text-[13px] leading-5 text-muted-foreground">{T.step1}</p>
          <p className="text-[13px] leading-5 text-muted-foreground">{T.step2}</p>
          <label className="block text-[13px] font-medium text-text-strong" htmlFor="yandex-code">
            {T.codeLabel}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="yandex-code"
              className={INPUT_CLASS}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
              aria-invalid={error ? true : undefined}
            />
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {saving ? T.saving : T.submit}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setExpanded(false)}>
              {T.cancel}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}

function DisconnectYandexDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/user/yandex", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setOpen(false);
      onDone();
    } catch {
      setError("Yandex could not be disconnected. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{T.disconnect}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{T.confirmDisconnect}?</DialogTitle>
          <DialogDescription>{T.disconnectNote}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button type="button" variant="outline" disabled={deleting} />}>{T.cancel}</DialogClose>
          <Button type="button" variant="destructive" disabled={deleting} onClick={disconnect}>
            {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {T.disconnect}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
