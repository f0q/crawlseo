/**
 * The client project tools of the agency fork, through /api/v1/projects like
 * every other tool: list_projects and get_project read; create_project,
 * update_project, upsert_note, add_journal_entry and upsert_task write and
 * need a key with the write scope. The key sees the projects its user is a member of.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ApiClient } from "./api-client";

export const PROJECT_TOOL_NAMES = ["list_projects", "get_project", "get_project_budget", "get_rank_usage"] as const;
export const PROJECT_WRITE_TOOL_NAMES = ["create_project", "update_project", "upsert_note", "add_journal_entry", "upsert_task", "add_budget_entry"] as const;

type Passport = {
  slug: string;
  name: string;
  status: string;
  group?: string | null;
  testUrl: string | null;
  geo: string | null;
  language: string | null;
  searchEngines: string[];
  cms: string | null;
  hosting: string | null;
  contacts: string | null;
  accessNotes: string | null;
  paidUntil?: string | null;
  contractEnd?: string | null;
  billingNeverPause?: boolean;
  role: string;
  updatedAt: string;
};

type Summary = Passport & {
  sites: { id: string; domain: string }[];
  openTasks: number;
  lastJournal: { date: string; text: string } | null;
};

type Detail = {
  project: Passport;
  sites: { id: string; domain: string; gscProperty: string | null }[];
  members: { email: string; role: string }[];
  counts: { notes: number; files: number; journal: number; openTasks: number };
};

type Note = { id: string; kind: string; title: string; body: string; version: number; updatedBy: string; updatedAt: string };
type Task = { id: string; title: string; status: string; priority: string; due: string | null; assignee: string | null; externalKey: string | null; notes: string | null };
type Entry = { id: string; date: string; text: string; link: string | null; author: string };
type File = { id: string; name: string; size: number; category: string; createdAt: string };

type BudgetRow = { category: string; plan: number; actual: number; auto: number };
type Budget = {
  month: string;
  currency: string;
  categories: string[];
  entries: { id: string; date: string; category: string; amount: number; note: string | null; author: string; externalKey: string | null }[];
  autoCosts: { name: string; checks: number; pricePerCheck: number; currency: string; amount: number; counted: boolean }[];
  summary: { plan: number; actual: number; percent: number | null; rows: BudgetRow[] };
  history: { month: string; plan: number; actual: number; percent: number | null }[];
};
type Plan = { provider: string; name: string; monthlyLimit: number; planName: string; pricePerCheck: number; currency: string };
type ProviderUsage = { plan: Plan; canStart: boolean; planned: number; used: number; cost: number; limit: { over: boolean; near: boolean }; projects: { slug: string; perMonth: number; frequency: string }[]; otherPlanned: number };
type RankSettings = {
  settings: { enabled: boolean; source: string; frequency: string; engineIds: string[] };
  engines: { id: string; domain: string; source: string; engine: string; region: string; device: string; keywords: number | null; included: boolean }[];
  usage: { perRun: number; runsPerMonth: number; perMonth: number; usedThisMonth: number; month: string };
  starting: { mode: string; missingCabinetFor: string[] };
};
type RankRun = { createdAt: string; provider: string; trigger: string; status: string; reason: string | null; estimatedChecks: number };
type RankUsage = { month: string; checks: number; costs: { provider: string; checks: number; pricePerCheck: number; currency: string; amount: number }[]; runs: RankRun[] };

const slug = z.string().describe("The project slug, from list_projects");
const monthArg = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM").optional().describe("YYYY-MM. Default: this month (UTC)");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const P = (s: string) => `/projects/${encodeURIComponent(s)}`;

/** Writes the user's own instance only; nothing is deleted. */
const UPSERT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}... (${s.length - n} more characters)` : s);

function passportLines(p: Passport): string {
  const rows: [string, string | null][] = [
    ["Status", p.status],
    ["Your role", p.role],
    ["Group", p.group ?? null],
    ["Test site", p.testUrl],
    ["Geo", p.geo],
    ["Language", p.language],
    ["Search engines", p.searchEngines.join(", ") || null],
    ["CMS", p.cms],
    ["Hosting", p.hosting],
    ["Contacts", p.contacts],
    ["Access notes", p.accessNotes],
    ["Paid until", p.paidUntil ?? null],
    ["Contract until", p.contractEnd ?? null],
    ["Never pause paid collection", p.billingNeverPause ? "yes" : null],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
}

export function formatProjects(projects: Summary[]): string {
  if (projects.length === 0) return "No projects.";
  const lines = projects.map(
    (p) =>
      `${p.name}  (slug: ${p.slug}, ${p.status}, your role: ${p.role})` +
      (p.group ? `\n  Group: ${p.group}` : "") +
      `\n  Sites: ${p.sites.map((s) => `${s.domain} (${s.id})`).join(", ") || "none"}` +
      `\n  Open tasks: ${p.openTasks}  |  Updated: ${p.updatedAt}` +
      (p.lastJournal ? `\n  Last journal entry: ${p.lastJournal.date} ${cut(p.lastJournal.text, 120)}` : "")
  );
  return `${projects.length} project(s):\n\n${lines.join("\n\n")}`;
}

export function formatProject(d: Detail, notes: Note[], tasks: Task[], journal: Entry[], files: File[], maxNoteChars: number): string {
  const open = tasks.filter((t) => t.status !== "done");
  return [
    `Project ${d.project.name} (slug: ${d.project.slug})`,
    passportLines(d.project),
    `Sites: ${d.sites.map((s) => `${s.domain} (id ${s.id}${s.gscProperty ? `, GSC ${s.gscProperty}` : ""})`).join(", ") || "none"}`,
    `Members: ${d.members.map((m) => `${m.email} (${m.role})`).join(", ")}`,
    `\nNotes (${notes.length}):` +
      (notes.length
        ? "\n" + notes.map((n) => `## [${n.kind}] ${n.title} (id ${n.id}, version ${n.version}, ${n.updatedBy}, ${n.updatedAt})\n${cut(n.body, maxNoteChars)}`).join("\n\n")
        : " none"),
    `\nOpen tasks (${open.length} of ${tasks.length}):` +
      (open.length
        ? "\n" + open.map((t) => `- [${t.status}] ${t.title} (id ${t.id}${t.externalKey ? `, key ${t.externalKey}` : ""}, ${t.priority}${t.due ? `, due ${t.due}` : ""}${t.assignee ? `, ${t.assignee}` : ""})`).join("\n")
        : " none"),
    `\nLatest journal entries:` +
      (journal.length ? "\n" + journal.map((e) => `- ${e.date} ${e.text}${e.link ? ` (${e.link})` : ""} [${e.author}]`).join("\n") : " none"),
    `\nFiles (${files.length}):` +
      (files.length
        ? "\n" + files.map((f) => `- ${f.name} (${f.category}, ${Math.ceil(f.size / 1024)} KB, id ${f.id}): GET /api/v1${P(d.project.slug)}/files/${f.id}`).join("\n")
        : " none"),
  ].join("\n");
}

