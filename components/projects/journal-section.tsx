"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { todayIn } from "@/lib/timezone";
import { useTimeZone } from "@/components/timezone-provider";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, textareaClass, useAction } from "./ui";

const T = M.journal;

export type EntryItem = { id: string; date: string; text: string; link: string | null; author: string; authorKind: string; siteId: string | null };

/** The project's journal, newest first, and a form to add a line. */
export function JournalSection({
  slug,
  entries,
  sites,
  canEdit,
}: {
  slug: string;
  entries: EntryItem[];
  sites: { id: string; domain: string }[];
  canEdit: boolean;
}) {
  // Agency fork: a new entry is dated today in the user's display zone.
  const timeZone = useTimeZone();
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [siteId, setSiteId] = useState("");
  const { busy, error, run } = useAction();
  const domainOf = new Map(sites.map((s) => [s.id, s.domain]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await run("add", () => send(projectUrl(slug, "journal"), "POST", { date, text, link: link || null, siteId: siteId || null }));
    if (r) {
      setText("");
      setLink("");
    }
  }

  return (
    <Section title={T.title} description={T.description}>
      {canEdit && (
        <form onSubmit={add} className="mb-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_200px]">
            <Field label={T.date}>
              <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={T.link}>
              <input className={inputClass} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
            </Field>
            <Field label={T.site}>
              <select className={inputClass} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">{T.noSite}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.domain}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={T.text}>
            <textarea className={textareaClass} rows={2} value={text} onChange={(e) => setText(e.target.value)} required maxLength={5000} />
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={busy !== null}>
              {busy === "add" ? T.adding : T.add}
            </Button>
          </div>
        </form>
      )}
      <ErrorLine error={error} />
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{T.empty}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="mono-label flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {formatDay(e.date, { year: true })} · {e.author}
                  {e.authorKind === "agent" && <Bot className="size-3.5" aria-label={T.agent} />}
                  {e.siteId && domainOf.get(e.siteId) ? ` · ${domainOf.get(e.siteId)}` : ""}
                </p>
                <p className="mt-0.5 text-[14px] whitespace-pre-wrap text-text-strong">{e.text}</p>
                {e.link && (
                  <a href={e.link} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] break-all text-link hover:underline">
                    {e.link}
                  </a>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => window.confirm(T.deleteConfirm) && run(e.id, () => send(projectUrl(slug, "journal", e.id), "DELETE"))}
                >
                  {T.delete}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
