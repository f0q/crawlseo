import { formatDay } from "@/lib/format";
import { RANK_UI } from "@/lib/rank-providers/messages";
import type { TrendPoint } from "@/lib/rank-providers/report";

const T = RANK_UI;

const SERIES = [
  { key: "top3", label: T.cards.top3, className: "stroke-success", swatch: "bg-success" },
  { key: "top10", label: T.cards.top10, className: "stroke-chart-1", swatch: "bg-chart-1" },
  { key: "top30", label: T.cards.top30, className: "stroke-chart-2", swatch: "bg-chart-2" },
] as const;

const W = 720;
const H = 252;
const PAD = { top: 10, right: 12, bottom: 24, left: 36 };
/** Agency fork: "not ranked" is a band of its own under the lines, so its big count does not flatten them. */
const BAND = { gap: 12, height: 26 };

/** The top of the line chart's scale: the top 3/10/30 counts only, never "not ranked". */
export function trendLineMax(points: TrendPoint[]): number {
  return Math.max(1, ...points.map((p) => Math.max(p.top3, p.top10, p.top30)));
}

/**
 * Keywords in the top 3, 10 and 30 per check, one line each, plain SVG like
 * the other charts; keywords not ranked as a band under them, on their own
 * scale. Checks are spaced evenly, not by calendar distance, because tracker
 * checks run when the project owner sets them.
 */
export function PositionsTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <section className="panel flex h-[160px] flex-col items-center justify-center gap-1 px-5">
        <h2 className="text-[15px] leading-5 font-semibold">{T.chart.title}</h2>
        <p className="text-sm text-muted-foreground">{T.chart.empty}</p>
      </section>
    );
  }

  const max = trendLineMax(points);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom - BAND.gap - BAND.height;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  // The band: the share of keywords not ranked, 0 at its bottom edge, every keyword at its top.
  const bandTop = PAD.top + innerH + BAND.gap;
  const bandBottom = bandTop + BAND.height;
  const share = (p: TrendPoint) => (p.total > 0 ? Math.min(1, p.notRanked / p.total) : 0);
  const bandY = (p: TrendPoint) => bandBottom - share(p) * BAND.height;
  const area = [
    `${x(0)},${bandBottom}`,
    ...points.map((p, i) => `${x(i)},${bandY(p)}`),
    `${x(points.length - 1)},${bandBottom}`,
  ].join(" ");
  const last = points[points.length - 1];

  return (
    <section className="panel flex flex-col gap-4 px-[22px] py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] leading-5 font-semibold">{T.chart.title}</h2>
        <div className="flex flex-wrap gap-[18px] text-[12px] leading-4 text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-[2px] ${s.swatch}`} />
              {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-danger/40" />
            {T.chart.notRankedBand}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={T.chart.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border-soft" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground font-data text-[11px]">
              {t}
            </text>
          </g>
        ))}
        {labels.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground font-data text-[11px]"
          >
            {formatDay(points[i].date)}
          </text>
        ))}
        {SERIES.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className={s.className}
              points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(" ")}
            />
            {points.map((p, i) => (
              <circle key={p.date} cx={x(i)} cy={y(p[s.key])} r={2.5} className={`${s.className} fill-bg`}>
                <title>{`${formatDay(p.date, { year: true })} · ${s.label}: ${p[s.key]} of ${p.total}`}</title>
              </circle>
            ))}
          </g>
        ))}
        <g data-band="not-ranked">
          <rect x={PAD.left} y={bandTop} width={innerW} height={BAND.height} className="fill-bg-soft stroke-border-soft" strokeWidth={1} />
          <polygon points={area} className="fill-danger" fillOpacity={0.25} />
          <text x={PAD.left - 6} y={bandTop + BAND.height / 2 + 4} textAnchor="end" className="fill-muted-foreground font-data text-[11px]">
            {last.notRanked}
          </text>
          {points.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={bandY(p)} r={2} className="fill-danger">
              <title>{`${formatDay(p.date, { year: true })} · ${T.cards.notRanked}: ${p.notRanked} of ${p.total}`}</title>
            </circle>
          ))}
        </g>
      </svg>
    </section>
  );
}
