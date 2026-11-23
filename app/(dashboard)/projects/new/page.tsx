import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectForm } from "@/components/projects/project-form";
import { listGroupSummaries } from "@/lib/projects/groups";
import { sessionActor } from "@/lib/projects/dashboard";

/** Agency fork: a new client project, its passport and its domains. */
export default async function NewProjectPage() {
  const actor = sessionActor((await auth())?.user);
  if (!actor) redirect("/login");
  return (
    <div>
      <PageHeader title={M.form.createTitle} description={M.form.createDescription} />
      <div className="panel p-5">
        <ProjectForm groups={await listGroupSummaries(actor)} />
      </div>
    </div>
  );
}
