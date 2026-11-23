"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import {
  GROUP_DRAFT_IDLE,
  groupOptions,
  MAX_GROUP_NAME,
  stepGroupDraft,
  type GroupDraft,
  type GroupDraftEvent,
  type GroupOption,
} from "@/lib/projects/group-names";
import { inputClass, projectUrl, send } from "./ui";

const T = M.groups;

const TRIGGER_CLASS =
  "flex h-[38px] w-full items-center justify-between gap-2 rounded-md border border-border bg-bg-section px-3 text-[14px] text-text-strong transition-colors outline-none hover:border-line-strong focus-visible:border-brand-500 focus-visible:bg-bg disabled:cursor-not-allowed disabled:opacity-60 data-popup-open:border-line-strong";
const POPUP_CLASS =
  "max-h-[min(360px,var(--available-height))] w-[var(--anchor-width)] min-w-[220px] max-w-[360px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-3)] outline-none";
const ITEM_CLASS =
  "flex h-9 w-full cursor-default items-center gap-2.5 rounded-sm px-2.5 text-[13px] text-text-strong outline-none select-none data-highlighted:bg-bg-section";
const ICON_BUTTON =
  "inline-flex size-[38px] shrink-0 items-center justify-center rounded-md border border-border text-text-strong transition-colors outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/** "No group" in the radio group: a group name is never empty. */
const NONE = "";

export type GroupSelectProps = {
  value: string | null;
  groups: readonly GroupOption[];
  /** The picked group, null for No group. A new name that matches a group comes as that group's spelling. */
  onChange: (group: string | null) => void;
  disabled?: boolean;
  /** The id of the visible label, for the trigger and the new-group input. */
  labelledBy?: string;
  className?: string;
};

/**
 * Agency fork: the group picker. A menu with No group, the existing groups
 * (with their project counts) and "New group…", which turns into a text
 * input: Enter or the check button confirms, Escape or the cross cancels.
 * The input's keys stop there, so Enter never submits a surrounding form.
 */
export function GroupSelect({ value, groups, onChange, disabled = false, labelledBy, className }: GroupSelectProps) {
  const [draft, setDraft] = useState<GroupDraft>(GROUP_DRAFT_IDLE);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasNew = useRef(false);
  const valueId = useId();
  const options = groupOptions(value, groups);

  // Focus follows the mode: into the input when it opens, back to the trigger when it closes.
  useEffect(() => {
    const target = draft.mode === "new" ? inputRef.current : wasNew.current ? triggerRef.current : null;
    wasNew.current = draft.mode === "new";
    if (!target) return;
    const t = setTimeout(() => target.focus(), 0);
    return () => clearTimeout(t);
  }, [draft.mode]);

  function apply(event: GroupDraftEvent): boolean {
    const r = stepGroupDraft(draft, event, options.map((g) => g.name));
    setDraft(r.draft);
    if (r.commit !== undefined && r.commit !== value) onChange(r.commit);
    return r.handled === true;
  }

  if (draft.mode === "new") {
    const errorId = labelledBy ? `${labelledBy}-error` : undefined;
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            className={inputClass}
            value={draft.text}
            onChange={(e) => apply({ type: "type", text: e.target.value })}
            onKeyDown={(e) => {
              if (apply({ type: "key", key: e.key })) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            maxLength={MAX_GROUP_NAME}
            placeholder={T.newGroupPlaceholder}
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : T.newGroupPlaceholder}
            aria-invalid={draft.error ? true : undefined}
            aria-describedby={draft.error ? errorId : undefined}
            autoComplete="off"
            disabled={disabled}
          />
          <button type="button" className={ICON_BUTTON} onClick={() => apply({ type: "confirm" })} aria-label={T.create} title={T.create} disabled={disabled}>
            <Check className="size-4" aria-hidden />
          </button>
          <button type="button" className={ICON_BUTTON} onClick={() => apply({ type: "cancel" })} aria-label={T.cancel} title={T.cancel} disabled={disabled}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {draft.error && (
          <p id={errorId} role="alert" className="text-[12px] leading-4 text-danger">
            {draft.error}
          </p>
        )}
      </div>
    );
  }

  const label = value ?? T.noGroup;
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        disabled={disabled}
        aria-label={labelledBy ? undefined : T.picker(label)}
        aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined}
        className={cn(TRIGGER_CLASS, className)}
      >
        <span id={valueId} className={cn("min-w-0 truncate", value === null && "text-muted-foreground")}>{label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50 outline-none">
          <Menu.Popup className={POPUP_CLASS}>
            <Menu.RadioGroup
              value={value ?? NONE}
              onValueChange={(next: string) => {
                const group = next === NONE ? null : next;
                if (group !== value) onChange(group);
              }}
            >
              <Menu.RadioItem value={NONE} closeOnClick className={ITEM_CLASS}>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{T.noGroup}</span>
                <Menu.RadioItemIndicator>
                  <Check className="size-3.5 shrink-0" aria-hidden />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
              {options.map((g) => (
                <Menu.RadioItem key={g.name} value={g.name} label={g.name} closeOnClick className={ITEM_CLASS}>
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  <span className="font-data text-[12px] text-muted-foreground" aria-label={T.count(g.count)}>
                    {g.count}
                  </span>
                  <span className="flex w-3.5 shrink-0 justify-center">
                    <Menu.RadioItemIndicator>
                      <Check className="size-3.5" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            <Menu.Item onClick={() => apply({ type: "new" })} className={ITEM_CLASS}>
              <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {T.newGroup}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

/**
 * The group of one project, saved as soon as it is picked (PATCH of the
 * project), with a small saving / saved / error line. Then the page is
 * refreshed, so the switcher and the lists follow. A viewer sees the name.
 */
export function ProjectGroupPicker({
  slug,
  value,
  groups,
  canEdit,
  labelledBy,
  className,
}: {
  slug: string;
  value: string | null;
  groups: readonly GroupOption[];
  canEdit: boolean;
  labelledBy?: string;
  className?: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  const [seen, setSeen] = useState(value);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // A refresh brings the saved value back from the server: follow it.
  if (value !== seen) {
    setSeen(value);
    setCurrent(value);
  }

  if (!canEdit) {
    return <span className={cn("text-[14px]", value ? "text-text-strong" : "text-muted-foreground")}>{value ?? T.noGroup}</span>;
  }

  async function change(next: string | null) {
    const before = current;
    setCurrent(next);
    setState({ kind: "saving" });
    try {
      const r = await send<{ project: { group: string | null } }>(projectUrl(slug), "PATCH", { group: next });
      setCurrent(r.project.group);
      setState({ kind: "saved" });
      router.refresh();
    } catch (err) {
      setCurrent(before);
      setState({ kind: "error", message: err instanceof Error ? err.message : M.common.error });
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <GroupSelect value={current} groups={groups} onChange={change} disabled={state.kind === "saving"} labelledBy={labelledBy} />
      <p aria-live="polite" className={cn("min-h-4 text-[12px] leading-4", state.kind === "error" ? "text-danger" : state.kind === "saved" ? "text-success" : "text-muted-foreground")}>
        {state.kind === "saving" ? T.saving : state.kind === "saved" ? T.saved : state.kind === "error" ? state.message : null}
      </p>
    </div>
  );
}
