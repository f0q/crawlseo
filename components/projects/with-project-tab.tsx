"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Agency fork: the `?tab=` of the open project page, for the sidebar, the
 * switcher and the mobile strip. Behind a Suspense boundary, so a statically
 * rendered page never fails on the search params; until they are known the
 * project's Overview counts as open.
 */
export function WithProjectTab({ children }: { children: (tab: string | null) => ReactNode }) {
  return (
    <Suspense fallback={children(null)}>
      <TabReader>{children}</TabReader>
    </Suspense>
  );
}

function TabReader({ children }: { children: (tab: string | null) => ReactNode }) {
  return children(useSearchParams().get("tab"));
}
