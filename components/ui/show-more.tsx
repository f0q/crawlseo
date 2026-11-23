"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";

/*
 * Agency fork: long tables (Keywords, Positions) render a page of rows and
 * grow on "Show more", so a site with a thousand queries is not a page tens
 * of thousands of pixels tall. Filtering and sorting still run on the whole
 * set first; CSV export is server side and always has every row.
 */

export const TABLE_PAGE_SIZE = 100;

/** How many rows to render: grows by a page on "Show more", back to one page whenever `resetKey` (filters, sort) changes. */
export function useShowMore(resetKey: string, pageSize = TABLE_PAGE_SIZE) {
  const [state, setState] = useState({ key: resetKey, limit: pageSize });
  const limit = state.key === resetKey ? state.limit : pageSize;
  return {
    limit,
    more: () => setState({ key: resetKey, limit: limit + pageSize }),
    all: () => setState({ key: resetKey, limit: Number.POSITIVE_INFINITY }),
  };
}

/** The rows of the first `limit`, and how many are shown and left. */
export function visibleRows<T>(rows: T[], limit: number): { rows: T[]; shown: number; hidden: number } {
  const shown = Math.min(rows.length, Math.max(0, limit));
  return { rows: shown === rows.length ? rows : rows.slice(0, shown), shown, hidden: rows.length - shown };
}

/** "Show 100 more" and "Show all 1,234" under a table, while rows are hidden. */
export function ShowMore({
  hidden,
  total,
  pageSize = TABLE_PAGE_SIZE,
  onMore,
  onAll,
}: {
  hidden: number;
  total: number;
  pageSize?: number;
  onMore: () => void;
  onAll: () => void;
}) {
  if (hidden <= 0) return null;
  const next = Math.min(pageSize, hidden);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" onClick={onMore} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Show {next.toLocaleString("en-US")} more
      </button>
      {hidden > next && (
        <button type="button" onClick={onAll} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Show all {total.toLocaleString("en-US")}
        </button>
      )}
    </div>
  );
}
