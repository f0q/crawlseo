import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-v1/params";
import { atLeast } from "@/lib/projects/access";
import { sessionActor } from "@/lib/projects/dashboard";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { getProject, listFiles, listJournal, listNotes, listTasks } from "@/lib/projects/service";
import { getBudget } from "@/lib/projects/budget";
import { getRankSettings } from "@/lib/projects/rank";
import { MONTH_PATTERN } from "@/lib/projects/rank-usage";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { FilesSection } from "@/components/projects/files-section";
import { JournalSection } from "@/components/projects/journal-section";
import { DeleteProjectButton, MembersSection } from "@/components/projects/members-section";
import { NotesSection } from "@/components/projects/notes-section";
import { ProjectForm } from "@/components/projects/project-form";
import { SitesSection } from "@/components/projects/sites-section";
import { TasksSection } from "@/components/projects/tasks-section";
import { BudgetSection } from "@/components/projects/budget-section";
import { RankSettingsSection } from "@/components/projects/rank-settings-section";
import { StatusBadge } from "@/components/projects/ui";
import { YandexProjectCards, yandexProjectSites } from "@/components/yandex/project-cards";
import { OverviewSection } from "@/components/projects/overview-section";
import { projectOverview } from "@/lib/projects/overview";

// Agency fork UX step 1: Overview first and by default, the daily tabs next, the set-and-forget ones last.
const TABS = ["overview", "tasks", "journal", "sites", "rank", "budget", "passport", "brief"] as const;
type Tab = (typeof TABS)[number];

const iso = (d: Date) => d.toISOString();

/** Agency fork: one client project, in tabs: overview (the default), tasks, journal, sites, rank tracking, budget, passport, brief and materials. */
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
  const tab: Tab = (TABS as readonly string[]).includes(String(query.tab)) ? (query.tab as Tab) : "overview";

  let body: React.ReactNode;
  if (tab === "overview") {
    body = <OverviewSection slug={slug} data={await projectOverview(actor, slug)} />;
  } else if (tab === "passport") {
    body = (
      <div className="flex flex-col gap-5">
        <div className="panel p-5">
          <ProjectForm key={iso(project.updatedAt)} project={project} canEdit={canEdit} />
        </div>
        <MembersSection slug={slug} members={members} me={actor.userId} isOwner={project.role === "owner"} />
        {project.role === "owner" && <DeleteProjectButton slug={slug} />}
      </div>
    );
  } else if (tab === "brief") {
    const [{ notes }, { files }] = await Promise.all([listNotes(actor, slug), listFiles(actor, slug)]);
    body = (
      <div className="flex flex-col gap-5">
        <NotesSection slug={slug} notes={notes.map((n) => ({ ...n, updatedAt: iso(n.updatedAt) }))} canEdit={canEdit} />
        <FilesSection slug={slug} files={files.map((f) => ({ ...f, createdAt: iso(f.createdAt) }))} canEdit={canEdit} />
      </div>
    );
  } else if (tab === "sites") {
    const linkable = canEdit
      ? await db.site.findMany({ where: { userId: actor.userId, projectId: null }, select: { id: true, domain: true }, orderBy: { domain: "asc" } })
      : [];
    const yandex = await yandexProjectSites(db, sites.filter((s) => s.yours));
    body = (
      <div className="flex flex-col gap-5">
        <SitesSection slug={slug} sites={sites} linkable={linkable} canEdit={canEdit} />
        {/* Agency fork: Yandex cards of the viewer's own sites (lib/yandex). */}
        <YandexProjectCards reports={yandex} />
      </div>
    );
  } else if (tab === "tasks") {
    const { tasks } = await listTasks(actor, slug);
    body = <TasksSection slug={slug} tasks={tasks} canEdit={canEdit} />;
  } else if (tab === "rank") {
    const data = await getRankSettings(actor, slug);
    body = (
      <RankSettingsSection
        key={data.settings.updatedAt ? iso(data.settings.updatedAt) : "new"}
        slug={slug}
        data={{ ...data, settings: { ...data.settings, updatedAt: data.settings.updatedAt ? iso(data.settings.updatedAt) : null } }}
        canEdit={canEdit}
      />
    );
  } else if (tab === "budget") {
    const month = MONTH_PATTERN.test(String(query.month)) ? String(query.month) : undefined;
    const data = await getBudget(actor, slug, month);
    body = <BudgetSection key={`${data.month}-${data.currency}-${data.categories.join(",")}-${JSON.stringify(data.plan)}`} slug={slug} data={data} canEdit={canEdit} />;
  } else {
    const { entries } = await listJournal(actor, slug, { limit: 500 });
    body = <JournalSection slug={slug} entries={entries} sites={sites} canEdit={canEdit} />;
  }

  return (
    <div>
      <Link href="/projects" className="mb-3 inline-block text-[13px] text-muted-foreground hover:text-text-strong">
        {M.detail.back}
      </Link>
      <PageHeader
        title={project.name}
        meta={M.detail.meta(
          (M.labels.status as Record<string, string>)[project.status] ?? project.status,
          M.labels.role[project.role],
          sites.length
        )}
        actions={<StatusBadge status={project.status} />}
      />
      <nav aria-label={project.name} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "overview" ? `/projects/${slug}` : `/projects/${slug}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[14px] whitespace-nowrap transition-colors",
              t === tab ? "border-brand-500 text-text-strong" : "border-transparent text-muted-foreground hover:text-text-strong"
            )}
          >
            {M.tabs[t]}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
