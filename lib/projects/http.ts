import { ApiError, intParam } from "@/lib/api-v1/params";
import { projectFor, type Actor } from "./access";
import { PROJECT_MESSAGES as M } from "./messages";
import { FILE_CATEGORIES, NOTE_HISTORY, NOTE_KINDS, parseUpdatedSince, TASK_STATUSES, type FileCategory } from "./schema";
import * as budget from "./budget";
import { rankUsageSummary, getRankSettings, listRankRuns, startRankCheckNow, updateProviderPlan, updateRankSettings } from "./rank";
import { monthOf, MONTH_PATTERN } from "./rank-usage";
import * as svc from "./service";
import * as groups from "./groups";
import { sourcesMatrix } from "./sources";
import { visibleProjects } from "./access";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES } from "./uploads";

/*
 * The HTTP routes of client projects, shared by /api/v1/projects (an access
 * key; writes need the write scope, checked by the API router) and
 * /api/projects (the signed-in user of the dashboard). `segments` is the path
 * after "projects". The dashboard also manages members and sites and deletes
 * things; the API does not.
 *
 * GET   /projects                         ?updatedSince=
 * POST  /projects                         create (the caller becomes its owner)
 * GET   /projects/{slug}                  passport, role, sites, members, counts
 * PATCH /projects/{slug}                  passport fields
 * GET   /projects/{slug}/notes            ?updatedSince=&kind=
 * POST  /projects/{slug}/notes            upsert by id, or by kind and title
 * GET   /projects/{slug}/notes/{id}       with the last versions, ?history=
 * PATCH /projects/{slug}/notes/{id}
 * GET   /projects/{slug}/files            ?updatedSince=
 * POST  /projects/{slug}/files            multipart/form-data: file, category
 * GET   /projects/{slug}/files/{id}       the file, as an attachment
 * GET   /projects/{slug}/journal          ?updatedSince=&limit=
 * POST  /projects/{slug}/journal
 * PATCH /projects/{slug}/journal/{id}
 * GET   /projects/{slug}/tasks            ?updatedSince=&status=
 * POST  /projects/{slug}/tasks            upsert by id, or by externalKey
 * PATCH /projects/{slug}/tasks/{id}
 * GET   /projects/_sources                the data sources of every project (?slug= for one): state, last sync, error, paid
 * GET   /projects/_groups                 the groups: name, count, editable (./groups.ts)
 * POST  /projects/_groups/rename          { from, to }; into an existing group merges
 * POST  /projects/_groups/ungroup         { name }
 * POST  /projects/_groups/assign          { name, slugs[] }
 * GET   /projects/_summary                this month (?month=) of every project: budgets and rank check usage
 * GET   /projects/{slug}/rank-settings    settings, engines, planned usage, the limit, recent runs
 * PATCH /projects/{slug}/rank-settings    enabled, source, frequency, engineIds, override
 * GET   /projects/{slug}/rank-usage       the usage log of a month, ?month=YYYY-MM
 * GET   /projects/{slug}/budget           ?month=: plan, entries, automatic costs, plan vs actual, history
 * PATCH /projects/{slug}/budget           currency, categories, plan { month, lines }
 * POST  /projects/{slug}/budget-entries   date, category, amount, note, externalKey
 * PATCH /projects/{slug}/budget-entries/{id}
 * Dashboard only: POST /projects/{slug}/rank-checks (start now), PATCH /projects/_rank-plans
 * (a provider's limit and price), DELETE /projects/{slug}/budget-entries/{id}.
 */

export type Channel = "api" | "dashboard";

/** JSON bodies: a note of 200 000 characters fits. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
/** A multipart upload: the file and the form around it. */
export const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;

function tooLarge(req: Request, max: number) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new ApiError(413, M.errors.bodyTooLarge(max));
}

async function jsonBody(req: Request): Promise<unknown> {
  tooLarge(req, MAX_JSON_BYTES);
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new ApiError(413, M.errors.bodyTooLarge(MAX_JSON_BYTES));
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, M.errors.bodyJson);
  }
}

