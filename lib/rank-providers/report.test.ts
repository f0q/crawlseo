import { describe, expect, it } from "vitest";
import { bucketsOf, compareChecks } from "./report";

const row = (keyword: string, position: number | null) => ({
  keyword,
  position,
  url: position ? `https://a.example/${keyword}` : null,
  frequency: 10,
  frequencyExact: 1,
});

describe("bucketsOf", () => {
  it("counts cumulative top buckets and keeps not ranked apart", () => {
    expect(bucketsOf([1, 3, 4, 10, 11, 30, 31, null, null])).toEqual({
      top3: 2,
      top10: 4,
      top30: 6,
      notRanked: 2,
      total: 9,
    });
  });
});

describe("compareChecks", () => {
  it("gives places gained, and marks entries into and out of the ranking", () => {
    const rows = compareChecks(
      [row("up", 2), row("down", 9), row("in", 7), row("out", null), row("fresh", 4), row("still out", null)],
      [row("up", 5), row("down", 6), row("in", null), row("out", 3), row("still out", null)]
    );
    const byKeyword = Object.fromEntries(rows.map((r) => [r.keyword, r]));
    expect(byKeyword.up).toMatchObject({ change: 3, movement: null, previousPosition: 5 });
    expect(byKeyword.down).toMatchObject({ change: -3, movement: null });
    expect(byKeyword.in).toMatchObject({ change: null, movement: "new" });
    expect(byKeyword.out).toMatchObject({ change: null, movement: "lost" });
    // Not tracked on the previous check: no previous position, and not called new.
    expect(byKeyword.fresh).toMatchObject({ change: null, movement: null, previousPosition: null });
    expect(byKeyword["still out"]).toMatchObject({ change: null, movement: null });
  });

  it("has no change at all on the first check", () => {
    expect(compareChecks([row("a", 1)], null)[0]).toMatchObject({ change: null, movement: null, previousPosition: null });
  });
});
