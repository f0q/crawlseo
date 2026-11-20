import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { ensureDefaultAlerts } from "@/lib/alerts/evaluate";
import { canAddSite, siteCreated } from "@/lib/site-policy";
import { isPublicDomainName, siteDomainFromProperty } from "@/lib/site-domain";
import { projectFor, rolesOf, visibleProjects, type Actor } from "./access";
import { PROJECT_MESSAGES as M } from "./messages";
import {
  addSitesSchema,
  createProjectSchema,
  journalSchema,
  memberSchema,
  NOTE_HISTORY,
  patchJournalSchema,
  patchNoteSchema,
  patchTaskSchema,
  roleSchema,
  SLUG_PATTERN,
  slugify,
  updateProjectSchema,
  upsertNoteSchema,
  upsertTaskSchema,
  zodMessage,
  type FileCategory,
  type NoteKind,
  type Role,
  type TaskStatus,
} from "./schema";
import { checkUpload, downloadResponse, readStoredFile, removeProjectFiles, removeStoredFile, storeFile } from "./uploads";

/*
 * Client projects (agency fork): every read and write, for the dashboard
 * routes and /api/v1 alike. Each function takes the actor and the project
 * slug and checks the actor's role first (./access.ts).
 */

type Schema<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } };

function parse<T>(schema: Schema<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new ApiError(400, zodMessage(r.error));
  return r.data;
}

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = () => toDay(new Date().toISOString().slice(0, 10));

const since = (updatedSince: Date | undefined) => (updatedSince ? { updatedAt: { gte: updatedSince } } : {});

// ============ PROJECTS ============

const PASSPORT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  testUrl: true,
  geo: true,
  language: true,
  searchEngines: true,
  cms: true,
  hosting: true,
  contacts: true,
  accessNotes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ProjectSummary = Prisma.ProjectGetPayload<{ select: typeof PASSPORT }> & {
  role: Role;
  sites: { id: string; domain: string }[];
  openTasks: number;
  lastJournal: { date: string; text: string; author: string } | null;
};

/**
 * The projects the actor sees, with their domains, open tasks and latest
 * journal entry. updatedSince keeps the projects where anything (passport,
 * notes, files, journal, tasks) changed since then.
 */
export async function listProjects(actor: Actor, opts: { updatedSince?: Date } = {}): Promise<ProjectSummary[]> {
  const t = opts.updatedSince;
  const changed: Prisma.ProjectWhereInput = t
    ? {
        OR: [
          { updatedAt: { gte: t } },
          { notes: { some: { updatedAt: { gte: t } } } },
          { files: { some: { updatedAt: { gte: t } } } },
          { journal: { some: { updatedAt: { gte: t } } } },
          { tasks: { some: { updatedAt: { gte: t } } } },
        ],
      }
    : {};
  const rows = await db.project.findMany({
    where: { AND: [visibleProjects(actor), changed] },
    select: {
      ...PASSPORT,
      sites: { select: { id: true, domain: true }, orderBy: { domain: "asc" } },
      journal: { select: { date: true, text: true, author: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1 },
      _count: { select: { tasks: { where: { status: { not: "done" } } } } },
    },
    orderBy: [{ name: "asc" }],
  });
  const roles = await rolesOf(actor, rows.map((r) => r.id));
  return rows.map(({ journal, _count, ...p }) => ({
    ...p,
    role: roles.get(p.id) ?? "viewer",
    openTasks: _count.tasks,
    lastJournal: journal[0] ? { date: day(journal[0].date)!, text: journal[0].text, author: journal[0].author } : null,
  }));
}

/** The passport, the actor's role, the sites, the members and counts. */
export async function getProject(actor: Actor, slug: string) {
  const ref = await projectFor(actor, slug);
  const p = await db.project.findUniqueOrThrow({
    where: { id: ref.id },
    select: {
      ...PASSPORT,
      sites: { select: { id: true, domain: true, gscProperty: true, userId: true }, orderBy: { domain: "asc" } },
      members: { select: { role: true, user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { notes: true, files: true, journal: true, tasks: { where: { status: { not: "done" } } } } },
    },
  });
  const { sites, members, _count, ...passport } = p;
  return {
    project: { ...passport, role: ref.role },
    sites: sites.map(({ userId, ...s }) => ({ ...s, yours: userId === actor.userId })),
    members: members.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name, role: m.role })),
    counts: { notes: _count.notes, files: _count.files, journal: _count.journal, openTasks: _count.tasks },
  };
}

