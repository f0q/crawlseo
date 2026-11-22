import { db } from "@/lib/db";
import { ApiError, intParam } from "@/lib/api-v1/params";
import type { Site } from "@/lib/api-v1/handlers";
import { YANDEX_UI } from "./messages";
import { metrikaReport, webmasterReport } from "./report";

/*
 * Yandex under /api/v1 (agency fork), read only:
 *
 * GET /api/v1/sites/{siteId}/yandex/webmaster   ?days= (1-365, default 28) &limit= (queries, 1-500, default 50)
 * GET /api/v1/sites/{siteId}/yandex/metrika     ?days= (1-365, default 28)
 *
 * Both compare the last `days` stored days with the `days` before them.
 */

export async function yandexWebmaster(site: Site, params: URLSearchParams) {
  const days = intParam(params, "days", 28, 1, 365);
  const limit = intParam(params, "limit", 50, 1, 500);
  const report = await webmasterReport(db, site.id, { days, limit });
  if (!report.link.webmasterHostId) throw new ApiError(404, YANDEX_UI.errors.noWebmaster);
  const { link, ...rest } = report;
  return {
    site,
    host: { id: link.webmasterHostId, url: link.webmasterHostUrl, syncedAt: link.webmasterSyncedAt, lastError: link.webmasterError },
    ...rest,
  };
}

export async function yandexMetrika(site: Site, params: URLSearchParams) {
  const days = intParam(params, "days", 28, 1, 365);
  const report = await metrikaReport(db, site.id, { days });
  if (!report.link.metrikaCounterId) throw new ApiError(404, YANDEX_UI.errors.noMetrika);
  const { link, ...rest } = report;
  return {
    site,
    counter: { id: link.metrikaCounterId, name: link.metrikaCounterName, goals: link.goals, syncedAt: link.metrikaSyncedAt, lastError: link.metrikaError },
    ...rest,
  };
}