async function uploadBody(req: Request): Promise<{ name: string; bytes: Buffer; category: FileCategory }> {
  tooLarge(req, MAX_MULTIPART_BYTES);
  if (!/^multipart\/form-data/i.test(req.headers.get("content-type") ?? "")) throw new ApiError(400, M.errors.multipart);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, M.errors.multipart);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, M.errors.multipart);
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, M.errors.fileTooLarge(MAX_UPLOAD_BYTES / 1024 / 1024));
  const raw = form.get("category");
  const category = (FILE_CATEGORIES as readonly string[]).includes(String(raw)) ? (raw as FileCategory) : "materials";
  return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()), category };
}

function updatedSince(params: URLSearchParams): Date | undefined {
  const t = parseUpdatedSince(params.get("updatedSince"));
  if (t === null) throw new ApiError(400, M.errors.updatedSince);
  return t;
}

function oneOf<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) throw new ApiError(400, `${name} must be one of ${allowed.join(", ")}`);
  return raw as T;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const notAllowed = () => new ApiError(405, M.errors.method);

function monthParam(params: URLSearchParams): string {
  const raw = params.get("month");
  if (!raw) return monthOf(new Date());
  if (!MONTH_PATTERN.test(raw)) throw new ApiError(400, M.budget.errors.month);
  return raw;
}

