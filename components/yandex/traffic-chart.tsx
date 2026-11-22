import { formatDay } from "@/lib/format";
import { sourceLabel, YANDEX_UI } from "@/lib/yandex/messages";

const T = YANDEX_UI.chart;

type Point = { date: string; visits: number; bySource: Record<string, number> };

/** Total first, then the largest sources; the same tokens as the other charts. */
const STYLES = [
  { className: "stroke-chart-1", swatch: "bg-chart-1" },
  { className: "stroke-success", swatch: "bg-success" },
  { className: "stroke-warning", swatch: "bg-warning" },
  { className: "stroke-chart-2", swatch: "bg-chart-2" },
  { className: "stroke-brand-300", swatch: "bg-brand-300", dashed: true },
];

const W = 720;
const H = 220;
const PAD = { top: 10, right: 12, bottom: 24, left: 40 };

/**
 * Metrika visits per day: the total and the four largest traffic sources of
 * the period, one line each, plain SVG like the Positions trend chart.
 */
export function YandexTrafficChart({ points, sources }: { points: Point[]; sources: { key: string; name: string }[] }) {
  if (points.length < 2) {
    return (
      <section className="panel flex h-[160px] flex-col items-center justify-center gap-1 px-5">
        <h2 className="text-[15px] leading-5 font-semibold">{T.title}</h2>
        <p className="text-sm text-muted-foreground">{T.empty}</p>
      </section>
    );
  }

  const series = [
    { key: "__total", label: YANDEX_UI.cards.visits, value: (p: Point) => p.visits },
    ...sources.slice(0, STYLES.length - 1).map((s) => ({ key: s.key, label: sourceLabel(s.key, s.name), value: (p: Point) => p.bySource[s.key] ?? 0 })),
  ].map((s, i) => ({ ...s, ...STYLES[i] }));

  const max = Math.max(1, ...points.map((p) => p.visits));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i * innerW) / (points.length - 1);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, Math.round(max / 2), max];
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <section className="panel flex flex-col gap-4 px-[22px] py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] leading-5 font-semibold">{T.title}</h2>
        <div className="flex flex-wrap gap-[18px] text-[12px] leading-4 text-muted-foreground">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-[2px] ${s.swatch}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={T.title}>
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
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeDasharray={"dashed" in s && s.dashed ? "4 3" : undefined}
            className={s.className}
            points={points.map((p, i) => `${x(i)},${y(s.value(p))}`).join(" ")}
          >
            <title>{s.label}</title>
          </polyline>
        ))}
      </svg>
    </section>
  );
}
