"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/projects/schema";
import { cn } from "@/lib/utils";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, useAction } from "./ui";

const T = M.tasks;

export type TaskItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due: string | null;
  assignee: string | null;
  notes: string | null;
  externalKey: string | null;
};

/** The project's tasks by status; the status changes in place. */
export function TasksSection({ slug, tasks, canEdit }: { slug: string; tasks: TaskItem[]; canEdit: boolean }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const { busy, error, run } = useAction();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await run("add", () => send(projectUrl(slug, "tasks"), "POST", { title, priority, due: due || null, assignee: assignee || null }));
    if (r) {
      setTitle("");
      setDue("");
      setAssignee("");
    }
  }

  const sorted = [...tasks].sort((a, b) => TASK_STATUSES.indexOf(a.status as never) - TASK_STATUSES.indexOf(b.status as never));

  return (
    <Section title={T.title}>
      {canEdit && (
        <form onSubmit={add} className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_160px_160px_auto] md:items-end">
          <Field label={T.taskTitle}>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          </Field>
          <Field label={T.priority}>
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {M.labels.priority[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={T.due}>
            <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label={T.assignee}>
            <input className={inputClass} value={assignee} onChange={(e) => setAssignee(e.target.value)} maxLength={100} />
          </Field>
          <Button type="submit" variant="outline" disabled={busy !== null}>
            {busy === "add" ? T.adding : T.newTask}
          </Button>
        </form>
      )}
      <ErrorLine error={error} />
      {sorted.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{T.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sorted.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={cn("text-[14px] text-text-strong", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</p>
                <p className="mono-label text-[11px] text-muted-foreground">
                  {[
                    (M.labels.priority as Record<string, string>)[t.priority] ?? t.priority,
                    t.due && `${T.due} ${formatDay(t.due, { year: true })}`,
                    t.assignee,
                    t.externalKey && T.key(t.externalKey),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {t.notes && <p className="mt-1 text-[13px] whitespace-pre-wrap text-muted-foreground">{t.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={T.status}
                  className={`${inputClass} h-8 w-36`}
                  value={t.status}
                  disabled={!canEdit || busy !== null}
                  onChange={(e) => run(t.id, () => send(projectUrl(slug, "tasks", t.id), "PATCH", { status: e.target.value }))}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {M.labels.taskStatus[s]}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy !== null}
                    onClick={() => window.confirm(T.deleteConfirm) && run(t.id, () => send(projectUrl(slug, "tasks", t.id), "DELETE"))}
                  >
                    {T.delete}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
