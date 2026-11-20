/**
 * The rank tracking tools of the agency fork: positions from any rank source
 * linked to a site (a provider such as Labrika, a CSV import, or a script),
 * read through /api/v1 like every other tool, and push_positions, the one
 * tool that writes, which needs a key with the write scope.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ApiClient } from "./api-client";
import { formatTable } from "./formatters";

type Buckets = { top3: number; top10: number; top30: number; notRanked: number; total: number };

type Engine = { id: string; label: string; host: string; source: string; sourceName: string; externalEngineId: string };

export type RankPositions = {
  engine: Engine;
  engines: Engine[];
  date: string | null;
  previousDate: string | null;
  summary: { current: Buckets; previous: Buckets | null };
  totalKeywords: number;
  keywords: {
    keyword: string;
    frequency: number | null;
    position: number | null;
    previousPosition: number | null;
    change: number | null;
    movement: "new" | "lost" | null;
    url: string | null;
  }[];
  trend: (Buckets & { date: string })[];
};

function delta(now: number, before: number | null | undefined): string {
  if (before === null || before === undefined) return "";
  const d = now - before;
  return d === 0 ? " (=)" : ` (${d > 0 ? "+" : ""}${d})`;
}

export function formatPositions(r: RankPositions, limit: number): string {
  const others = r.engines.filter((e) => e.id !== r.engine.id);
  const head =
    `Positions for ${r.engine.host}, ${r.engine.label}, source ${r.engine.sourceName} (engine ${r.engine.id})` +
    (others.length ? `\nOther engines: ${others.map((e) => `${e.label} [${e.sourceName}] (${e.id})`).join(", ")}` : "");
  if (!r.date) return `${head}\nNo checks stored yet.`;

  const { current: c, previous: p } = r.summary;
  const summary =
    `Check ${r.date}${r.previousDate ? `, compared with ${r.previousDate}` : " (first check)"}: ` +
    `${c.total} keywords. Top 3: ${c.top3}${delta(c.top3, p?.top3)}, top 10: ${c.top10}${delta(c.top10, p?.top10)}, ` +
    `top 30: ${c.top30}${delta(c.top30, p?.top30)}, not ranked: ${c.notRanked}${delta(c.notRanked, p?.notRanked)}.`;

  const rows = r.keywords.slice(0, limit).map((k) => [
    k.keyword.length > 50 ? k.keyword.slice(0, 47) + "..." : k.keyword,
    k.frequency === null ? "-" : String(k.frequency),
    k.position === null ? "-" : String(k.position),
    k.movement ?? (k.change === null ? "" : k.change > 0 ? `+${k.change}` : String(k.change)),
    k.url ?? "",
  ]);
  const trend =
    r.trend.length > 1
      ? "\n\nTrend (date: top3/top10/top30/not ranked): " +
        r.trend.map((t) => `${t.date}: ${t.top3}/${t.top10}/${t.top30}/${t.notRanked}`).join(", ")
      : "";

  return (
    `${head}\n${summary}\n` +
    `Positions are whole ranks on that check; "-" is not in the depth the source checks. Change is places gained since the previous check.\n\n` +
    formatTable(["Keyword", "Freq", "Pos", "Change", "URL"], rows) +
    (r.totalKeywords > rows.length ? `\n(${rows.length} of ${r.totalKeywords} keywords, best positions first)` : "") +
    trend
  );
}

export const RANK_TOOL_NAMES = ["get_positions"] as const;
export const RANK_WRITE_TOOL_NAMES = ["push_positions"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** Writes rows, and a retry writes the same rows: idempotent, not destructive, only to the user's own instance. */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerRankTools(
  server: McpServer,
  api: ApiClient,
  run: (fn: () => Promise<string>) => Promise<CallToolResult>,
  readOnly: Record<string, boolean>
): void {
  server.registerTool(
    "get_positions",
    {
      title: "Keyword positions",
      description:
        "Keyword positions of a site from a rank source (a rank tracker such as Labrika, a CSV import, or positions a script pushed) for one search engine, region and device: each keyword's position and ranking URL on a check, the change since the previous check, search volume when the source has it, the top 3/10/30 and not-ranked counts, and their trend. The answer lists the site's other engines and their sources.",
      inputSchema: {
        siteId: z.string().describe("The site ID, from list_sites"),
        engineId: z.string().optional().describe("The engine: its crawlseo id or the provider's engine id. Default: the first engine; the answer lists the others"),
        source: z.string().optional().describe('Only engines of this source, e.g. "labrika", "import" or a pushed source name'),
        date: day.optional().describe("A check date, YYYY-MM-DD. Default: the latest check in from..to"),
        from: day.optional().describe("Consider checks from this day, YYYY-MM-DD"),
        to: day.optional().describe("Consider checks up to this day, YYYY-MM-DD, included"),
        limit: z.number().int().min(1).max(1000).optional().default(100).describe("Most keywords to list (default 100)"),
      },
      annotations: readOnly,
    },
    ({ siteId, engineId, source, date, from, to, limit }) =>
      run(async () => {
        const r = await api.get<RankPositions>(`/sites/${encodeURIComponent(siteId)}/positions`, {
          engine: engineId,
          source,
          date,
          from,
          to,
          limit,
          checks: 30,
        });
        return formatPositions(r, limit);
      })
  );

  server.registerTool(
    "push_positions",
    {
      title: "Push keyword positions",
      description:
        "Stores keyword positions you collected yourself (a parser, another rank tracker) for a site, under a source name of yours and one search engine, region and device. Writing the same keyword on the same day again replaces it, so a retry is safe. Needs an access key with the write scope (Settings > MCP); a read-only key is refused. At most 5000 rows per call.",
      inputSchema: {
        siteId: z.string().describe("The site ID, from list_sites"),
        source: z
          .string()
          .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/)
          .describe('Your name for where the positions come from, e.g. "xmlriver-parser": 2 to 32 of a-z, 0-9, - and _'),
        engine: z.string().min(1).max(60).describe('The search engine, e.g. "Яндекс" or "Google"'),
        region: z.string().max(120).optional().default("").describe('The region, e.g. "Москва"'),
        device: z.string().max(30).optional().default("").describe('"desktop" or "mobile"; desktop when left out'),
        label: z.string().max(60).optional().default("").describe("An optional label, to keep two runs of the same source apart"),
        rows: z
          .array(
            z.object({
              keyword: z.string().min(1).max(500),
              date: day,
              position: z.number().int().min(1).max(1000).nullable().describe("The rank, or null when the site was not found"),
              url: z.string().max(2048).nullable().optional(),
              frequency: z.number().int().min(0).nullable().optional(),
            })
          )
          .min(1)
          .max(5000),
      },
      annotations: WRITE,
    },
    ({ siteId, ...batch }) =>
      run(async () => {
        const r = await api.post<{ engineId: string; engineCreated: boolean; rowsWritten: number; dates: string[] }>(
          `/sites/${encodeURIComponent(siteId)}/positions`,
          batch
        );
        const days = r.dates.length === 1 ? r.dates[0] : `${r.dates[0]} to ${r.dates.at(-1)} (${r.dates.length} days)`;
        return (
          `Stored ${r.rowsWritten} position(s) for ${days} under source ${batch.source}, ` +
          `engine ${r.engineId}${r.engineCreated ? " (new engine)" : ""}. Read them back with get_positions.`
        );
      })
  );
}
