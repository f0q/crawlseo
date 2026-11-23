import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { atLeast } from "@/lib/projects/access";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { getProject, listFiles, listJournal, listNotes, listTasks } from "@/lib/projects/service";
import { listGroupSummaries } from "@/lib/projects/groups";
import { getBudget } from "@/lib/projects/budget";
import { getRankSettings } from "@/lib/projects/rank";
import { MONTH_PATTERN } from "@/lib/projects/rank-usage";
import { PageHeader } from "@/components/ui/page-header";
import { FilesSection } from "@/components/projects/files-section";
import { JournalSection } from "@/components/projects/journal-section";
import { DeleteProjectButton, MembersSection } from "@/components/projects/members-section";
import { NotesSection } from "@/components/projects/notes-section";
import { ProjectForm } from "@/components/projects/project-form";
import { SitesSection } from "@/components/projects/sites-section";
import { TasksSection } from "@/components/projects/tasks-section";
import { BudgetSection } from "@/components/projects/budget-section";
import { BillingSection } from "@/components/projects/billing-section";
import { RankSettingsSection } from "@/components/projects/rank-settings-section";
import { PaidCollectionSection } from "@/components/projects/paid-collection-section";
import { getPaidCollection } from "@/lib/projects/paid-collection";
import { StatusBadge } from "@/components/projects/ui";
import { YandexProjectCards, yandexProjectSites } from "@/components/yandex/project-cards";
import { OverviewSection } from "@/components/projects/overview-section";
import { projectOverview } from "@/lib/projects/overview";
import { sourcesMatrix } from "@/lib/projects/sources";
import { SourcesStrip } from "@/components/projects/source-cells";
import { projectTabHref, resolveProjectTab } from "@/lib/projects/tabs";
import { Breadcrumbs } from "@/components/projects/breadcrumbs";
import { getDisplayTimeZone } from "@/lib/timezone-server";

const iso = (d: Date) => d.toISOString();

/** What the passport form edits (the group aside): a new key resets the form to the saved values. */
const passportFormKey = (p: { name: string; status: string; testUrl: string | null; geo: string | null; language: string | null; searchEngines: string[]; cms: string | null; hosting: string | null; contacts: string | null; accessNotes: string | null }) =>
  JSON.stringify([p.name, p.status, p.testUrl, p.geo, p.language, p.searchEngines, p.cms, p.hosting, p.contacts, p.accessNotes]);

