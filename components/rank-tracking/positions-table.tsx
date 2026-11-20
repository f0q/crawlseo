"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { positionBand } from "@/lib/seo-metrics";
import { RANK_UI } from "@/lib/rank-providers/messages";
import type { KeywordPosition } from "@/lib/rank-providers/report";
import {
  MetricTable,
  NumCell,
  SearchField,
  sortLabel,
  sortRows,
  useTableSort,
  type MetricHeader,
} from "@/components/ui/data-table";

const T = RANK_UI.table;

const HEADERS: MetricHeader[] = [
  { label: T.keyword, sortKey: "keyword", defaultDir: "asc" },
  { label: T.frequency, align: "right", sortKey: "frequency" },
  { label: T.frequencyExact, align: "right", sortKey: "frequencyExact" },
  { label: T.position, align: "right", sortKey: "position", defaultDir: "asc" },
  { label: T.change, align: "right", sortKey: "changeSort" },
  { label: T.url, sortKey: "url", defaultDir: "asc" },
];

/** A whole-number rank in the app's position colours; tracker ranks are per check, never averaged. */
function RankBadge({ position }: { position: number }) {
  const band = positionBand(position);
  return (
    <span
      className={cn(
        "inline-flex min-w-10 items-center justify-center rounded-md px-2 py-0.5 font-data text-[12px]",
        band === "top3" && "rank-top3",
        band === "top10" && "rank-top10",
        band === "top20" && "rank-top20",
        band === "deep" && "rank-deep"
      )}
    >
      {position}
    </span>
  );
}

function ChangeCell({ row }: { row: KeywordPosition }) {
  if (row.movement === "new") return <span className="mono-label text-[11px] text-success">{T.newEntry}</span>;
  if (row.movement === "lost") return <span className="mono-label text-[11px] text-danger">{T.lost}</span>;
  if (row.change === null || row.change === 0) return <span className="text-muted-foreground">·</span>;
  return (
    <span className={cn("font-data", row.change > 0 ? "text-success" : "text-danger")}>
      {row.change > 0 ? `+${row.change}` : `−${Math.abs(row.change)}`}
    </span>
  );
}

/** Movement as one sortable number: a new entry ranks as the biggest gain, a lost one as the biggest drop. */
function changeSort(row: KeywordPosition): number | null {
  if (row.movement === "new") return 1_000;
  if (row.movement === "lost") return -1_000;
  return row.change;
}

/**
 * The positions of another source of the same search engine, region and
 * device, keyed by keyword in lower case. A keyword missing here was not
 * checked by that source.
 */
export type PositionsComparison = {
  source: string;
  byKeyword: Record<string, { position: number | null; url: string | null }>;
};

function DiffCell({ diff }: { diff: number | null }) {
  if (diff === null || diff === 0) return <span className="text-muted-foreground">·</span>;
  return (
    <span className={cn("font-data", diff > 0 ? "text-success" : "text-danger")}>
      {diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`}
    </span>
  );
}

export function PositionsTable({ rows, comparison }: { rows: KeywordPosition[]; comparison?: PositionsComparison }) {
  const [search, setSearch] = useState("");
  const { sort, toggle } = useTableSort({ key: "position", dir: "asc" });
  const deferred = useDeferredValue(search.trim().toLowerCase());

  const headers: MetricHeader[] = comparison
    ? [
        ...HEADERS.slice(0, 5),
        { label: T.other(comparison.source), align: "right", sortKey: "otherPosition", defaultDir: "asc" },
        { label: T.otherDiff, align: "right", sortKey: "diff" },
        HEADERS[5],
      ]
    : HEADERS;

  const filtered = useMemo(() => {
    const withSort = rows.map((r) => {
      const other = comparison?.byKeyword[r.keyword.toLowerCase()];
      const otherPosition = other?.position ?? null;
      // Places this source shows the keyword higher than the other one.
      const diff = r.position !== null && otherPosition !== null ? otherPosition - r.position : null;
      return { ...r, changeSort: changeSort(r), otherChecked: other !== undefined, otherPosition, diff };
    });
    const out = deferred
      ? withSort.filter((r) => r.keyword.toLowerCase().includes(deferred) || (r.url ?? "").toLowerCase().includes(deferred))
      : withSort;
    return sortRows(out, sort);
  }, [rows, comparison, deferred, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField value={search} onChange={setSearch} placeholder={T.filter} />
      </div>

      {filtered.length === 0 ? (
        <div className="panel px-4 py-10 text-center">
          <p className="font-medium text-text-strong">{T.noneMatch}</p>
          <p className="mt-1 text-sm text-muted-foreground">{T.loosen}</p>
        </div>
      ) : (
        <MetricTable
          sort={sort}
          onSort={toggle}
          headers={headers}
          footer={T.footer(filtered.length, rows.length, sortLabel(headers, sort))}
        >
          {filtered.map((r) => (
            <tr key={r.keyword} className="transition-colors hover:bg-bg-soft">
              <td className="px-4 py-3 font-medium text-text-strong">{r.keyword}</td>
              <td className="px-4 py-3 text-right">{r.frequency !== null ? <NumCell value={r.frequency} /> : "n/a"}</td>
              <td className="px-4 py-3 text-right">
                {r.frequencyExact !== null ? <NumCell value={r.frequencyExact} /> : "n/a"}
              </td>
              <td className="px-4 py-3 text-right">
                {r.position !== null ? (
                  <RankBadge position={r.position} />
                ) : (
                  <span className="mono-label text-[11px] text-muted-foreground">{T.notRanked}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <ChangeCell row={r} />
              </td>
              {comparison && (
                <>
                  <td className="px-4 py-3 text-right">
                    {r.otherPosition !== null ? (
                      <RankBadge position={r.otherPosition} />
                    ) : (
                      <span className="mono-label text-[11px] text-muted-foreground">
                        {r.otherChecked ? T.notRanked : T.notChecked}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DiffCell diff={r.diff} />
                  </td>
                </>
              )}
              <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer noopener" className="hover:text-text-strong" title={r.url}>
                    {r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </a>
                ) : (
                  "n/a"
                )}
              </td>
            </tr>
          ))}
        </MetricTable>
      )}
    </div>
  );
}
