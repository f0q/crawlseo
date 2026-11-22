import { cn } from "@/lib/utils";
import { YANDEX_UI } from "@/lib/yandex/messages";

const T = YANDEX_UI.cards;

/** A number with its change against the previous period, like the Positions cards. */
export function YandexStatCard({
  label,
  current,
  previous,
  higherIsBetter = true,
  hint,
  compact = false,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  higherIsBetter?: boolean;
  /** Under the change, e.g. "as of 20 Nov". */
  hint?: string;
  compact?: boolean;
}) {
  const delta = current === null || previous === null ? null : current - previous;
  const pct = delta !== null && previous ? Math.round((delta / previous) * 1000) / 10 : null;
  const good = delta !== null && (higherIsBetter ? delta > 0 : delta < 0);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const sign = (n: number) => (n > 0 ? `+${fmt(n)}` : `−${fmt(Math.abs(n))}`);
  return (
    <div className={cn("panel flex min-w-0 flex-col gap-2", compact ? "px-4 py-3" : "px-5 py-[18px]")}>
      <p className="text-[13px] leading-5 text-muted-foreground">{label}</p>
      <p className={cn("font-data font-medium tracking-[-0.02em] text-text-strong", compact ? "text-[22px] leading-7" : "text-[30px] leading-9")}>
        {current === null ? "-" : fmt(current)}
      </p>
      <p
        className={cn(
          "mono-label truncate text-[12px] leading-4 whitespace-nowrap",
          delta === null || delta === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger"
        )}
      >
        {current === null
          ? " "
          : delta === null
            ? T.noPrevious
            : delta === 0
              ? T.noChange
              : T.change(`${sign(delta)}${pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}`)}
      </p>
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}