const pct = (p: number | null) => (p === null ? "no plan" : `${p}%`);

export function formatBudget(b: Budget): string {
  const c = b.currency;
  const rows = b.summary.rows.map(
    (r) => `${r.category.padEnd(12)} | ${String(r.plan).padStart(10)} | ${String(r.actual).padStart(10)}${r.auto ? ` (incl. ${r.auto} automatic)` : ""}`
  );
  return [
    `Budget ${b.month}, ${c}: plan ${b.summary.plan}, actual ${b.summary.actual} (${pct(b.summary.percent)} used)`,
    `\nCategory     |       Plan |     Actual\n${rows.join("\n")}`,
    `\nAutomatic service costs:` +
      (b.autoCosts.length
        ? "\n" + b.autoCosts.map((a) => `- ${a.name}: ${a.checks} checks x ${a.pricePerCheck} ${a.currency} = ${a.amount} ${a.currency}${a.counted ? "" : " (other currency, not added)"}`).join("\n")
        : " none"),
    `\nEntries (${b.entries.length}):` +
      (b.entries.length
        ? "\n" + b.entries.map((e) => `- ${e.date} ${e.category} ${e.amount} ${c}${e.note ? ` ${e.note}` : ""} [${e.author}] (id ${e.id}${e.externalKey ? `, key ${e.externalKey}` : ""})`).join("\n")
        : " none"),
    `\nLast months: ${b.history.map((h) => `${h.month} ${h.actual}/${h.plan}`).join(", ")}`,
    `Categories: ${b.categories.join(", ")}`,
  ].join("\n");
}