type PlannedSite = { domain: string; existingId: string | null };

/** Checks domains for the actor's sites: each a public domain, not in another project, allowed by the site policy. */
async function planSites(actor: Actor, domains: string[], projectId: string | null): Promise<PlannedSite[]> {
  const out: PlannedSite[] = [];
  const seen = new Set<string>();
  for (const raw of domains) {
    const domain = siteDomainFromProperty(raw)?.toLowerCase();
    if (!domain || !isPublicDomainName(domain)) throw new ApiError(400, M.errors.domain(raw));
    if (seen.has(domain)) continue;
    seen.add(domain);
    const existing = await db.site.findUnique({
      where: { userId_domain: { userId: actor.userId, domain } },
      select: { id: true, projectId: true },
    });
    if (existing) {
      if (existing.projectId && existing.projectId !== projectId) throw new ApiError(409, M.errors.siteInOtherProject(domain));
      out.push({ domain, existingId: existing.id });
      continue;
    }
    const permission = await canAddSite({ id: actor.userId }, { domain, gscProperty: "" });
    if (!permission.ok) throw new ApiError(permission.status, permission.reason);
    out.push({ domain, existingId: null });
  }
  return out;
}

/** Creates or links the planned sites. New sites get the default alerts and the site policy's after-create hook. */
async function attachSites(actor: Actor, projectId: string, planned: PlannedSite[]) {
  for (const s of planned) {
    if (s.existingId) {
      await db.site.update({ where: { id: s.existingId }, data: { projectId } });
      continue;
    }
    const site = await db.site.create({
      data: { userId: actor.userId, domain: s.domain, projectId },
      select: { id: true, domain: true, gscProperty: true },
    });
    await ensureDefaultAlerts(actor.userId, site.id);
    await siteCreated({ ...site, userId: actor.userId });
  }
}

/** Creates a project with the actor as its owner, and its sites from `domains`. */
export async function createProject(actor: Actor, body: unknown) {
  const input = parse(createProjectSchema, body);
  const slug = input.slug ?? (slugify(input.name) || slugify(input.domains[0] ?? ""));
  if (!SLUG_PATTERN.test(slug)) throw new ApiError(400, M.errors.slugNeeded);
  if (await db.project.findUnique({ where: { slug }, select: { id: true } })) throw new ApiError(409, M.errors.slugTaken);
  const planned = await planSites(actor, input.domains, null);

  const passport = { ...input, domains: undefined, slug: undefined };
  let project;
  try {
    project = await db.project.create({
      data: { ...passport, slug, ownerId: actor.userId, members: { create: { userId: actor.userId, role: "owner" } } },
      select: { id: true, slug: true },
    });
  } catch (err) {
    if (isUnique(err)) throw new ApiError(409, M.errors.slugTaken);
    throw err;
  }
  await attachSites(actor, project.id, planned);
  return getProject(actor, project.slug);
}

export async function updateProject(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(updateProjectSchema, body);
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(data).length) await db.project.update({ where: { id: ref.id }, data });
  return getProject(actor, slug);
}

/** Deletes the project with its notes, files, journal and tasks. Its sites stay, without a project. */
export async function deleteProject(actor: Actor, slug: string) {
  const ref = await projectFor(actor, slug, "owner");
  await db.project.delete({ where: { id: ref.id } });
  await removeProjectFiles(ref.id).catch((err) => console.error(`[projects] could not remove the files of ${ref.id}:`, err));
  return { deleted: true };
}

// ============ SITES ============