/**
 * Agency fork: one client project, in six sections (UX step 3; since the navigation step B they are
 * items of the sidebar, still `?tab=`): overview (the default), tasks, journal,
 * data (sources, sites, rank tracking), money (client payment and spending), about (passport, brief
 * and materials, members). Former tab keys (`?tab=sites`, `rank`, `budget`, `passport`, `brief`)
 * redirect to their new tab and section (lib/projects/tabs.ts).
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string | string[]; month?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const session = await auth();
  const actor = sessionActor(session?.user);
  if (!actor) redirect("/login");

  let detail: Awaited<ReturnType<typeof getProject>>;
  try {
    detail = await getProject(actor, slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { project, sites, members } = detail;
  const canEdit = atLeast(project.role, "editor");
  const resolved = resolveProjectTab(query.tab);
  const month = MONTH_PATTERN.test(String(query.month)) ? String(query.month) : undefined;
  if (resolved.legacy) redirect(projectTabHref(slug, resolved.tab, { section: resolved.section, query: { month } }));
  const { tab } = resolved;
  // Agency fork: date-times in the user's display zone (lib/timezone.ts).
  const timeZone = await getDisplayTimeZone();

  let body: React.ReactNode;
  if (tab === "overview") {
    body = <OverviewSection slug={slug} data={await projectOverview(actor, slug)} timeZone={timeZone} />;
  } else if (tab === "about") {
    const [{ notes }, { files }, groups] = await Promise.all([listNotes(actor, slug), listFiles(actor, slug), listGroupSummaries(actor)]);
    body = (
      <div className="flex flex-col gap-5">
        <div id="passport" className="panel scroll-mt-20 p-5">
          <h2 className="mb-4 text-[17px] leading-6 font-medium text-text-strong">{M.detail.passportTitle}</h2>
          {/* Keyed by the form's own fields: the group saves on its own and must not reset unsaved edits. */}
          <ProjectForm key={passportFormKey(project)} project={project} canEdit={canEdit} groups={groups} />
        </div>
        <div id="brief" className="flex scroll-mt-20 flex-col gap-5">
          <NotesSection slug={slug} notes={notes.map((n) => ({ ...n, updatedAt: iso(n.updatedAt) }))} canEdit={canEdit} />
          <FilesSection slug={slug} files={files.map((f) => ({ ...f, createdAt: iso(f.createdAt) }))} canEdit={canEdit} />
        </div>
        <div id="members" className="flex scroll-mt-20 flex-col gap-5">
          <MembersSection slug={slug} members={members} me={actor.userId} isOwner={project.role === "owner"} />
          {project.role === "owner" && <DeleteProjectButton slug={slug} />}
        </div>
      </div>
    );
  } else if (tab === "data") {
    const linkable = canEdit
      ? await db.site.findMany({ where: { userId: actor.userId, projectId: null }, select: { id: true, domain: true }, orderBy: { domain: "asc" } })
      : [];
    const [yandex, rank, matrix] = await Promise.all([
      yandexProjectSites(db, sites.filter((s) => s.yours)),
      getRankSettings(actor, slug),
      sourcesMatrix(actor, { slug }),
    ]);
    const sourcesRow = matrix.projects[0] ?? null;
    body = (
      <div className="flex flex-col gap-5">
        {sourcesRow && (
          <section id="sources" aria-labelledby="data-sources" className="panel scroll-mt-20 p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 id="data-sources" className="text-[15px] font-medium text-text-strong">
                {M.sources.dataTitle}
              </h2>
              <Link href={`/projects/sources#p-${slug}`} className="text-link text-[13px] font-medium">
                {M.sources.allSources}
              </Link>
            </div>
            <SourcesStrip row={sourcesRow} timeZone={timeZone} />
          </section>
        )}
        <div id="sites" className="flex scroll-mt-20 flex-col gap-5">
          <SitesSection slug={slug} sites={sites} linkable={linkable} canEdit={canEdit} />
          {/* Agency fork: Yandex cards of the viewer's own sites (lib/yandex). */}
          <YandexProjectCards reports={yandex} />
        </div>
        <div id="rank" className="scroll-mt-20">
          <RankSettingsSection
            key={rank.settings.updatedAt ? iso(rank.settings.updatedAt) : "new"}
            slug={slug}
            data={{ ...rank, settings: { ...rank.settings, updatedAt: rank.settings.updatedAt ? iso(rank.settings.updatedAt) : null } }}
            canEdit={canEdit}
          />
        </div>
      </div>
    );
  } else if (tab === "tasks") {
    const { tasks } = await listTasks(actor, slug);
    body = <TasksSection slug={slug} tasks={tasks} canEdit={canEdit} />;
  } else if (tab === "money") {
    const [data, paid] = await Promise.all([getBudget(actor, slug, month), getPaidCollection(actor, slug)]);
    // Agency fork UX step 2: the Money tab, the client's payment first, then the spending (the former Budget).
    body = (
      <div className="flex flex-col gap-5">
        <BillingSection
          key={`${project.paidUntil}-${project.contractEnd}-${project.billingNeverPause}`}
          slug={slug}
          paidUntil={project.paidUntil}
          contractEnd={project.contractEnd}
          neverPause={project.billingNeverPause}
          pausedAt={project.paidPausedAt ? iso(project.paidPausedAt) : null}
          canEdit={canEdit}
        />
        <PaidCollectionSection key={JSON.stringify(paid)} slug={slug} data={paid} canEdit={canEdit} />
        <BudgetSection key={`${data.month}-${data.currency}-${data.categories.join(",")}-${JSON.stringify(data.plan)}`} slug={slug} data={data} canEdit={canEdit} />
      </div>
    );
  } else {
    const { entries } = await listJournal(actor, slug, { limit: 500 });
    body = <JournalSection slug={slug} entries={entries} sites={sites} canEdit={canEdit} />;
  }

  return (
    <div>
      {/* Agency fork, navigation step B: the sections are in the sidebar (and the strip under the mobile header), not tabs. */}
      <Breadcrumbs
        label={M.nav.breadcrumbs}
        items={[
          { label: M.nav.projects, href: "/projects" },
          tab === "overview" ? { label: project.name } : { label: project.name, href: projectTabHref(slug, "overview") },
          ...(tab === "overview" ? [] : [{ label: M.tabs[tab] }]),
        ]}
      />
      <PageHeader title={project.name} meta={M.detail.meta(sites.length)} actions={<StatusBadge status={project.status} />} />
      {body}
    </div>
  );
}
