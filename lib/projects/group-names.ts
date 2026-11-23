import { PROJECT_MESSAGES as M } from "./messages";

/*
 * Project groups (agency fork): `Project.group` is free text, so a group is
 * the set of projects with the same name. Names match ignoring case and
 * spacing ("centro  adelante " is "Centro Adelante"). Pure, so the group
 * picker and the server share the rules; the database side is ./groups.ts.
 */

export const MAX_GROUP_NAME = 80;

/** A group with the number of projects the viewer sees in it. */
export type GroupOption = { name: string; count: number };

export const tidyGroup = (name: string) => name.trim().replace(/\s+/g, " ");
export const groupKey = (name: string) => tidyGroup(name).toLocaleLowerCase();
export const sameGroup = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? groupKey(a) : "") === (b ? groupKey(b) : "");

/** The name a typed group resolves to: an existing group with the same key, else the tidied text; null when empty. */
export function resolveGroupName(typed: string, existing: readonly string[]): string | null {
  const tidy = tidyGroup(typed);
  if (!tidy) return null;
  return existing.find((g) => groupKey(g) === groupKey(tidy)) ?? tidy;
}

/** The picker's options: the existing groups by name, plus the current value when it is not among them. */
export function groupOptions(value: string | null, groups: readonly GroupOption[]): GroupOption[] {
  const list = [...groups];
  if (value && !list.some((g) => sameGroup(g.name, value))) list.push({ name: value, count: 1 });
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The "New group…" entry of the picker: picking from the list, or typing a new name. */
export type GroupDraft = { mode: "pick" | "new"; text: string; error: string | null };
export type GroupDraftEvent =
  | { type: "new" }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "confirm" }
  | { type: "cancel" };

export const GROUP_DRAFT_IDLE: GroupDraft = { mode: "pick", text: "", error: null };

/**
 * One step of the new-group input. Enter confirms, Escape cancels; `commit`
 * is the group to save (an existing group's spelling when the name matches
 * one), `handled` tells the caller to stop the key (so Enter does not submit
 * a surrounding form).
 */
export function stepGroupDraft(
  draft: GroupDraft,
  event: GroupDraftEvent,
  existing: readonly string[]
): { draft: GroupDraft; commit?: string; handled?: boolean } {
  switch (event.type) {
    case "new":
      return { draft: { mode: "new", text: "", error: null } };
    case "type":
      return { draft: { ...draft, text: event.text, error: null } };
    case "cancel":
      return { draft: GROUP_DRAFT_IDLE };
    case "key":
      if (draft.mode !== "new") return { draft };
      if (event.key === "Enter") return { ...stepGroupDraft(draft, { type: "confirm" }, existing), handled: true };
      if (event.key === "Escape") return { draft: GROUP_DRAFT_IDLE, handled: true };
      return { draft };
    case "confirm": {
      const name = resolveGroupName(draft.text, existing);
      if (!name) return { draft: { ...draft, error: M.groups.errors.nameEmpty } };
      if (name.length > MAX_GROUP_NAME) return { draft: { ...draft, error: M.groups.errors.nameTooLong(MAX_GROUP_NAME) } };
      return { draft: GROUP_DRAFT_IDLE, commit: name };
    }
  }
}