export function formatProviderUsage(month: string, rank: ProviderUsage[]): string {
  return [
    `Rank checks ${month}:`,
    ...rank.map(
      (u) =>
        `- ${u.plan.name} (${u.plan.planName || "plan"}, ${u.plan.pricePerCheck} ${u.plan.currency} per check${u.canStart ? "" : ", started manually in the provider"}): ` +
        `planned ${u.planned} a month of limit ${u.plan.monthlyLimit || "none"}${u.limit.over ? " (OVER THE LIMIT)" : u.limit.near ? " (near the limit)" : ""}, started this month ${u.used} (${u.cost} ${u.plan.currency})` +
        (u.projects.length ? `\n  ${u.projects.map((p) => `${p.slug}: ${p.perMonth}/month ${p.frequency}`).join("; ")}${u.otherPlanned ? `; other projects: ${u.otherPlanned}` : ""}` : "")
    ),
  ].join("\n");
}

export function formatRankUsage(s: RankSettings, u: RankUsage): string {
  const st = s.settings;
  const included = s.engines.filter((e) => e.included);
  return [
    `Rank checks: ${st.enabled ? "ON" : "OFF"}, source ${st.source}, ${st.frequency}`,
    `Engines: ${included.map((e) => `${e.domain} ${e.engine} ${e.region} ${e.device} (${e.keywords ?? "?"} keywords)`).join("; ") || "none"}`,
    `Usage: ${s.usage.perRun} checks per run x ${s.usage.runsPerMonth} runs = ${s.usage.perMonth} a month`,
    `Starting: ${s.starting.mode}${s.starting.missingCabinetFor.length ? `; no cabinet login for ${s.starting.missingCabinetFor.join(", ")} (runs are skipped)` : ""}`,
    `\n${u.month}: ${u.checks} checks started` + (u.costs.length ? `, ${u.costs.map((c) => `${c.amount} ${c.currency} (${c.provider})`).join(", ")}` : ""),
    u.runs.length
      ? u.runs.map((r) => `- ${r.createdAt.slice(0, 16)} ${r.trigger} ${r.status}${r.reason ? ` (${r.reason})` : ""}, ${r.estimatedChecks} checks`).join("\n")
      : "No runs this month.",
  ].join("\n");
}

