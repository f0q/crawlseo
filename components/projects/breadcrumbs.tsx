import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string; mono?: boolean };

/**
 * Agency fork: the path by the hierarchy above a project or site page,
 * `Projects / project / domain` or `Projects / project / section`. One look
 * everywhere, no chevron. Hidden on a phone: the header and the strip under it
 * say where you are.
 */
export function Breadcrumbs({ label, items }: { label: string; items: Crumb[] }) {
  return (
    <nav aria-label={label} className="mb-3 hidden min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground md:flex">
      {items.map((c, i) => (
        <Fragment key={`${i}-${c.label}`}>
          {i > 0 && <span aria-hidden>/</span>}
          {c.href ? (
            <Link href={c.href} className={cn("truncate hover:text-text-strong", c.mono && "font-data")}>
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className={cn("truncate text-text", c.mono && "font-data")}>
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
