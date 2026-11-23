"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContextNav } from "@/lib/projects/nav-items";

/**
 * Agency fork: on a phone, the client's navigation is this strip under the
 * header instead of the sidebar: the project's sections, or on a site a line
 * back to its project and the site's pages. It scrolls sideways, fades at the
 * right edge and keeps the open item in view. Hidden from `md` up, where the
 * sidebar shows the same items (lib/projects/nav-items.ts).
 */
export function ContextStrip({ strip, label }: { strip: NonNullable<ContextNav["strip"]>; label: string }) {
  const ref = useRef<HTMLElement>(null);
  const activeHref = strip.items.find((i) => i.active)?.href ?? null;

  useEffect(() => {
    const box = ref.current;
    const item = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (box && item) box.scrollLeft = item.offsetLeft - (box.clientWidth - item.offsetWidth) / 2;
  }, [activeHref]);

  return (
    <div className="border-b border-border bg-bg md:hidden">
      {strip.back && (
        <Link
          href={strip.back.href}
          title={strip.back.title}
          className="flex h-8 max-w-full items-center gap-1 px-4 pt-1 font-data text-[12px] text-muted-foreground hover:text-text-strong"
        >
          <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{strip.back.label}</span>
        </Link>
      )}
      <div className="relative">
        <nav ref={ref} aria-label={label} className="relative flex gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {strip.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors",
                item.active ? "bg-border-soft font-medium text-text-strong" : "text-text hover:bg-bg-section hover:text-text-strong"
              )}
            >
              {item.label}
            </Link>
          ))}
          <span aria-hidden className="w-5 shrink-0" />
        </nav>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-bg to-transparent" />
      </div>
    </div>
  );
}
