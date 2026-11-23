import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrendPoint } from "@/lib/rank-providers/report";
import { PositionsTrendChart, trendLineMax } from "./positions-trend-chart";

// Agency fork: "not ranked" is a band of its own, so its big count does not flatten the top 3/10/30 lines.

const points: TrendPoint[] = [
  { date: "2026-11-01", top3: 4, top10: 12, top30: 30, notRanked: 400, total: 450 },
  { date: "2026-11-08", top3: 6, top10: 15, top30: 33, notRanked: 390, total: 450 },
];

describe("PositionsTrendChart", () => {
  it("scales the lines to the top 30 count, not to the keywords not ranked", () => {
    expect(trendLineMax(points)).toBe(33);
    expect(trendLineMax([{ date: "x", top3: 0, top10: 0, top30: 0, notRanked: 9, total: 9 }])).toBe(1);
  });

  it("draws not ranked as a band under the lines, with its count", () => {
    const html = renderToStaticMarkup(<PositionsTrendChart points={points} />);
    expect(html).toContain('data-band="not-ranked"');
    expect(html).toContain("Not ranked (band below");
    expect(html).toContain("Not ranked: 390 of 450");
    // The y axis tops out at the top 30 count.
    expect(html).toMatch(/>33<\/text>/);
    expect(html).not.toMatch(/>400<\/text>/);
    // Three lines, no dashed fourth one.
    expect((html.match(/<polyline/g) ?? []).length).toBe(3);
  });
});
