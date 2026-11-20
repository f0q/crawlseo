import { formatDay } from "@/lib/format";
import { LABRIKA_UI } from "@/lib/labrika/messages";
import type { TrendPoint } from "@/lib/labrika/report";

const T = LABRIKA_UI;

const SERIES = [
  { key: "top3", label: T.cards.top3, className: "stroke-success", swatch: "bg-success" },
  { key: "top10", label: T.cards.top10, className: "stroke-chart-1", swatch: "bg-chart-1" },
  { key: "top30", label: T.cards.top30, className: "stroke-chart-2", swatch: "bg-chart-2" },
  { key: "notRanked", label: T.cards.notRanked, className: "stroke-danger", swatch: "bg-danger", dashed: true },
] as const;

const W = 720;
const H = 220;
const PAD = { top: 10, right: 12, bottom: 24, left: 36 };

/**
 * Keywords in the top 3, 10 and 30, and not ranked, per check: one line each,
 * plain SVG like the other charts. Checks are spaced evenly, not by calendar
 * distance, because Labrika checks run when the project owner sets them.
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

  const max = Math.max(1, ...points.map((p) => Math.max(p.top30, p.notRanked)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, Math.round(max / 2), max];
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

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
              strokeDasharray={"dashed" in s ? "4 3" : undefined}
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
      </svg>
    </section>
  );
}
