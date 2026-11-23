import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { atLeast, projectFor, rolesOf, visibleProjects, type Actor } from "./access";
import { groupKey, MAX_GROUP_NAME, sameGroup, tidyGroup } from "./group-names";
import { PROJECT_MESSAGES as M } from "./messages";
import { zodMessage } from "./schema";
import { canonicalGroup } from "./service";

/*
 * Project groups (agency fork). A group is the projects with the same
 * `Project.group` (free text, matched ignoring case and spacing); there is no
 * table of groups, so a group with no project does not exist. Renaming,
 * ungrouping and moving projects change only the projects where the actor is
 * an owner or editor; the others keep their group.
 *
 *   GET  /projects/_groups           every group the actor sees: name, count, editable
 *   POST /projects/_groups/rename    { from, to }: renaming into an existing group merges
 *   POST /projects/_groups/ungroup   { name }
 *   POST /projects/_groups/assign    { name, slugs[] }: moves projects into a group (new or existing)
 */

export type GroupSummary = {
  name: string;
  /** Projects the actor sees in the group. */
  count: number;
  /** Of those, the ones the actor may change (owner or editor). */
  editable: number;
};

const name = z
  .string({ error: M.groups.errors.nameEmpty })
  .transform(tidyGroup)
  .pipe(z.string().min(1, M.groups.errors.nameEmpty).max(MAX_GROUP_NAME, M.groups.errors.nameTooLong(MAX_GROUP_NAME)));

const renameSchema = z.object({ from: name, to: name });
const ungroupSchema = z.object({ name });
const assignSchema = z.object({
  name,
  slugs: z.array(z.string().trim().min(1).max(64)).min(1, M.groups.errors.noProjects).max(500),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, zodMessage(r.error));
  return r.data;
}

/** The grouped projects the actor sees, with whether the actor may change each. */
async function groupedProjects(actor: Actor) {
  const rows = await db.project.findMany({
    where: { AND: [visibleProjects(actor), { group: { not: null } }] },
    select: { id: true, group: true },
  });
  const roles = await rolesOf(actor, rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, group: r.group!, canEdit: atLeast(roles.get(r.id) ?? "viewer", "editor") }));
}

/** Every group the actor sees, by name. Spellings that differ only in case or spacing count as one group. */
export async function listGroupSummaries(actor: Actor): Promise<GroupSummary[]> {
  const byKey = new Map<string, { spellings: Map<string, number>; count: number; editable: number }>();
  for (const p of await groupedProjects(actor)) {
    const g = byKey.get(groupKey(p.group)) ?? { spellings: new Map(), count: 0, editable: 0 };
    g.spellings.set(p.group, (g.spellings.get(p.group) ?? 0) + 1);
    g.count += 1;
    if (p.canEdit) g.editable += 1;
    byKey.set(groupKey(p.group), g);
  }
  return [...byKey.values()]
    .map((g) => ({
      // The spelling most projects use names the group.
      name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: g.count,
      editable: g.editable,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The projects of a group the actor may change; 404 when the actor sees none in it, 403 when they may change none. */
async function editableInGroup(actor: Actor, group: string) {
  const all = (await groupedProjects(actor)).filter((p) => sameGroup(p.group, group));
  if (all.length === 0) throw new ApiError(404, M.groups.errors.notFound);
  const mine = all.filter((p) => p.canEdit);
  if (mine.length === 0) throw new ApiError(403, M.groups.errors.forbidden);
  return { ids: mine.map((p) => p.id), skipped: all.length - mine.length };
}

/**
 * Renames a group on every project of it the actor may change. A new name
 * that matches another group joins it (`merged`); a change of case or
 * spacing only keeps the new spelling.
 */
export async function renameGroup(actor: Actor, body: unknown) {
  const { from, to } = parse(renameSchema, body);
  const { ids, skipped } = await editableInGroup(actor, from);
  const merged = !sameGroup(from, to) && (await listGroupSummaries(actor)).some((g) => sameGroup(g.name, to));
  const target = sameGroup(from, to) ? to : ((await canonicalGroup(actor, to)) as string);
  const r = await db.project.updateMany({ where: { id: { in: ids } }, data: { group: target } });
  return { group: target, renamed: r.count, skipped, merged };
}

/** Takes every project of a group the actor may change out of it. The projects stay, without a group. */
export async function ungroupGroup(actor: Actor, body: unknown) {
  const { name: group } = parse(ungroupSchema, body);
  const { ids, skipped } = await editableInGroup(actor, group);
  const r = await db.project.updateMany({ where: { id: { in: ids } }, data: { group: null } });
  return { ungrouped: r.count, skipped };
}

/** Moves projects into a group, a new one or an existing one (matched ignoring case and spacing). All or nothing: every project needs owner or editor. */
export async function assignGroup(actor: Actor, body: unknown) {
  const input = parse(assignSchema, body);
  const refs = [];
  for (const slug of new Set(input.slugs)) refs.push(await projectFor(actor, slug, "editor"));
  const target = (await canonicalGroup(actor, input.name)) as string;
  const r = await db.project.updateMany({ where: { id: { in: refs.map((p) => p.id) } }, data: { group: target } });
  return { group: target, moved: r.count };
}
