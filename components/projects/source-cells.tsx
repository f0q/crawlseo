import Link from "next/link";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { SOURCE_IDS, type CellState, type SourceCell, type SourceProjectRow } from "@/lib/projects/sources";
import { cn } from "@/lib/utils";

/* Agency fork: how a data source cell looks (lib/projects/sources.ts), shared by the panel, the home and the Overview. */

const T = M.sources;

const DOT: Record<CellState, string> = {
  ok: "bg-success border-success",
  waiting: "bg-bg-section border-success",
  stale: "bg-warning border-warning",
  error: "bg-danger border-danger",
  off: "bg-transparent border-border",
  "not-connected": "bg-transparent border-border",
  "paused-billing": "bg-transparent border-warning border-dashed",
  "paused-status": "bg-transparent border-line-strong border-dashed",
  "no-site": "bg-transparent border-border",
};

const TEXT: Record<CellState, string> = {
  ok: "text-success",
  waiting: "text-muted-foreground",
  stale: "text-warning",
  error: "text-danger",
  off: "text-muted-foreground",
  "not-connected": "text-muted-foreground",
  "paused-billing": "text-warning",
  "paused-status": "text-muted-foreground",
  "no-site": "text-muted-foreground",
};

export const stateLabel = (state: CellState) => T.states[state] ?? state;

/** One line for a title attribute or a screen reader: source, state, last sync (in the user's zone), error. */
export function cellSummary(source: string, c: SourceCell, timeZone?: string): string {
  return [
    `${T.names[source] ?? source}${c.paid ? ` (${T.paidMark})` : ""}: ${stateLabel(c.state)}`,
    c.lastSync ? T.synced(formatDay(c.lastSync, { year: true, time: true, timeZone })) : null,
    c.error,
  ]
    .filter(Boolean)
    .join(". ");
}

export function StateDot({ state, className }: { state: CellState; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full border", DOT[state], className)} />;
}

/** Six dots in the order of the panel's columns, a link to the panel. */
export function SourceDots({ row, timeZone }: { row: SourceProjectRow; timeZone?: string }) {
  const summary = SOURCE_IDS.map((id) => cellSummary(id, row.cells[id], timeZone)).join("; ");
  const counted = SOURCE_IDS.filter((id) => !["not-connected", "no-site", "off"].includes(row.cells[id].state));
  const ok = counted.filter((id) => row.cells[id].state === "ok").length;
  return (
    <Link href={`/projects/sources#p-${row.slug}`} title={summary} aria-label={M.home.dotsLabel(summary)} className="inline-flex items-center gap-2 hover:opacity-80">
      <span className="inline-flex gap-1">
        {SOURCE_IDS.map((id) => (
          <StateDot key={id} state={row.cells[id].state} />
        ))}
      </span>
      <span className="font-data text-[12px] text-muted-foreground">{counted.length ? T.columnTotal(ok, counted.length) : M.home.noData}</span>
    </Link>
  );
}

/** A cell of the panel: the state, the last sync, the error on hover (and as text for screen readers). */
export function SourceCellView({ source, cell, timeZone }: { source: string; cell: SourceCell; timeZone?: string }) {
  const body = (
    <span className="flex flex-col gap-0.5" title={cellSummary(source, cell, timeZone)}>
      <span className={cn("inline-flex items-center gap-1.5 text-[13px]", TEXT[cell.state])}>
        <StateDot state={cell.state} />
        {stateLabel(cell.state)}
      </span>
      {cell.lastSync && <span className="font-data text-[11px] text-muted-foreground">{formatDay(cell.lastSync, { year: true, timeZone })}</span>}
      {cell.error && <span className="line-clamp-2 max-w-[180px] text-[11px] leading-4 text-danger">{cell.error}</span>}
    </span>
  );
  return cell.href ? (
    <Link href={cell.href} className="block rounded-sm hover:bg-bg-section">
      {body}
    </Link>
  ) : (
    body
  );
}

/** The project's data sources in one row (Overview). */
export function SourcesStrip({ row, timeZone }: { row: SourceProjectRow; timeZone?: string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {SOURCE_IDS.map((id) => (
        <li key={id} className="flex flex-col gap-1">
          <span className="mono-label text-[11px] text-muted-foreground">
            {T.names[id]}
            {row.cells[id].paid ? ` · ${T.paidMark}` : ""}
          </span>
          <SourceCellView source={id} cell={row.cells[id]} timeZone={timeZone} />
        </li>
      ))}
    </ul>
  );
}