/** Adds sites by domain (created for the actor, or the actor's existing ones), or links one of the actor's sites by id. */
export async function addSites(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(addSitesSchema, body);
  if (input.siteId) {
    const site = await db.site.findUnique({ where: { id: input.siteId }, select: { userId: true, projectId: true, domain: true } });
    if (!site) throw new ApiError(404, M.errors.siteNotFound);
    if (site.userId !== actor.userId) throw new ApiError(403, M.errors.siteNotYours);
    if (site.projectId && site.projectId !== ref.id) throw new ApiError(409, M.errors.siteInOtherProject(site.domain));
    await db.site.update({ where: { id: input.siteId }, data: { projectId: ref.id } });
  }
  if (input.domains?.length) await attachSites(actor, ref.id, await planSites(actor, input.domains, ref.id));
  return getProject(actor, slug);
}

/** Takes a site out of the project. The site itself stays as it is. */
export async function removeSite(actor: Actor, slug: string, siteId: string) {
  const ref = await projectFor(actor, slug, "editor");
  const r = await db.site.updateMany({ where: { id: siteId, projectId: ref.id }, data: { projectId: null } });
  if (r.count === 0) throw new ApiError(404, M.errors.siteNotFound);
  return getProject(actor, slug);
}

// ============ MEMBERS ============

async function ownerCount(projectId: string) {
  return db.membership.count({ where: { projectId, role: "owner" } });
}

export async function addMember(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "owner");
  const input = parse(memberSchema, body);
  const user = await db.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true } });
  if (!user) throw new ApiError(404, M.errors.noUser);
  const current = await db.membership.findUnique({ where: { projectId_userId: { projectId: ref.id, userId: user.id } } });
  if (current?.role === "owner" && input.role !== "owner" && (await ownerCount(ref.id)) <= 1) throw new ApiError(409, M.errors.lastOwner);
  await db.membership.upsert({
    where: { projectId_userId: { projectId: ref.id, userId: user.id } },
    create: { projectId: ref.id, userId: user.id, role: input.role },
    update: { role: input.role },
  });
  return getProject(actor, slug);
}

export async function setMemberRole(actor: Actor, slug: string, userId: string, body: unknown) {
  const ref = await projectFor(actor, slug, "owner");
  const { role } = parse(roleSchema, body);
  const current = await db.membership.findUnique({ where: { projectId_userId: { projectId: ref.id, userId } } });
  if (!current) throw new ApiError(404, M.errors.memberNotFound);
  if (current.role === "owner" && role !== "owner" && (await ownerCount(ref.id)) <= 1) throw new ApiError(409, M.errors.lastOwner);
  await db.membership.update({ where: { id: current.id }, data: { role } });
  return getProject(actor, slug);
}

/** An owner removes anyone; any member can leave. The last owner stays. */
export async function removeMember(actor: Actor, slug: string, userId: string) {
  const ref = await projectFor(actor, slug, userId === actor.userId ? "viewer" : "owner");
  const current = await db.membership.findUnique({ where: { projectId_userId: { projectId: ref.id, userId } } });
  if (!current) throw new ApiError(404, M.errors.memberNotFound);
  if (current.role === "owner" && (await ownerCount(ref.id)) <= 1) throw new ApiError(409, M.errors.lastOwner);
  await db.membership.delete({ where: { id: current.id } });
  return { removed: true };
}

// ============ NOTES ============

const NOTE = { id: true, kind: true, title: true, body: true, version: true, updatedBy: true, createdAt: true, updatedAt: true } as const;
type NoteRow = Prisma.ProjectNoteGetPayload<{ select: typeof NOTE }>;

export async function listNotes(actor: Actor, slug: string, opts: { updatedSince?: Date; kind?: NoteKind } = {}) {
  const ref = await projectFor(actor, slug);
  const notes = await db.projectNote.findMany({
    where: { projectId: ref.id, ...since(opts.updatedSince), ...(opts.kind && { kind: opts.kind }) },
    select: NOTE,
    orderBy: [{ kind: "asc" }, { title: "asc" }],
  });
  return { notes };
}

