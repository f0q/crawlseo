import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectForm } from "@/components/projects/project-form";

/** Agency fork: a new client project, its passport and its domains. */
export default function NewProjectPage() {
  return (
    <div>
      <PageHeader title={M.form.createTitle} description={M.form.createDescription} />
      <div className="panel p-5">
        <ProjectForm />
      </div>
    </div>
  );
}
