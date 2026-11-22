import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { groupProjects } from "@/lib/projects/navigation";
import {
  GSC_STALE_DAYS,
  SCHEDULE_GRACE_DAYS,
  SOURCE_IDS,
  sourcesMatrix,
  YANDEX_STALE_DAYS,
  type SourceProjectRow,
} from "@/lib/projects/sources";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SourceCellView } from "@/components/projects/source-cells";
import { RankToggle } from "@/components/projects/rank-toggle";
import { StatusBadge } from "@/components/projects/ui";

const T = M.sources;

/**
 * Agency fork, UX step 2: the data sources panel. Rows are projects (grouped
 * by group; a project with several sites gets a sub-row per site), columns
 * are sources. Only the paid rank checks are turned on and off here; every
 * other cell leads to where the source is set up.
 */
export default async function SourcesPage() {
  const session = await auth();
  const actor = sessionActor(session?.user);
  if (!actor) redirect("/login");
  const { projects, totals } = await sourcesMatrix(actor);

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title={T.title} description={T.description} />
        <EmptyState illustration="empty-sites" title={T.empty} description={M.list.emptyDescription} actionLabel={M.list.newProject} actionHref="/projects/new" />
      </div>
    );
  }

  const groups = groupProjects(projects);
  return (
    <div>
      <PageHeader title={T.title} description={T.description} meta={T.totalsLine(totals.ok, totals.stale, totals.errors, totals.paidActive)} />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-[13px]">
          <thead>
            <tr className="mono-label border-b border-border text-[11px] text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-normal">
                {T.project}
              </th>
              {SOURCE_IDS.map((id) => (
                <th key={id} scope="col" className="px-3 py-2 font-normal">
                  {T.names[id]}
                  {id === "positions" && <span className="ml-1 text-warning">· {T.paidMark}</span>}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.name ?? ""} className="border-b border-border">
              {(groups.length > 1 || g.name) && (
                <tr>
                  <th colSpan={SOURCE_IDS.length + 1} scope="colgroup" className="bg-bg-section px-4 py-1.5 text-[12px] font-medium text-text-strong">
                    {g.name ?? M.list.ungrouped}
                  </th>
                </tr>
              )}
              {g.projects.map((p) => (
                <ProjectRows key={p.id} row={p} />
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="align-top">
              <th scope="row" className="px-4 py-3 text-[13px] font-medium text-text-strong">
                {T.totals}
              </th>
              {SOURCE_IDS.map((id) => {
                const c = totals.bySource[id];
                const total = c.ok + c.waiting + c.stale + c.error + c["paused-billing"] + c["paused-status"];
                return (
                  <td key={id} className="px-3 py-3 font-data text-[12px] text-muted-foreground">
                    <span className="block">{T.columnTotal(c.ok, total)}</span>
                    {c.error > 0 && <span className="block text-danger">{T.columnErrors(c.error)}</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">{T.thresholds(GSC_STALE_DAYS, YANDEX_STALE_DAYS, SCHEDULE_GRACE_DAYS)}</p>
    </div>
  );
}

function ProjectRows({ row }: { row: SourceProjectRow }) {
  const several = row.sites.length > 1;
  return (
    <>
      <tr id={`p-${row.slug}`} className="scroll-mt-20 border-t border-border align-top">
        <th scope="row" className="px-4 py-3 font-normal">
          <Link href={`/projects/${row.slug}`} className="text-[14px] font-medium text-text-strong hover:underline">
            {row.name}
          </Link>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={row.status} />
            <span className="font-data text-[12px] text-muted-foreground">
              {row.sites.length === 0 ? T.noSite : several ? T.sitesCount(row.sites.length) : row.sites[0].domain}
            </span>
          </span>
          {billingLine(row) && <span className="mt-1 block max-w-[220px] text-[12px] leading-4 text-warning">{billingLine(row)}</span>}
        </th>
        {row.sites.length === 0 ? (
          <>
            <td className="px-3 py-3">
              <PositionsCell row={row} />
            </td>
            <td colSpan={SOURCE_IDS.length - 1} className="px-3 py-3 text-[13px] text-muted-foreground">
              {T.noSite} ·{" "}
              <Link href={`/projects/${row.slug}?tab=sites`} className="text-link">
                {T.addDomain}
              </Link>
            </td>
          </>
        ) : (
          SOURCE_IDS.map((id) => (
            <td key={id} className="px-3 py-3">
              {id === "positions" ? <PositionsCell row={row} /> : <SourceCellView source={id} cell={row.cells[id]} />}
            </td>
          ))
        )}
      </tr>
      {several &&
        row.sites.map((s) => (
          <tr key={s.siteId} className="align-top">
            <th scope="row" className="py-2 pr-4 pl-8 font-data text-[12px] font-normal text-muted-foreground">
              {s.domain}
            </th>
            {SOURCE_IDS.map((id) => (
              <td key={id} className="px-3 py-2">
                <SourceCellView source={id} cell={s.cells[id]} />
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}

/** The billing warning of a project line: overdue, contract ended, or paid collection paused. */
function billingLine(row: SourceProjectRow): string | null {
  const b = row.billing;
  const B = M.billing.banner;
  if (b.level === "paused") return B.paused;
  if (b.level !== "overdue") return null;
  if (b.overdueDays > 0) return B.overdue(b.overdueDays, b.pauseFrom ? formatDay(b.pauseFrom, { year: true }) : null);
  return b.contractEnd ? B.contractEnded(formatDay(b.contractEnd, { year: true })) : null;
}

/** The project's paid rank checks: the state and, for editors, the on/off switch. */
function PositionsCell({ row }: { row: SourceProjectRow }) {
  const freq = (M.rank.frequencies as Record<string, string>)[row.rank.frequency] ?? row.rank.frequency;
  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex items-start gap-2">
        {row.rank.canToggle && <RankToggle slug={row.slug} enabled={row.rank.enabled} name={row.name} />}
        <SourceCellView source="positions" cell={row.cells.positions} />
      </span>
      {row.rank.sourceName && row.rank.enabled && (
        <span className="text-[11px] text-muted-foreground">
          {row.rank.sourceName} · {freq}
        </span>
      )}
    </span>
  );
}