/** A note with its earlier versions, newest first, at most `history` of them. */
export async function getNote(actor: Actor, slug: string, noteId: string, history = NOTE_HISTORY) {
  const ref = await projectFor(actor, slug);
  const note = await db.projectNote.findFirst({
    where: { id: noteId, projectId: ref.id },
    select: {
      ...NOTE,
      versions: { select: { version: true, title: true, body: true, updatedBy: true, createdAt: true }, orderBy: { version: "desc" }, take: history },
    },
  });
  if (!note) throw new ApiError(404, M.errors.noteNotFound);
  return { note };
}

/** Writes a new version of a note and keeps the one before in the history. Unchanged content writes nothing. */
async function saveNote(actor: Actor, note: NoteRow, change: { kind?: NoteKind; title?: string; body?: string }, baseVersion?: number) {
  if (baseVersion !== undefined && baseVersion !== note.version) throw new ApiError(409, M.errors.versionConflict(note.version));
  const next = { kind: change.kind ?? note.kind, title: change.title ?? note.title, body: change.body ?? note.body };
  if (next.kind === note.kind && next.title === note.title && next.body === note.body) return { note, changed: false };
  try {
    const saved = await db.$transaction(async (tx) => {
      await tx.projectNoteVersion.create({
        data: { noteId: note.id, version: note.version, title: note.title, body: note.body, updatedBy: note.updatedBy, createdAt: note.updatedAt },
      });
      const row = await tx.projectNote.update({
        where: { id: note.id, version: note.version },
        data: { ...next, version: note.version + 1, updatedBy: actor.label },
        select: NOTE,
      });
      await tx.projectNoteVersion.deleteMany({ where: { noteId: note.id, version: { lte: row.version - 1 - NOTE_HISTORY } } });
      return row;
    });
    return { note: saved, changed: true };
  } catch (err) {
    if (isUnique(err)) throw new ApiError(409, M.errors.noteTaken);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw new ApiError(409, M.errors.versionConflict(note.version + 1));
    throw err;
  }
}

/** Creates a note or writes a new version of it: by id, else by kind and title. */
export async function upsertNote(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(upsertNoteSchema, body);
  const existing = input.id
    ? await db.projectNote.findFirst({ where: { id: input.id, projectId: ref.id }, select: NOTE })
    : await db.projectNote.findUnique({ where: { projectId_kind_title: { projectId: ref.id, kind: input.kind, title: input.title } }, select: NOTE });
  if (input.id && !existing) throw new ApiError(404, M.errors.noteNotFound);
  if (existing) {
    const r = await saveNote(actor, existing, { kind: input.kind, title: input.title, body: input.body }, input.baseVersion);
    return { ...r, created: false };
  }
  try {
    const note = await db.projectNote.create({
      data: { projectId: ref.id, kind: input.kind, title: input.title, body: input.body, updatedBy: actor.label },
      select: NOTE,
    });
    return { note, changed: true, created: true };
  } catch (err) {
    if (isUnique(err)) throw new ApiError(409, M.errors.noteTaken);
    throw err;
  }
}

export async function patchNote(actor: Actor, slug: string, noteId: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(patchNoteSchema, body);
  const note = await db.projectNote.findFirst({ where: { id: noteId, projectId: ref.id }, select: NOTE });
  if (!note) throw new ApiError(404, M.errors.noteNotFound);
  return saveNote(actor, note, input, input.baseVersion);
}

export async function deleteNote(actor: Actor, slug: string, noteId: string) {
  const ref = await projectFor(actor, slug, "editor");
  const r = await db.projectNote.deleteMany({ where: { id: noteId, projectId: ref.id } });
  if (r.count === 0) throw new ApiError(404, M.errors.noteNotFound);
  return { deleted: true };
}

// ============ FILES ============

const FILE = { id: true, name: true, type: true, mime: true, size: true, sha256: true, category: true, uploadedBy: true, createdAt: true, updatedAt: true } as const;

export async function listFiles(actor: Actor, slug: string, opts: { updatedSince?: Date } = {}) {
  const ref = await projectFor(actor, slug);
  const files = await db.projectFile.findMany({ where: { projectId: ref.id, ...since(opts.updatedSince) }, select: FILE, orderBy: { createdAt: "desc" } });
  return { files };
}

