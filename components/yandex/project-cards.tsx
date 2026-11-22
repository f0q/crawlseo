import Link from "next/link";
import type { PrismaClient } from "@prisma/client";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { metrikaReport, webmasterReport, type MetrikaReport, type WebmasterReport } from "@/lib/yandex/report";
import { YandexStatCard } from "./stat-card";

const T = YANDEX_UI;

type Db = Parameters<typeof metrikaReport>[0] & Pick<PrismaClient, "yandexSiteLink">;

export type YandexProjectSite = {
  site: { id: string; domain: string };
  metrika: Pick<MetrikaReport, "totals">;
  webmaster: Pick<WebmasterReport, "cards">;
};

/** The last 28 days against the 28 before, for the given sites that have Yandex linked. */
export async function yandexProjectSites(db: Db, sites: { id: string; domain: string }[]): Promise<YandexProjectSite[]> {
  if (sites.length === 0) return [];
  const linked = await db.yandexSiteLink.findMany({ where: { siteId: { in: sites.map((s) => s.id) } }, select: { siteId: true } });
  const ids = new Set(linked.map((l) => l.siteId));
  return Promise.all(
    sites
      .filter((s) => ids.has(s.id))
      .map(async (site) => ({
        site,
        metrika: await metrikaReport(db, site.id, { days: 28 }),
        webmaster: await webmasterReport(db, site.id, { days: 28, limit: 1 }),
      }))
  );
}

/**
 * Agency fork: the project's Sites tab shows Yandex cards for the sites the
 * viewer owns (other members see a site's domain, not its data).
 */
export function YandexProjectCards({ reports }: { reports: YandexProjectSite[] }) {
  return (
    <section className="panel p-5">
      <h3 className="text-[15px] leading-5 font-semibold text-text-strong">{T.project.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{T.project.description}</p>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{T.project.none}</p>
      ) : (
        <div className="mt-4 space-y-5">
          {reports.map(({ site, metrika, webmaster }) => (
            <div key={site.id}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="font-medium text-text-strong">{site.domain}</span>
                <Link href={`/sites/${site.id}/yandex`} className="text-link text-[13px] font-medium">
                  {T.project.open}
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <YandexStatCard compact label={T.cards.visits} {...metrika.totals.visits} />
                <YandexStatCard compact label={T.cards.yandexSearch} {...metrika.totals.yandexSearchVisits} />
                <YandexStatCard compact label={T.cards.sqi} {...webmaster.cards.sqi} />
                <YandexStatCard compact label={T.cards.searchable} {...webmaster.cards.searchablePages} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