export function registerProjectTools(
  server: McpServer,
  api: ApiClient,
  run: (fn: () => Promise<string>) => Promise<CallToolResult>,
  readOnly: Record<string, boolean>
): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the client projects you are a member of: slug, status, your role, sites, open tasks and the latest journal entry. updatedSince keeps the projects where anything changed since then, for a sync.",
      inputSchema: {
        updatedSince: z.string().optional().describe("An ISO date-time or YYYY-MM-DD: only projects changed since then"),
      },
      annotations: readOnly,
    },
    ({ updatedSince }) =>
      run(async () => {
        const r = await api.get<{ projects: Summary[] }>("/projects", { updatedSince });
        return formatProjects(r.projects);
      })
  );

  server.registerTool(
    "get_project",
    {
      title: "Project",
      description:
        "A client project: the passport (status, test site, geo, language, search engines, CMS, hosting, contacts, where access is kept), sites, members, every note (brief, audience, client chat, strategy) with its text, open tasks, the latest journal entries and the files.",
      inputSchema: {
        slug,
        maxNoteChars: z.number().int().min(100).max(200_000).optional().default(20_000).describe("Cut each note after this many characters (default 20000)"),
        journalLimit: z.number().int().min(1).max(200).optional().default(20).describe("Most journal entries to show (default 20)"),
      },
      annotations: readOnly,
    },
    ({ slug, maxNoteChars, journalLimit }) =>
      run(async () => {
        const d = await api.get<Detail>(P(slug));
        const [notes, tasks, journal, files] = await Promise.all([
          api.get<{ notes: Note[] }>(`${P(slug)}/notes`),
          api.get<{ tasks: Task[] }>(`${P(slug)}/tasks`),
          api.get<{ entries: Entry[] }>(`${P(slug)}/journal`, { limit: journalLimit }),
          api.get<{ files: File[] }>(`${P(slug)}/files`),
        ]);
        return formatProject(d, notes.notes, tasks.tasks, journal.entries, files.files, maxNoteChars);
      })
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description:
        "Creates a client project with you as its owner, and adds its domains as your sites (an existing site of yours on the domain is linked). accessNotes holds only where access lives (variable names, a vault entry), never a secret: text that looks like a secret is refused. Needs a key with the write scope.",
      inputSchema: {
        name: z.string().min(1).max(120),
        slug: z.string().optional().describe("2 to 48 of a-z, 0-9 and -. Default: made from the name or the first domain"),
        status: z.enum(["client", "prospect", "paused", "archived"]).optional().default("client"),
        group: z.string().max(80).optional().describe('Projects with the same group are listed together, e.g. "Centro Adelante"'),
        domains: z.array(z.string()).max(20).optional().default([]).describe('Domains of the project, e.g. ["example.com"]'),
        testUrl: z.string().optional().describe("The test copy of the site, an http(s) URL"),
        geo: z.string().optional(),
        language: z.string().optional(),
        searchEngines: z.array(z.string()).max(10).optional().describe('e.g. ["Yandex", "Google"]'),
        cms: z.string().optional(),
        hosting: z.string().optional(),
        contacts: z.string().optional(),
        accessNotes: z.string().optional().describe("Where access lives, e.g. \"FTP: AGENT_FTP_PASS in agent-secrets/.env\". Never the secret"),
      },
      annotations: CREATE,
    },
    (args) =>
      run(async () => {
        const d = await api.post<Detail>("/projects", args);
        return `Created project ${d.project.name} (slug: ${d.project.slug}) with ${d.sites.length} site(s)${d.sites.length ? `: ${d.sites.map((s) => s.domain).join(", ")}` : ""}.`;
      })
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description:
        "Changes passport fields of a client project: only the fields you pass; null or \"\" clears one. group lists projects with the same group together. accessNotes holds only where access lives, never a secret. paidUntil, contractEnd and billingNeverPause set the client's billing: 1 to 14 days overdue warns, later (or after the contract ends) paid rank checks pause until the dates move forward. Needs a key with the write scope and the editor role.",
      inputSchema: {
        slug,
        name: z.string().min(1).max(120).optional(),
        status: z.enum(["client", "prospect", "paused", "archived"]).optional(),
        group: z.string().max(80).nullable().optional().describe('e.g. "Centro Adelante"; null clears it'),
        testUrl: z.string().nullable().optional(),
        geo: z.string().nullable().optional(),
        language: z.string().nullable().optional(),
        searchEngines: z.array(z.string()).max(10).optional(),
        cms: z.string().nullable().optional(),
        hosting: z.string().nullable().optional(),
        contacts: z.string().nullable().optional(),
        accessNotes: z.string().nullable().optional(),
        paidUntil: z.string().nullable().optional().describe("Client billing: the last paid day, YYYY-MM-DD; null stops tracking payments"),
        contractEnd: z.string().nullable().optional().describe("Client billing: the last day of the contract, YYYY-MM-DD; null clears it"),
        billingNeverPause: z.boolean().optional().describe("true: an overdue payment only warns, paid collection is never paused"),
      },
      annotations: UPSERT,
    },
    ({ slug, ...fields }) =>
      run(async () => {
        const d = await api.patch<Detail>(P(slug), fields);
        return `Updated project ${d.project.name} (slug: ${d.project.slug}).\n${passportLines(d.project)}`;
      })
  );

  server.registerTool(
    "upsert_note",
    {
      title: "Write a project note",
      description:
        "Creates or updates a markdown note of a project (brief, audience, chat, strategy, other): by id, else by kind and title. Each change keeps the version before it in the note's history. Pass baseVersion to be refused when someone changed the note since you read it. Needs a key with the write scope.",
      inputSchema: {
        slug,
        kind: z.enum(["brief", "audience", "chat", "strategy", "other"]).optional().default("other"),
        title: z.string().min(1).max(200),
        body: z.string().max(200_000).describe("The whole note in markdown; it replaces the current text"),
        id: z.string().optional().describe("The note id, to rename a note or change its kind"),
        baseVersion: z.number().int().min(1).optional().describe("The version you read, from get_project"),
      },
      annotations: UPSERT,
    },
    ({ slug, ...note }) =>
      run(async () => {
        const r = await api.post<{ note: Note; changed: boolean; created: boolean }>(`${P(slug)}/notes`, note);
        const what = r.created ? "Created" : r.changed ? "Updated" : "Unchanged:";
        return `${what} note [${r.note.kind}] ${r.note.title} (id ${r.note.id}), version ${r.note.version}.`;
      })
  );

  server.registerTool(
    "add_journal_entry",
    {
      title: "Add a journal entry",
      description:
        "Adds a dated line to a project's journal: what was done, where, with a link. The same date, text and link again is not added twice, so a retry is safe. Needs a key with the write scope.",
      inputSchema: {
        slug,
        text: z.string().min(1).max(5000),
        date: day.optional().describe("The day the work was done, YYYY-MM-DD. Default: today (UTC)"),
        link: z.string().max(2048).optional().describe("An http(s) link to the result"),
        siteId: z.string().optional().describe("A site of the project, from get_project"),
        author: z.string().max(100).optional().describe('Who did it, e.g. "seo-agent". Default: the key'),
      },
      annotations: UPSERT,
    },
    ({ slug, ...entry }) =>
      run(async () => {
        const r = await api.post<{ entry: Entry; created: boolean }>(`${P(slug)}/journal`, entry);
        return `${r.created ? "Added" : "Already there:"} ${r.entry.date} ${cut(r.entry.text, 120)} (id ${r.entry.id}).`;
      })
  );

  server.registerTool(
    "upsert_task",
    {
      title: "Write a project task",
      description:
        "Creates or updates a task of a project: by id, else by externalKey (your own id for the task, so a sync can update it without knowing ours), else a new task. Needs a key with the write scope.",
      inputSchema: {
        slug,
        title: z.string().min(1).max(300),
        id: z.string().optional(),
        externalKey: z.string().max(100).optional(),
        status: z.enum(["todo", "doing", "review", "done"]).optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        due: day.nullable().optional().describe("YYYY-MM-DD, or null to clear it"),
        assignee: z.string().max(100).nullable().optional(),
        notes: z.string().max(10_000).nullable().optional(),
      },
      annotations: UPSERT,
    },
    ({ slug, ...task }) =>
      run(async () => {
        const r = await api.post<{ task: Task; created: boolean }>(`${P(slug)}/tasks`, task);
        return `${r.created ? "Created" : "Updated"} task [${r.task.status}] ${r.task.title} (id ${r.task.id}${r.task.externalKey ? `, key ${r.task.externalKey}` : ""}).`;
      })
  );

  server.registerTool(
    "get_project_budget",
    {
      title: "Project budget",
      description:
        "A client project's budget for a month: the plan by category, the actual spending (entries plus automatic service costs: rank checks x price per check), plan vs actual and % used, the entries, and the last 6 months.",
      inputSchema: { slug, month: monthArg },
      annotations: readOnly,
    },
    ({ slug, month }) =>
      run(async () => formatBudget(await api.get<Budget>(`${P(slug)}/budget`, { month })))
  );

  server.registerTool(
    "get_rank_usage",
    {
      title: "Rank check usage",
      description:
        "Rank check usage. With slug: the project's rank tracking settings (on/off, source, frequency, engines), planned checks per month and the runs of the month with their checks and cost. Without slug: every provider's planned and started checks across all projects against its monthly limit.",
      inputSchema: { slug: slug.optional(), month: monthArg },
      annotations: readOnly,
    },
    ({ slug, month }) =>
      run(async () => {
        if (!slug) {
          const r = await api.get<{ month: string; rank: ProviderUsage[] }>("/projects/_summary", { month });
          return formatProviderUsage(r.month, r.rank);
        }
        const [settings, usage] = await Promise.all([
          api.get<RankSettings>(`${P(slug)}/rank-settings`),
          api.get<RankUsage>(`${P(slug)}/rank-usage`, { month }),
        ]);
        return formatRankUsage(settings, usage);
      })
  );

  server.registerTool(
    "add_budget_entry",
    {
      title: "Add a budget entry",
      description:
        "Adds an actual cost to a project's budget: date, category (one of the project's categories, see get_project_budget), amount in the project's currency, a note. With externalKey (your own id, e.g. an invoice number) the same key again updates that entry instead of adding one, so a retry is safe. Needs a key with the write scope.",
      inputSchema: {
        slug,
        category: z.string().min(1).max(40),
        amount: z.number().describe("In the project's currency; negative for a refund"),
        date: day.optional().describe("YYYY-MM-DD. Default: today (UTC)"),
        note: z.string().max(500).optional(),
        externalKey: z.string().max(100).optional(),
      },
      annotations: UPSERT,
    },
    ({ slug, ...entry }) =>
      run(async () => {
        const r = await api.post<{ entry: { id: string; date: string; category: string; amount: number }; created: boolean }>(`${P(slug)}/budget-entries`, entry);
        return `${r.created ? "Added" : "Updated"} ${r.entry.date} ${r.entry.category} ${r.entry.amount} (id ${r.entry.id}).`;
      })
  );
}