/** Stores an uploaded file after checking its size, extension and content. */
export async function uploadFile(actor: Actor, slug: string, file: { name: string; bytes: Buffer; category: FileCategory }) {
  const ref = await projectFor(actor, slug, "editor");
  const checked = checkUpload(file.name, file.bytes);
  if (!checked.ok) throw new ApiError(checked.status, checked.error);
  const stored = await storeFile(ref.id, checked.type, file.bytes);
  try {
    const row = await db.projectFile.create({
      data: {
        projectId: ref.id,
        name: checked.name,
        storageName: stored.storageName,
        type: checked.type,
        mime: checked.mime,
        size: file.bytes.length,
        sha256: stored.sha256,
        category: file.category,
        uploadedBy: actor.label,
      },
      select: FILE,
    });
    return { file: row };
  } catch (err) {
    await removeStoredFile(ref.id, stored.storageName).catch(() => {});
    throw err;
  }
}

/** The file as an attachment, for members only. */
export async function downloadFile(actor: Actor, slug: string, fileId: string): Promise<Response> {
  const ref = await projectFor(actor, slug);
  const file = await db.projectFile.findFirst({ where: { id: fileId, projectId: ref.id }, select: { name: true, mime: true, storageName: true } });
  if (!file) throw new ApiError(404, M.errors.fileNotFound);
  let bytes: Buffer;
  try {
    bytes = await readStoredFile(ref.id, file.storageName);
  } catch {
    throw new ApiError(404, M.errors.fileNotFound);
  }
  return downloadResponse(file, bytes);
}

export async function deleteFile(actor: Actor, slug: string, fileId: string) {
  const ref = await projectFor(actor, slug, "editor");
  const file = await db.projectFile.findFirst({ where: { id: fileId, projectId: ref.id }, select: { id: true, storageName: true } });
  if (!file) throw new ApiError(404, M.errors.fileNotFound);
  await db.projectFile.delete({ where: { id: file.id } });
  await removeStoredFile(ref.id, file.storageName).catch((err) => console.error("[projects] could not remove a file:", err));
  return { deleted: true };
}

// ============ JOURNAL ============

const ENTRY = { id: true, date: true, text: true, link: true, author: true, authorKind: true, siteId: true, createdAt: true, updatedAt: true } as const;
type EntryRow = Prisma.JournalEntryGetPayload<{ select: typeof ENTRY }>;
const entryJson = (e: EntryRow) => ({ ...e, date: day(e.date)! });

export async function listJournal(actor: Actor, slug: string, opts: { updatedSince?: Date; limit?: number } = {}) {
  const ref = await projectFor(actor, slug);
  const entries = await db.journalEntry.findMany({
    where: { projectId: ref.id, ...since(opts.updatedSince) },
    select: ENTRY,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 200,
  });
  return { entries: entries.map(entryJson) };
}

async function checkSite(projectId: string, siteId: string | null | undefined) {
  if (!siteId) return;
  const site = await db.site.findFirst({ where: { id: siteId, projectId }, select: { id: true } });
  if (!site) throw new ApiError(400, M.errors.journalSite);
}

/** Adds an entry. The same date, text and link again returns the existing entry, so a sync can retry. */
export async function addJournalEntry(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(journalSchema, body);
  await checkSite(ref.id, input.siteId);
  const date = input.date ? toDay(input.date) : today();
  const same = await db.journalEntry.findFirst({ where: { projectId: ref.id, date, text: input.text, link: input.link }, select: ENTRY });
  if (same) return { entry: entryJson(same), created: false };
  const entry = await db.journalEntry.create({
    data: {
      projectId: ref.id,
      date,
      text: input.text,
      link: input.link,
      siteId: input.siteId ?? null,
      author: input.author || actor.label,
      authorKind: actor.kind,
    },
    select: ENTRY,
  });
  return { entry: entryJson(entry), created: true };
}

