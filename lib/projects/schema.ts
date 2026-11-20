import { z } from "zod";
import { PROJECT_MESSAGES as M } from "./messages";
import { findSecret } from "./secrets";

/*
 * The shapes of client projects (agency fork) and what the API and the forms
 * accept. Pure (zod only), so the forms validate with the same rules as the
 * server.
 */

export const PROJECT_STATUSES = ["client", "prospect", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const NOTE_KINDS = ["brief", "audience", "chat", "strategy", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const FILE_CATEGORIES = ["materials", "chat"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** Versions of a note kept besides the current one. */
export const NOTE_HISTORY = 20;
export const MAX_NOTE_BODY = 200_000;
export const MAX_DOMAINS = 20;

/** 2 to 48 of a-z, 0-9 and "-", not starting or ending with "-". */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/;
/** Words the projects pages use as path segments. */
const RESERVED_SLUGS = new Set(["new", "api", "edit"]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A slug made from a name or a domain: "Acme Shop" and "acme-shop.example.com" become "acme-shop". */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.[a-z]{2,}(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, M.errors.slug)
  .refine((s) => !RESERVED_SLUGS.has(s), M.errors.slugReserved);

/** Optional text: "" and whitespace become null, so a form can clear a field. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const httpUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/[^\s/]+\S*$/i.test(v), M.errors.url);

export const accessNotesSchema = text(4000).superRefine((value, ctx) => {
  const found = value ? findSecret(value) : null;
  if (found) ctx.addIssue({ code: "custom", message: M.errors.secret(found.reason) });
});

const passportShape = {
  name: z.string().trim().min(1, M.errors.nameEmpty).max(120),
  status: z.enum(PROJECT_STATUSES),
  testUrl: httpUrl(500),
  geo: text(200),
  language: text(100),
  searchEngines: z.array(z.string().trim().min(1).max(40)).max(10),
  cms: text(200),
  hosting: text(200),
  contacts: text(4000),
  accessNotes: accessNotesSchema,
};

export const createProjectSchema = z.object({
  ...passportShape,
  slug: slugSchema.optional(),
  status: passportShape.status.default("client"),
  searchEngines: passportShape.searchEngines.default([]),
  /** Domains to add as sites of the project (yours; an existing site of yours is linked). */
  domains: z.array(z.string().trim().min(1).max(253)).max(MAX_DOMAINS).default([]),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object(passportShape).partial();
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

const noteFields = {
  kind: z.enum(NOTE_KINDS),
  title: z.string().trim().min(1, M.errors.titleEmpty).max(200),
  body: z.string().max(MAX_NOTE_BODY, M.errors.noteTooLong),
  /** The version the change was made on; a newer one on the server refuses it (409). */
  baseVersion: z.number().int().min(1).optional(),
};

/** Upsert: by id, or by kind and title. */
export const upsertNoteSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  ...noteFields,
  kind: noteFields.kind.default("other"),
  body: noteFields.body.default(""),
});
export type UpsertNoteInput = z.input<typeof upsertNoteSchema>;

export const patchNoteSchema = z.object(noteFields).partial();

const day = z
  .string()
  .regex(DAY, M.errors.day)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, M.errors.day);

export const journalSchema = z.object({
  date: day.optional(),
  text: z.string().trim().min(1, M.errors.textEmpty).max(5000),
  link: httpUrl(2048),
  siteId: z.string().min(1).max(40).nullish(),
  /** Who did it, when it is not the key's or the session's user, e.g. "seo-agent". */
  author: z.string().trim().max(100).optional(),
});
export type JournalInput = z.input<typeof journalSchema>;

export const patchJournalSchema = journalSchema.omit({ author: true }).partial();

const taskFields = {
  title: z.string().trim().min(1, M.errors.titleEmpty).max(300),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  due: day.nullish(),
  assignee: text(100),
  notes: text(10_000),
};

/** Upsert: by id, or by externalKey (the caller's own id), or a new task. */
export const upsertTaskSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  externalKey: z.string().trim().min(1).max(100).optional(),
  ...taskFields,
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
});
export type UpsertTaskInput = z.input<typeof upsertTaskSchema>;

export const patchTaskSchema = z.object(taskFields).partial();

export const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email(M.errors.email).max(254),
  role: z.enum(ROLES),
});

export const roleSchema = z.object({ role: z.enum(ROLES) });

export const addSitesSchema = z.object({
  domains: z.array(z.string().trim().min(1).max(253)).max(MAX_DOMAINS).optional(),
  siteId: z.string().min(1).max(40).optional(),
});

/** "title: Required; body: Too long", the first few problems. */
export function zodMessage(error: z.ZodError, max = 5): string {
  const lines = error.issues.slice(0, max).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  const more = error.issues.length > max ? ` (and ${error.issues.length - max} more)` : "";
  return lines.join("; ") + more;
}

/** An instant from ?updatedSince=: an ISO date-time or a day (UTC midnight). */
export function parseUpdatedSince(raw: string | null): Date | undefined | null {
  if (raw === null || raw === "") return undefined;
  const value = DAY.test(raw) ? `${raw}T00:00:00Z` : raw;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
