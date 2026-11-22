/**
 * The Yandex tools of the agency fork: Yandex Webmaster and Yandex Metrika
 * data synced for a site, read through /api/v1 like every other tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ApiClient } from "./api-client";
import { formatTable } from "./formatters";

type Compare = { current: number | null; previous: number | null };
type Period = { from: string; to: string; previousFrom: string; previousTo: string; days: number } | null;

export type YandexWebmasterAnswer = {
  site: { domain: string };
  host: { id: string; url: string | null; syncedAt: string | null; lastError: string | null };
  period: Period;
  latestDate: string | null;
  cards: { sqi: Compare; searchablePages: Compare; excludedPages: Compare; problems: Compare };
  problems: { code: string; severity: string; state: string }[];
  sitemaps: { url: string; urlsCount: number | null; errorsCount: number | null }[];
  week: { from: string; to: string } | null;
  totalQueries: number;
  queries: {
    query: string;
    shows: number | null;
    clicks: number | null;
    ctr: number | null;
    avgShowPosition: number | null;
    avgClickPosition: number | null;
    previousShows: number | null;
  }[];
};

export type YandexMetrikaAnswer = {
  site: { domain: string };
  counter: { id: string; name: string | null; syncedAt: string | null; lastError: string | null };
  period: Period;
  totals: Record<"visits" | "usersPerDay" | "yandexSearchVisits" | "searchVisits" | "goalReaches" | "bounceRate" | "pageDepth" | "avgDurationSeconds", Compare>;
  sources: { key: string; name: string; visits: number; previousVisits: number }[];
  engines: { key: string; name: string; visits: number; previousVisits: number }[];
  goals: { id: string; name: string; reaches: number; previousReaches: number }[];
  daily: { date: string; visits: number; users: number }[];
};

const n = (v: number | null) => (v === null ? "-" : String(v));

function compare(label: string, c: Compare): string {
  if (c.current === null) return `${label}: -`;
  if (c.previous === null) return `${label}: ${c.current}`;
  const d = Math.round((c.current - c.previous) * 100) / 100;
  return `${label}: ${c.current} (${d === 0 ? "=" : `${d > 0 ? "+" : ""}${d}`} vs ${c.previous})`;
}

export function formatYandexWebmaster(r: YandexWebmasterAnswer, limit: number): string {
  const head = `Yandex Webmaster for ${r.site.domain}, host ${r.host.url ?? r.host.id}` + (r.host.syncedAt ? `, synced ${r.host.syncedAt.slice(0, 16).replace("T", " ")} UTC` : "");
  if (!r.latestDate && r.queries.length === 0) return `${head}\nNo data synced yet.${r.host.lastError ? `\nLast sync error: ${r.host.lastError}` : ""}`;
  const c = r.cards;
  const cards =
    `As of ${r.latestDate}${r.period ? `, compared with ${r.period.previousTo}` : ""}: ` +
    [compare("SQI", c.sqi), compare("pages in search", c.searchablePages), compare("excluded pages", c.excludedPages), compare("site problems", c.problems)].join(", ") +
    ".";
  const problems = r.problems.length
    ? `\nProblems present: ${r.problems.map((p) => `${p.code} (${p.severity})`).join(", ")}`
    : "\nNo problems present.";
  const sitemaps = r.sitemaps.length ? `\nSitemaps: ${r.sitemaps.map((s) => `${s.url} (${n(s.urlsCount)} URLs, ${n(s.errorsCount)} errors)`).join(", ")}` : "";
  const rows = r.queries.slice(0, limit).map((q) => [
    q.query.length > 50 ? q.query.slice(0, 47) + "..." : q.query,
    n(q.shows),
    n(q.clicks),
    q.ctr === null ? "-" : `${q.ctr}%`,
    q.avgShowPosition === null ? "-" : q.avgShowPosition.toFixed(1),
    q.avgClickPosition === null ? "-" : q.avgClickPosition.toFixed(1),
    n(q.previousShows),
  ]);
  const queries = r.week
    ? `\n\nTop queries, week ${r.week.from} to ${r.week.to} (${r.totalQueries} stored):\n` +
      formatTable(["Query", "Shows", "Clicks", "CTR", "Avg pos", "Click pos", "Shows prev wk"], rows)
    : "\n\nNo search query weeks stored yet.";
  return `${head}\n${cards}${problems}${sitemaps}${queries}${r.host.lastError ? `\nLast sync error: ${r.host.lastError}` : ""}`;
}

export function formatYandexMetrika(r: YandexMetrikaAnswer): string {
  const head =
    `Yandex Metrika for ${r.site.domain}, counter ${r.counter.name ?? ""} (${r.counter.id})` +
    (r.counter.syncedAt ? `, synced ${r.counter.syncedAt.slice(0, 16).replace("T", " ")} UTC` : "");
  if (!r.period) return `${head}\nNo data synced yet.${r.counter.lastError ? `\nLast sync error: ${r.counter.lastError}` : ""}`;
  const t = r.totals;
  const p = r.period;
  const summary =
    `${p.from} to ${p.to} (${p.days} days) vs ${p.previousFrom} to ${p.previousTo}: ` +
    [
      compare("visits", t.visits),
      compare("users per day", t.usersPerDay),
      compare("visits from Yandex search", t.yandexSearchVisits),
      compare("all search visits", t.searchVisits),
      compare("goal reaches", t.goalReaches),
      compare("bounce rate %", t.bounceRate),
      compare("page depth", t.pageDepth),
      compare("avg visit seconds", t.avgDurationSeconds),
    ].join(", ") +
    ".";
  const table = (title: string, list: { name: string; now: number; before: number }[]) =>
    list.length ? `\n\n${title}:\n` + formatTable(["Name", "Now", "Before"], list.map((x) => [x.name, String(x.now), String(x.before)])) : "";
  const daily = r.daily.length ? `\n\nDaily visits: ${r.daily.map((d) => `${d.date}: ${d.visits}`).join(", ")}` : "";
  return (
    `${head}\n${summary}` +
    table("Traffic sources", r.sources.map((s) => ({ name: `${s.name} [${s.key}]`, now: s.visits, before: s.previousVisits }))) +
    table("Search engines (search traffic)", r.engines.map((s) => ({ name: `${s.name} [${s.key}]`, now: s.visits, before: s.previousVisits }))) +
    table("Goals (reaches)", r.goals.map((g) => ({ name: `${g.name} [${g.id}]`, now: g.reaches, before: g.previousReaches }))) +
    daily +
    (r.counter.lastError ? `\nLast sync error: ${r.counter.lastError}` : "")
  );
}

export const YANDEX_TOOL_NAMES = ["get_yandex_webmaster", "get_yandex_metrika"] as const;

export function registerYandexTools(
  server: McpServer,
  api: ApiClient,
  run: (fn: () => Promise<string>) => Promise<CallToolResult>,
  readOnly: Record<string, boolean>
): void {
  const siteId = z.string().describe("The site ID, from list_sites");
  const days = z.number().int().min(1).max(365).optional().default(28).describe("Compare the last N stored days with the N before (default 28)");

  server.registerTool(
    "get_yandex_webmaster",
    {
      title: "Yandex Webmaster",
      description:
        "Yandex Webmaster data synced for a site: site quality index (SQI), pages in search, excluded pages and site problems against the start of the period, the problems Webmaster reports now, sitemaps, and the top search queries of the latest stored week (shows, clicks, CTR, average show and click position, shows the week before).",
      inputSchema: {
        siteId,
        days,
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Most queries to list (default 50)"),
      },
      annotations: readOnly,
    },
    ({ siteId, days, limit }) =>
      run(async () => {
        const r = await api.get<YandexWebmasterAnswer>(`/sites/${encodeURIComponent(siteId)}/yandex/webmaster`, { days, limit });
        return formatYandexWebmaster(r, limit);
      })
  );

  server.registerTool(
    "get_yandex_metrika",
    {
      title: "Yandex Metrika",
      description:
        "Yandex Metrika data synced for a site: visits, users per day, visits from Yandex search, all search visits, goal reaches, bounce rate, page depth and visit duration for the last N days against the N before, visits by traffic source and by search engine, reaches per tracked goal, and daily visits.",
      inputSchema: { siteId, days },
      annotations: readOnly,
    },
    ({ siteId, days }) =>
      run(async () => formatYandexMetrika(await api.get<YandexMetrikaAnswer>(`/sites/${encodeURIComponent(siteId)}/yandex/metrika`, { days })))
  );
}
