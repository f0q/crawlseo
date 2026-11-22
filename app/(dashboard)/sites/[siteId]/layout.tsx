import { SiteProjectCrumb } from "@/components/projects/site-project-crumb";

/** Agency fork: every site page shows the project its site belongs to (components/projects/site-project-crumb.tsx). */
export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return (
    <>
      <SiteProjectCrumb siteId={siteId} />
      {children}
    </>
  );
}
