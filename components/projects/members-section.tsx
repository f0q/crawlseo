"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { ROLES } from "@/lib/projects/schema";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, useAction } from "./ui";

const T = M.members;

type Member = { userId: string; email: string; name: string | null; role: string };

/** Members and their roles; owners add, change and remove them, anyone can leave. */
export function MembersSection({ slug, members, me, isOwner }: { slug: string; members: Member[]; me: string; isOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const { busy, error, run } = useAction();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await run("add", () => send(projectUrl(slug, "members"), "POST", { email, role }));
    if (r) setEmail("");
  }

  async function remove(userId: string) {
    const r = await run(userId, () => send(projectUrl(slug, "members", userId), "DELETE"), { refresh: userId !== me });
    if (r && userId === me) router.push("/projects");
  }

  return (
    <Section title={T.title} description={T.description}>
      <ul className="flex flex-col divide-y divide-border">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 truncate text-[14px] text-text-strong">
              {m.name ? `${m.name} · ` : ""}
              <span className="font-data">{m.email}</span>
              {m.userId === me && <span className="text-muted-foreground"> ({T.you})</span>}
            </span>
            <span className="flex items-center gap-2">
              {isOwner ? (
                <select
                  aria-label={T.role}
                  className={`${inputClass} h-8 w-32`}
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) => run(m.userId, () => send(projectUrl(slug, "members", m.userId), "PATCH", { role: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {M.labels.role[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="mono-label text-[11px] text-muted-foreground">{(M.labels.role as Record<string, string>)[m.role] ?? m.role}</span>
              )}
              {(isOwner || m.userId === me) && (
                <Button variant="ghost" size="xs" disabled={busy !== null} onClick={() => remove(m.userId)}>
                  {m.userId === me ? T.leave : T.remove}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <form onSubmit={add} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={T.email} className="flex-1">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={T.role}>
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {M.labels.role[r]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="outline" disabled={busy !== null}>
            {busy === "add" ? T.adding : T.add}
          </Button>
        </form>
      )}
      <div className="mt-3">
        <ErrorLine error={error} />
      </div>
    </Section>
  );
}

/** Deletes the project after a confirmation; owners only. */
export function DeleteProjectButton({ slug }: { slug: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  async function remove() {
    if (!window.confirm(M.detail.deleteConfirm)) return;
    const r = await run("delete", () => send(projectUrl(slug), "DELETE"), { refresh: false });
    if (r) {
      router.push("/projects");
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="destructive" size="sm" onClick={remove} disabled={busy !== null}>
        {busy ? M.detail.deleting : M.detail.deleteProject}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}
