"use client";

import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { MAX_GROUP_NAME, resolveGroupName } from "@/lib/projects/group-names";
import { ErrorLine, inputClass, send, useAction } from "./ui";

const T = M.groups;

const POPUP_CLASS =
  "min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-3)] outline-none";
const ITEM_CLASS =
  "flex h-9 w-full cursor-default items-center rounded-sm px-2.5 text-[13px] text-text-strong outline-none select-none data-highlighted:bg-bg-section";

export const GROUPS_API = "/api/projects/_groups";

type Mode = "idle" | "rename" | "ungroup";

/**
 * Agency fork: a group's name with Rename and Ungroup, on the projects list
 * (a "⋯" menu next to the heading) and on the Groups page (buttons). Both
 * act on the projects of the group the user owns or edits; the page is
 * refreshed afterwards, so every list and the switcher follow.
 */
export function GroupTitle({
  name,
  count,
  shown,
  editable,
  variant,
  level = 2,
  className,
}: {
  name: string;
  /** Projects of the group the user sees. */
  count: number;
  /** The number in the heading, when the list shows only some of them (the projects home). */
  shown?: number;
  /** Projects of the group the user may change; 0 shows the name only. */
  editable: number;
  variant: "menu" | "buttons";
  level?: 2 | 3;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState(name);
  const { busy, error, setError, run } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const Heading = level === 2 ? "h2" : "h3";
  const readOnly = count - editable;

  useEffect(() => {
    if (mode === "rename") inputRef.current?.select();
  }, [mode]);

  function open(next: Mode) {
    setError(null);
    setText(name);
    setMode(next);
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const to = resolveGroupName(text, []);
    if (!to) return setError(T.errors.nameEmpty);
    if (to === name) return setMode("idle");
    const r = await run("rename", () => send(`${GROUPS_API}/rename`, "POST", { from: name, to }));
    if (r) setMode("idle");
  }

  async function ungroup() {
    const r = await run("ungroup", () => send(`${GROUPS_API}/ungroup`, "POST", { name }));
    if (r) setMode("idle");
  }

  const title = (
    <Heading className="flex min-w-0 items-center gap-2 text-[15px] font-medium text-text-strong">
      <span className="truncate">{name}</span> <span className="font-data text-[12px] text-muted-foreground">{shown ?? count}</span>
    </Heading>
  );

  if (mode === "rename") {
    return (
      <form onSubmit={rename} className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            className={cn(inputClass, "w-auto min-w-0 flex-1 basis-48")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setMode("idle");
              }
            }}
            maxLength={MAX_GROUP_NAME}
            aria-label={T.renameLabel(name)}
            disabled={busy !== null}
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={busy !== null}>
            {T.renameSave}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")} disabled={busy !== null}>
            {T.cancel}
          </Button>
        </div>
        {readOnly > 0 && <p className="text-[12px] text-muted-foreground">{T.readOnly(readOnly)}</p>}
        <ErrorLine error={error} />
      </form>
    );
  }

  if (mode === "ungroup") {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        {title}
        <div role="group" aria-label={T.ungroup} className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-text-strong">{T.ungroupConfirm(editable)}</span>
          <Button type="button" size="sm" variant="destructive" onClick={ungroup} disabled={busy !== null} autoFocus>
            {T.ungroup}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")} disabled={busy !== null}>
            {T.cancel}
          </Button>
        </div>
        {readOnly > 0 && <p className="text-[12px] text-muted-foreground">{T.readOnly(readOnly)}</p>}
        <ErrorLine error={error} />
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {title}
      {editable > 0 &&
        (variant === "menu" ? (
          <Menu.Root>
            <Menu.Trigger
              aria-label={T.actions(name)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-bg-section hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-popup-open:bg-bg-section"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50 outline-none">
                <Menu.Popup className={POPUP_CLASS}>
                  <Menu.Item className={ITEM_CLASS} onClick={() => open("rename")}>
                    {T.rename}
                  </Menu.Item>
                  <Menu.Item className={cn(ITEM_CLASS, "text-danger")} onClick={() => open("ungroup")}>
                    {T.ungroup}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : (
          <div className="ml-auto flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => open("rename")} aria-label={`${T.rename} ${name}`}>
              {T.rename}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => open("ungroup")} aria-label={`${T.ungroup} ${name}`}>
              {T.ungroup}
            </Button>
          </div>
        ))}
    </div>
  );
}

/**
 * The Groups page's New group: a group exists only while a project is in it,
 * so a new group is a name and the projects to move into it. A name that
 * matches an existing group adds the projects to that group.
 */
export function NewGroupForm({ projects, groups }: { projects: { slug: string; name: string; group: string | null }[]; groups: string[] }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useAction();
  const target = resolveGroupName(text, groups);
  const joins = target !== null && groups.includes(target);

  function toggle(slug: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return setError(T.errors.nameEmpty);
    if (picked.size === 0) return setError(T.errors.noProjects);
    const r = await run("create", () => send(`${GROUPS_API}/assign`, "POST", { name: target, slugs: [...picked] }));
    if (r) {
      setText("");
      setPicked(new Set());
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="mono-label text-[11px] text-muted-foreground">{T.newName}</span>
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_GROUP_NAME} autoComplete="off" disabled={busy !== null} />
        {joins && <span className="text-[12px] leading-4 text-muted-foreground">{T.joins(target)}</span>}
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="mono-label mb-1 text-[11px] text-muted-foreground">{T.newProjects}</legend>
        <ul className="max-h-[280px] overflow-y-auto rounded-md border border-border">
          {projects.map((p) => (
            <li key={p.slug} className="border-b border-border last:border-b-0">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-bg-section">
                <input type="checkbox" checked={picked.has(p.slug)} onChange={() => toggle(p.slug)} disabled={busy !== null} className="size-4 accent-brand-500" />
                <span className="min-w-0 flex-1 truncate text-text-strong">{p.name}</span>
                {p.group && <span className="truncate text-[12px] text-muted-foreground">{T.inGroup(p.group)}</span>}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <ErrorLine error={error} />
      <div>
        <Button type="submit" disabled={busy !== null}>
          {busy ? T.creating : T.create}
        </Button>
      </div>
    </form>
  );
}
