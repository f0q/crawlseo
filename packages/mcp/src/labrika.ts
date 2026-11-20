/**
 * The Labrika tool of the agency fork: positions from a Labrika rank
 * tracking project, read through /api/v1 like every other tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ApiClient } from "./api-client";
import { formatTable } from "./formatters";

type Buckets = { top3: number; top10: number; top30: number; notRanked: number; total: number };

type Engine = { id: string; label: string; host: string; labrikaEngineId: string };

export type LabrikaPositions = {
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

export function formatLabrikaPositions(r: LabrikaPositions, limit: number): string {
  const others = r.engines.filter((e) => e.id !== r.engine.id);
  const head =
    `Labrika positions for ${r.engine.host}, ${r.engine.label} (engine ${r.engine.id}, Labrika ${r.engine.labrikaEngineId})` +
    (others.length ? `\nOther engines: ${others.map((e) => `${e.label} (${e.id})`).join(", ")}` : "");
  if (!r.date) return `${head}\nNo checks synced yet.`;

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
    `Positions are whole ranks on that check; "-" is not in the top Labrika checks. Change is places gained since the previous check.\n\n` +
    formatTable(["Keyword", "Freq", "Pos", "Change", "URL"], rows) +
    (r.totalKeywords > rows.length ? `\n(${rows.length} of ${r.totalKeywords} keywords, best positions first)` : "") +
    trend
  );
}

export const LABRIKA_TOOL_NAMES = ["get_labrika_positions"] as const;

export function registerLabrikaTools(
  server: McpServer,
  api: ApiClient,
  run: (fn: () => Promise<string>) => Promise<CallToolResult>,
  annotations: Record<string, boolean>
): void {
  server.registerTool(
    "get_labrika_positions",
    {
      title: "Labrika positions",
      description:
        "Keyword positions in Yandex (or another engine) from the Labrika rank tracking project linked to a site, for one search engine (a region and a device): each keyword's position and ranking URL on a check, the change since the previous check, Labrika's search volume, the top 3/10/30 and not-ranked counts, and their trend over recent checks. For sites with a Labrika engine linked in Site settings.",
      inputSchema: {
        siteId: z.string().describe("The site ID, from list_sites"),
        engineId: z.string().optional().describe("The engine: its crawlseo id or Labrika engine id. Default: the first linked engine; the answer lists the others"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional().describe("A check date, YYYY-MM-DD. Default: the latest check"),
        limit: z.number().int().min(1).max(1000).optional().default(100).describe("Most keywords to list (default 100)"),
      },
      annotations,
    },
    ({ siteId, engineId, date, limit }) =>
      run(async () => {
        const r = await api.get<LabrikaPositions>(`/sites/${encodeURIComponent(siteId)}/labrika/positions`, {
          engine: engineId,
          date,
          limit,
          checks: 30,
        });
        return formatLabrikaPositions(r, limit);
      })
  );
}
