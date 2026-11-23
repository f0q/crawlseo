import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeywordsTable } from "@/components/sites/keywords-table";
import { PositionsTable } from "@/components/rank-tracking/positions-table";
import type { KeywordPosition } from "@/lib/rank-providers/report";
import { TABLE_PAGE_SIZE, visibleRows } from "./show-more";

// Agency fork: Keywords and Positions render a page of rows at a time, after filtering and sorting the whole set.

const rowCount = (html: string) => (html.match(/<tr class="transition-colors/g) ?? []).length;

describe("visibleRows", () => {
  it("cuts the list at the limit and counts what is hidden", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    expect(visibleRows(rows, 100)).toMatchObject({ shown: 100, hidden: 150 });
    expect(visibleRows(rows, 100).rows.at(-1)).toBe(99);
    expect(visibleRows(rows, Number.POSITIVE_INFINITY)).toMatchObject({ shown: 250, hidden: 0 });
    expect(visibleRows(rows, Number.POSITIVE_INFINITY).rows).toBe(rows);
    expect(visibleRows([], 100)).toMatchObject({ shown: 0, hidden: 0 });
  });
});

describe("long tables", () => {
  it("Keywords shows the first page, sorted on every row, with Show more", () => {
    const keywords = Array.from({ length: 250 }, (_, i) => ({ query: `q${i}`, clicks: i, impressions: 1000 + i, position: 5, ctr: 0.01 }));
    const html = renderToStaticMarkup(<KeywordsTable keywords={keywords} />);
    expect(rowCount(html)).toBe(TABLE_PAGE_SIZE);
    // Sorted by clicks on the whole set first: the top row is the last of the input.
    expect(html.indexOf(">q249<")).toBeGreaterThan(-1);
    expect(html).not.toContain(">q0<");
    expect(html).toContain("Showing 100 of 250 keywords");
    expect(html).toContain("Show 100 more");
    expect(html).toContain("Show all 250");
  });

  it("a short table has no Show more", () => {
    const html = renderToStaticMarkup(<KeywordsTable keywords={[{ query: "a", clicks: 1, impressions: 2, position: 3, ctr: 0.5 }]} />);
    expect(rowCount(html)).toBe(1);
    expect(html).not.toContain("Show ");
  });

  it("Positions shows the first page with Show more", () => {
    const rows: KeywordPosition[] = Array.from({ length: 130 }, (_, i) => ({
      keyword: `k${i}`,
      frequency: null,
      frequencyExact: null,
      position: i + 1,
      previousPosition: null,
      change: null,
      movement: null,
      url: null,
    }));
    const html = renderToStaticMarkup(<PositionsTable rows={rows} />);
    expect(rowCount(html)).toBe(100);
    expect(html).toContain("Showing 100 of 130 keywords");
    expect(html).toContain("Show 30 more");
    expect(html).not.toContain("Show all");
  });
});
