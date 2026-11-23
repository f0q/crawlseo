import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { APP_VERSION } from "@/lib/version";
import { availableUpdate } from "@/lib/update-check";
import { loadShellExtras } from "@/lib/projects/shell";
import { getDisplayTimeZone } from "@/lib/timezone-server";
import { TimeZoneProvider } from "@/components/timezone-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const sites = await db.site.findMany({
    where: { userId: session.user?.id },
    select: { id: true, domain: true },
    orderBy: { domain: "asc" },
  });

  // Latest day of Search Console data per site, for the sidebar status block.
  const latest = sites.length
    ? await db.page.groupBy({
        by: ["siteId"],
        where: { siteId: { in: sites.map((s) => s.id) } },
        _max: { date: true },
      })
    : [];
  // Agency fork: the project switcher and whether DataForSEO is connected (lib/projects/shell.ts).
  const extras = await loadShellExtras(session.user);
  // Agency fork: the user's display time zone for date-times (lib/timezone.ts).
  const timeZone = await getDisplayTimeZone();
  const dataThrough = Object.fromEntries(
    latest.map((row) => [row.siteId, row._max.date?.toISOString().slice(0, 10) ?? null])
  );

  return (
    <TimeZoneProvider zone={timeZone}>
      <AppShell
        email={session.user?.email}
        name={session.user?.name}
        image={session.user?.image}
        version={APP_VERSION}
        update={availableUpdate()}
        sites={sites.map((s) => ({ ...s, dataThrough: dataThrough[s.id] ?? null }))}
        showCloudPromo={process.env.CRAWLSEO_HIDE_CLOUD_PROMO?.trim().toLowerCase() !== "true"}
        {...extras}
      >
        {children}
      </AppShell>
    </TimeZoneProvider>
  );
}
