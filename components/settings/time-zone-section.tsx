"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { COMMON_TIME_ZONES, timeZoneOffsetLabel } from "@/lib/timezone";
import { saveTimeZoneAction } from "@/app/(dashboard)/settings/time-zone-actions";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:bg-bg focus:outline-none disabled:opacity-60 sm:w-80";

const COMMON = new Set<string>(COMMON_TIME_ZONES);

/**
 * Agency fork: Settings > Time zone. Date-times across the app are shown in
 * this zone; they are stored in UTC, and calendar days (Search Console days,
 * journal dates) are never shifted. `options` comes from the server, so the
 * list is the same in the server render and the browser.
 */
export function TimeZoneSection({ initial, options }: { initial: string; options: string[] }) {
  const id = useId();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [filter, setFilter] = useState("");
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
    } catch {
      setBrowserZone(null);
    }
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase().replaceAll(" ", "_");
    const list = q ? options.filter((z) => z.toLowerCase().includes(q)) : options;
    return list.includes(value) ? list : [value, ...list];
  }, [filter, options, value]);
  const common = shown.filter((z) => COMMON.has(z) || z === value);
  const rest = shown.filter((z) => !common.includes(z));
  // One offset lookup per zone, not per render.
  const labels = useMemo(() => new Map(options.map((z) => [z, `${z.replaceAll("_", " ")} (${timeZoneOffsetLabel(z)})`])), [options]);
  const label = (z: string) => labels.get(z) ?? `${z.replaceAll("_", " ")} (${timeZoneOffsetLabel(z)})`;

  async function save(zone: string) {
    setSaving(true);
    setMessage(null);
    try {
      const r = await saveTimeZoneAction(zone);
      if (r.ok) {
        setSaved(zone);
        setValue(zone);
        setMessage({ ok: true, text: `Saved. Times are now shown in ${zone.replaceAll("_", " ")}.` });
        router.refresh();
      } else {
        setMessage({ ok: false, text: r.error ?? "Could not save the time zone." });
      }
    } catch {
      setMessage({ ok: false, text: "Could not save the time zone. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Now: <span className="font-data text-text-strong" suppressHydrationWarning>{formatDay(new Date(), { year: true, time: true, timeZone: saved })}</span> in{" "}
            {label(saved)}. Stored times stay in UTC; Search Console days and journal dates are shown as they are.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1" htmlFor={`${id}-filter`}>
            <span className="mono-label text-[11px] text-muted-foreground">Find</span>
            <input
              id={`${id}-filter`}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="City or region, e.g. Moscow"
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1" htmlFor={`${id}-zone`}>
            <span className="mono-label text-[11px] text-muted-foreground">Time zone</span>
            <select id={`${id}-zone`} value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} className={INPUT_CLASS}>
              {common.length > 0 && (
                <optgroup label="Common">
                  {common.map((z) => (
                    <option key={z} value={z} suppressHydrationWarning>
                      {label(z)}
                    </option>
                  ))}
                </optgroup>
              )}
              {rest.length > 0 && (
                <optgroup label="All zones">
                  {rest.map((z) => (
                    <option key={z} value={z} suppressHydrationWarning>
                      {label(z)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <Button type="submit" disabled={saving || value === saved}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save
          </Button>
        </div>
        {browserZone && browserZone !== saved && options.includes(browserZone) && (
          <p className="text-[13px] text-muted-foreground">
            This browser is in {label(browserZone)}.{" "}
            <button type="button" className="text-link font-medium" disabled={saving} onClick={() => void save(browserZone)}>
              Use it
            </button>
          </p>
        )}
        {message && (
          <p role="status" className={message.ok ? "text-[13px] text-success" : "text-[13px] text-danger"}>
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
}