/** Answers one projects request. Errors are thrown as ApiError for the caller to turn into JSON. */
export async function routeProjects(
  actor: Actor,
  req: Request,
  segments: string[],
  params: URLSearchParams,
  channel: Channel
): Promise<Response> {
  const method = req.method;
  const dashboard = channel === "dashboard";
  const [slug, resource, id, extra] = segments;
  if (extra !== undefined) throw new ApiError(404, "Not found");

  if (slug === undefined) {
    if (method === "GET") return json({ projects: await svc.listProjects(actor, { updatedSince: updatedSince(params) }) });
    if (method === "POST") return json(await svc.createProject(actor, await jsonBody(req)), 201);
    throw notAllowed();
  }

  // Not project slugs: a slug cannot start with "_".
  if (slug === "_summary" && resource === undefined) {
    if (method !== "GET") throw notAllowed();
    const month = monthParam(params);
    const visible = await db.project.findMany({ where: visibleProjects(actor), select: { id: true } });
    const [budgets, rank] = await Promise.all([budget.budgetSummary(actor, month), rankUsageSummary(db, month, new Set(visible.map((p) => p.id)))]);
    return json({ month, budget: budgets, rank });
  }
  // Agency fork UX step 2: the data sources matrix (lib/projects/sources.ts), ?slug= for one project.
  if (slug === "_sources" && resource === undefined) {
    if (method !== "GET") throw notAllowed();
    return json(await sourcesMatrix(actor, { slug: params.get("slug") ?? undefined }));
  }
  // Agency fork: project groups (./groups.ts). Rename, ungroup and assign change only the projects the actor edits.
  if (slug === "_groups") {
    if (resource === undefined) {
      if (method === "GET") return json({ groups: await groups.listGroupSummaries(actor) });
      throw notAllowed();
    }
    const action = resource === "rename" ? groups.renameGroup : resource === "ungroup" ? groups.ungroupGroup : resource === "assign" ? groups.assignGroup : null;
    if (!action || id !== undefined) throw new ApiError(404, "Not found");
    if (method !== "POST") throw notAllowed();
    return json(await action(actor, await jsonBody(req)));
  }
  if (slug === "_rank-plans" && resource === undefined) {
    if (method === "PATCH" && dashboard) return json({ plan: await updateProviderPlan(actor, await jsonBody(req)) });
    throw notAllowed();
  }

  if (resource === undefined) {
    if (method === "GET") return json(await svc.getProject(actor, slug));
    if (method === "PATCH") return json(await svc.updateProject(actor, slug, await jsonBody(req)));
    if (method === "DELETE" && dashboard) return json(await svc.deleteProject(actor, slug));
    throw notAllowed();
  }

  switch (resource) {
    case "notes":
      if (id === undefined) {
        if (method === "GET")
          return json(await svc.listNotes(actor, slug, { updatedSince: updatedSince(params), kind: oneOf(params, "kind", NOTE_KINDS) }));
        if (method === "POST") {
          const r = await svc.upsertNote(actor, slug, await jsonBody(req));
          return json(r, r.created ? 201 : 200);
        }
        throw notAllowed();
      }
      if (method === "GET") return json(await svc.getNote(actor, slug, id, intParam(params, "history", NOTE_HISTORY, 0, NOTE_HISTORY)));
      if (method === "PATCH") return json(await svc.patchNote(actor, slug, id, await jsonBody(req)));
      if (method === "DELETE" && dashboard) return json(await svc.deleteNote(actor, slug, id));
      throw notAllowed();

    case "files":
      if (id === undefined) {
        if (method === "GET") return json(await svc.listFiles(actor, slug, { updatedSince: updatedSince(params) }));
        if (method === "POST") {
          // The role is checked before the body is read, so a viewer's upload is not buffered.
          await projectFor(actor, slug, "editor");
          return json(await svc.uploadFile(actor, slug, await uploadBody(req)), 201);
        }
        throw notAllowed();
      }
      if (method === "GET") return svc.downloadFile(actor, slug, id);
      if (method === "DELETE" && dashboard) return json(await svc.deleteFile(actor, slug, id));
      throw notAllowed();

    case "journal":
      if (id === undefined) {
        if (method === "GET")
          return json(await svc.listJournal(actor, slug, { updatedSince: updatedSince(params), limit: intParam(params, "limit", 200, 1, 1000) }));
        if (method === "POST") {
          const r = await svc.addJournalEntry(actor, slug, await jsonBody(req));
          return json(r, r.created ? 201 : 200);
        }
        throw notAllowed();
      }
      if (method === "PATCH") return json(await svc.patchJournalEntry(actor, slug, id, await jsonBody(req)));
      if (method === "DELETE" && dashboard) return json(await svc.deleteJournalEntry(actor, slug, id));
      throw notAllowed();

    case "tasks":
      if (id === undefined) {
        if (method === "GET")
          return json(await svc.listTasks(actor, slug, { updatedSince: updatedSince(params), status: oneOf(params, "status", TASK_STATUSES) }));
        if (method === "POST") {
          const r = await svc.upsertTask(actor, slug, await jsonBody(req));
          return json(r, r.created ? 201 : 200);
        }
        throw notAllowed();
      }
      if (method === "PATCH") return json(await svc.patchTask(actor, slug, id, await jsonBody(req)));
      if (method === "DELETE" && dashboard) return json(await svc.deleteTask(actor, slug, id));
      throw notAllowed();

    case "rank-settings":
      if (id !== undefined) break;
      if (method === "GET") return json(await getRankSettings(actor, slug));
      if (method === "PATCH") return json(await updateRankSettings(actor, slug, await jsonBody(req)));
      throw notAllowed();

    case "rank-usage":
      if (id !== undefined) break;
      if (method === "GET") return json(await listRankRuns(actor, slug, monthParam(params)));
      throw notAllowed();

    case "rank-checks":
      if (!dashboard || id !== undefined) break;
      if (method === "POST") return json(await startRankCheckNow(actor, slug, await jsonBody(req)), 201);
      throw notAllowed();

    case "budget":
      if (id !== undefined) break;
      if (method === "GET") return json(await budget.getBudget(actor, slug, monthParam(params)));
      if (method === "PATCH") return json(await budget.updateBudget(actor, slug, await jsonBody(req)));
      throw notAllowed();

    case "budget-entries":
      if (id === undefined) {
        if (method === "POST") {
          const r = await budget.addBudgetEntry(actor, slug, await jsonBody(req));
          return json(r, r.created ? 201 : 200);
        }
        throw notAllowed();
      }
      if (method === "PATCH") return json(await budget.patchBudgetEntry(actor, slug, id, await jsonBody(req)));
      if (method === "DELETE" && dashboard) return json(await budget.deleteBudgetEntry(actor, slug, id));
      throw notAllowed();

    case "members":
      if (!dashboard) break;
      if (id === undefined && method === "POST") return json(await svc.addMember(actor, slug, await jsonBody(req)));
      if (id !== undefined && method === "PATCH") return json(await svc.setMemberRole(actor, slug, id, await jsonBody(req)));
      if (id !== undefined && method === "DELETE") return json(await svc.removeMember(actor, slug, id));
      throw notAllowed();

    case "sites":
      if (!dashboard) break;
      if (id === undefined && method === "POST") return json(await svc.addSites(actor, slug, await jsonBody(req)));
      if (id !== undefined && method === "DELETE") return json(await svc.removeSite(actor, slug, id));
      throw notAllowed();
  }
  throw new ApiError(404, "Not found");
}
