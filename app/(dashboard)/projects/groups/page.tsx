import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { atLeast } from "@/lib/projects/access";
import { sessionActor } from "@/lib/projects/dashboard";
import { listGroupSummaries } from "@/lib/projects/groups";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { groupProjects } from "@/lib/projects/navigation";
import { listProjects } from "@/lib/projects/service";
import { PageHeader } from "@/components/ui/page-header";
import { GroupTitle, NewGroupForm } from "@/components/projects/group-actions";
import { ProjectGroupPicker } from "@/components/projects/group-select";
import { StatusBadge } from "@/components/projects/ui";

const T = M.groups;

/**
 * Agency fork: the Groups page. The groups with Rename and Ungroup, New
 * group (a name and the projects to move into it), and every project the
 * user can edit with its group picker, saved at once (lib/projects/groups.ts).
 */
export default async function GroupsPage() {
  const actor = sessionActor((await auth())?.user);
  if (!actor) redirect("/login");
  const [groups, projects] = await Promise.all([listGroupSummaries(actor), listProjects(actor)]);
  const editable = projects.filter((p) => atLeast(p.role, "editor"));
  const options = groups.map((g) => ({ name: g.name, count: g.count }));

  return (
    <div>
      <Link href="/projects" className="mb-3 inline-block text-[13px] text-muted-foreground hover:text-text-strong">
        {M.detail.back}
      </Link>
      <PageHeader title={T.title} description={T.description} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="groups-list" className="panel p-5">
            <h2 id="groups-list" className="mb-3 text-[17px] leading-6 font-medium text-text-strong">
              {T.listTitle}
            </h2>
            {groups.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{T.listEmpty}</p>
            ) : (
              <ul className="divide-y divide-border">
                {groups.map((g) => (
                  <li key={g.name} className="py-2.5">
                    <GroupTitle name={g.name} count={g.count} editable={g.editable} variant="buttons" level={3} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {editable.length > 0 && (
            <section aria-labelledby="groups-new" className="panel p-5">
              <h2 id="groups-new" className="text-[17px] leading-6 font-medium text-text-strong">
                {T.newTitle}
              </h2>
              <p className="mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">{T.newDescription}</p>
              <NewGroupForm projects={editable.map((p) => ({ slug: p.slug, name: p.name, group: p.group }))} groups={groups.map((g) => g.name)} />
            </section>
          )}
        </div>
        <section aria-labelledby="groups-projects" className="panel p-5">
          <h2 id="groups-projects" className="text-[17px] leading-6 font-medium text-text-strong">
            {T.projectsTitle}
          </h2>
          <p className="mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">{T.projectsDescription}</p>
          {editable.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{T.projectsEmpty}</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groupProjects(editable).map((g) => (
                <div key={g.name ?? "\u0000"}>
                  <h3 className="mono-label mb-1 text-[11px] text-muted-foreground">
                    {g.name ?? T.ungrouped} <span className="font-data">{g.projects.length}</span>
                  </h3>
                  <ul className="divide-y divide-border">
                    {g.projects.map((p) => (
                      <li key={p.slug} className="grid grid-cols-1 gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)] sm:items-start sm:gap-4">
                        <div className="flex min-w-0 items-center gap-2 pt-2">
                          <Link
                            id={`group-of-${p.slug}`}
                            href={`/projects/${p.slug}`}
                            className="truncate text-[14px] font-medium text-text-strong decoration-brand-500 underline-offset-4 hover:underline"
                          >
                            {p.name}
                          </Link>
                          <StatusBadge status={p.status} />
                        </div>
                        <ProjectGroupPicker slug={p.slug} value={p.group} groups={options} canEdit labelledBy={`group-of-${p.slug}`} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
