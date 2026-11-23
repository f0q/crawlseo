"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { MAX_NOTE_BODY, NOTE_KINDS } from "@/lib/projects/schema";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, textareaClass, useAction } from "./ui";
import { useTimeZone } from "@/components/timezone-provider";

const T = M.notes;

export type NoteItem = { id: string; kind: string; title: string; body: string; version: number; updatedBy: string; updatedAt: string };
type Version = { version: number; title: string; body: string; updatedBy: string; createdAt: string };

const kindLabel = (k: string) => (M.labels.noteKind as Record<string, string>)[k] ?? k;
const when = (iso: string, timeZone: string) => formatDay(new Date(iso), { year: true, timeZone });

/**
 * The project's markdown notes: pick one to edit, or start a new one. A save
 * sends the version it was made on, so a change made meanwhile (by a
 * colleague or the agent) is not overwritten. Earlier versions can be put
 * back into the editor.
 */
export function NotesSection({ slug, notes, canEdit }: { slug: string; notes: NoteItem[]; canEdit: boolean }) {
  const [selected, setSelected] = useState<string | null>(notes[0]?.id ?? null);
  const current = notes.find((n) => n.id === selected) ?? null;
  return (
    <Section title={T.title} description={T.description}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        <nav aria-label={T.title} className="flex flex-col gap-1">
          {notes.length === 0 && <p className="text-[13px] text-muted-foreground">{T.empty}</p>}
          {notes.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSelected(n.id)}
              aria-current={n.id === selected ? "true" : undefined}
              className={cn(
                "flex flex-col items-start rounded-md px-2.5 py-2 text-left transition-colors",
                n.id === selected ? "bg-border-soft text-text-strong" : "text-muted-foreground hover:bg-bg-section hover:text-text-strong"
              )}
            >
              <span className="mono-label text-[11px]">{kindLabel(n.kind)}</span>
              <span className="text-[14px]">{n.title}</span>
            </button>
          ))}
          {canEdit && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setSelected(null)}>
              {T.newNote}
            </Button>
          )}
        </nav>
        <NoteEditor key={current ? `${current.id}:${current.version}` : "new"} slug={slug} note={current} canEdit={canEdit} onCreated={setSelected} />
      </div>
    </Section>
  );
}

function NoteEditor({ slug, note, canEdit, onCreated }: { slug: string; note: NoteItem | null; canEdit: boolean; onCreated: (id: string) => void }) {
  const timeZone = useTimeZone();
  const [kind, setKind] = useState(note?.kind ?? "brief");
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<Version[] | null>(null);
  const { busy, error, run } = useAction();

  if (!note && !canEdit) return <p className="text-[13px] text-muted-foreground">{T.pick}</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const r = note
      ? await run("save", () =>
          send<{ note: NoteItem; changed: boolean }>(projectUrl(slug, "notes", note.id), "PATCH", { kind, title, body, baseVersion: note.version })
        )
      : await run("save", () => send<{ note: NoteItem; changed: boolean }>(projectUrl(slug, "notes"), "POST", { kind, title, body }));
    if (!r) return;
    setMessage(r.changed ? T.saved(r.note.version) : T.unchanged);
    if (!note) onCreated(r.note.id);
  }

  async function toggleHistory() {
    if (history) return setHistory(null);
    if (!note) return;
    const r = await run("history", () => send<{ note: { versions: Version[] } }>(projectUrl(slug, "notes", note.id)), { refresh: false });
    if (r) setHistory(r.note.versions);
  }

  async function remove() {
    if (!note || !window.confirm(T.deleteConfirm)) return;
    await run("delete", () => send(projectUrl(slug, "notes", note.id), "DELETE"));
  }

  return (
    <form onSubmit={save} className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
        <Field label={T.kind}>
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!canEdit}>
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={T.noteTitle}>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} disabled={!canEdit} />
        </Field>
      </div>
      <Field label={T.body}>
        <textarea
          className={cn(textareaClass, "font-data text-[13px]")}
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_BODY}
          readOnly={!canEdit}
        />
      </Field>
      {note && <p className="mono-label text-[11px] text-muted-foreground">{T.version(note.version, note.updatedBy, when(note.updatedAt, timeZone))}</p>}
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button type="submit" disabled={busy !== null}>
            {busy === "save" ? T.saving : T.save}
          </Button>
        )}
        {note && (
          <Button type="button" variant="outline" size="sm" onClick={toggleHistory} disabled={busy !== null}>
            {history ? T.hideHistory : T.history}
          </Button>
        )}
        {note && canEdit && (
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy !== null}>
            {T.delete}
          </Button>
        )}
        {message && <span className="text-[13px] text-success">{message}</span>}
      </div>
      {history && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {history.length === 0 && <p className="text-[13px] text-muted-foreground">{T.noHistory}</p>}
          {history.map((v) => (
            <details key={v.version} className="rounded-md border border-border-soft bg-bg-soft px-3 py-2">
              <summary className="cursor-pointer text-[13px] text-text-strong">{T.version(v.version, v.updatedBy, when(v.createdAt, timeZone))}</summary>
              <pre className="mt-2 max-h-80 overflow-auto font-data text-[12px] whitespace-pre-wrap text-muted-foreground">{v.body}</pre>
              {canEdit && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  title={T.restoreHint}
                  onClick={() => {
                    setTitle(v.title);
                    setBody(v.body);
                  }}
                >
                  {T.restore}
                </Button>
              )}
            </details>
          ))}
        </div>
      )}
    </form>
  );
}