export async function patchJournalEntry(actor: Actor, slug: string, entryId: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(patchJournalSchema, body);
  const current = await db.journalEntry.findFirst({ where: { id: entryId, projectId: ref.id }, select: { id: true } });
  if (!current) throw new ApiError(404, M.errors.entryNotFound);
  await checkSite(ref.id, input.siteId);
  const entry = await db.journalEntry.update({
    where: { id: entryId },
    data: {
      ...(input.date !== undefined && { date: toDay(input.date) }),
      ...(input.text !== undefined && { text: input.text }),
      ...(input.link !== undefined && { link: input.link }),
      ...(input.siteId !== undefined && { siteId: input.siteId }),
    },
    select: ENTRY,
  });
  return { entry: entryJson(entry) };
}

export async function deleteJournalEntry(actor: Actor, slug: string, entryId: string) {
  const ref = await projectFor(actor, slug, "editor");
  const r = await db.journalEntry.deleteMany({ where: { id: entryId, projectId: ref.id } });
  if (r.count === 0) throw new ApiError(404, M.errors.entryNotFound);
  return { deleted: true };
}

// ============ TASKS ============

const TASK = { id: true, title: true, status: true, priority: true, due: true, assignee: true, notes: true, externalKey: true, createdAt: true, updatedAt: true } as const;
type TaskRow = Prisma.ProjectTaskGetPayload<{ select: typeof TASK }>;
const taskJson = (t: TaskRow) => ({ ...t, due: day(t.due) });

export async function listTasks(actor: Actor, slug: string, opts: { updatedSince?: Date; status?: TaskStatus } = {}) {
  const ref = await projectFor(actor, slug);
  const tasks = await db.projectTask.findMany({
    where: { projectId: ref.id, ...since(opts.updatedSince), ...(opts.status && { status: opts.status }) },
    select: TASK,
    orderBy: [{ createdAt: "asc" }],
  });
  return { tasks: tasks.map(taskJson) };
}

type TaskChange = { title?: string; status?: string; priority?: string; due?: string | null; assignee?: string | null; notes?: string | null };

function taskData(input: TaskChange) {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.due !== undefined && { due: input.due ? toDay(input.due) : null }),
    ...(input.assignee !== undefined && { assignee: input.assignee }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };
}

/** Creates a task or updates one: by id, else by externalKey. */
export async function upsertTask(actor: Actor, slug: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(upsertTaskSchema, body);
  const { id, externalKey, ...change } = input;
  const existing = id
    ? await db.projectTask.findFirst({ where: { id, projectId: ref.id }, select: { id: true } })
    : externalKey
      ? await db.projectTask.findUnique({ where: { projectId_externalKey: { projectId: ref.id, externalKey } }, select: { id: true } })
      : null;
  if (id && !existing) throw new ApiError(404, M.errors.taskNotFound);
  try {
    if (existing) {
      const task = await db.projectTask.update({
        where: { id: existing.id },
        data: { ...taskData(change), ...(externalKey !== undefined && { externalKey }) },
        select: TASK,
      });
      return { task: taskJson(task), created: false };
    }
    const task = await db.projectTask.create({
      data: { projectId: ref.id, externalKey: externalKey ?? null, ...taskData(change), title: change.title },
      select: TASK,
    });
    return { task: taskJson(task), created: true };
  } catch (err) {
    if (isUnique(err)) throw new ApiError(409, M.errors.taskKeyTaken);
    throw err;
  }
}

export async function patchTask(actor: Actor, slug: string, taskId: string, body: unknown) {
  const ref = await projectFor(actor, slug, "editor");
  const input = parse(patchTaskSchema, body);
  const current = await db.projectTask.findFirst({ where: { id: taskId, projectId: ref.id }, select: { id: true } });
  if (!current) throw new ApiError(404, M.errors.taskNotFound);
  const task = await db.projectTask.update({ where: { id: taskId }, data: taskData(input), select: TASK });
  return { task: taskJson(task) };
}

export async function deleteTask(actor: Actor, slug: string, taskId: string) {
  const ref = await projectFor(actor, slug, "editor");
  const r = await db.projectTask.deleteMany({ where: { id: taskId, projectId: ref.id } });
  if (r.count === 0) throw new ApiError(404, M.errors.taskNotFound);
  return { deleted: true };
}
