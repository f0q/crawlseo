import type { RankEngineInfo, RankProject, RankProvider, RankProviderClient, RankRow } from "../types";
import { createLabrikaClient, LABRIKA_MAX_DATES_PER_REQUEST, testLabrikaKey, type LabrikaClientOptions } from "./client";
import { startLabrikaChecks } from "./cabinet";
import { LABRIKA_SOURCE, type LabrikaKeywordRow, type LabrikaSite } from "./parse";

/*
 * Labrika as a rank provider: the Labrika Public API, read only. Projects,
 * keywords and regions are set up in Labrika itself. Starting a check needs
 * the cabinet login (./cabinet.ts), as the Public API cannot start one.
 */

/** One row per keyword and check day Labrika returned; a day without an entry gets none. */
export function labrikaRows(rows: LabrikaKeywordRow[]): RankRow[] {
  return rows.flatMap((row) =>
    row.checks.map((check) => ({
      keyword: row.keyword,
      date: check.date,
      position: check.position,
      url: check.url,
      frequency: row.frequency,
      frequencyExact: row.frequencyExact,
    }))
  );
}

const engineInfo = (site: LabrikaSite): RankEngineInfo[] =>
  site.engines.map((e) => ({ externalEngineId: e.id, engine: e.engine, region: e.region, device: e.device }));

export function createLabrikaRankClient(apiKey: string, opts?: LabrikaClientOptions): RankProviderClient {
  const client = createLabrikaClient(apiKey, opts);
  // /serp/sites answers with the engines of each project: listEngines reuses that answer.
  let sites: Promise<LabrikaSite[]> | null = null;
  const loadSites = () => (sites ??= client.listSites().catch((err) => {
    sites = null;
    throw err;
  }));

  return {
    ping: () => client.ping(),
    async listProjects(): Promise<RankProject[]> {
      sites = null;
      return (await loadSites()).map((s) => ({ externalSiteId: s.siteUuid, host: s.host, title: s.title }));
    },
    async listEngines(project) {
      const site = (await loadSites()).find((s) => s.siteUuid === project.externalSiteId);
      return site ? engineInfo(site) : [];
    },
    listDates: (engine) => client.listDates(engine.externalSiteId, engine.externalEngineId),
    async fetchPositions(engine, dates) {
      const wanted = new Set(dates);
      const rows = await client.positions(engine.externalSiteId, engine.externalEngineId, dates);
      return labrikaRows(rows).filter((r) => wanted.has(r.date));
    },
  };
}

export const labrikaProvider: RankProvider = {
  id: LABRIKA_SOURCE,
  name: "Labrika",
  meta: {
    id: LABRIKA_SOURCE,
    name: "Labrika",
    description: "Keyword positions in Yandex and Google by region and device, from your Labrika rank tracking projects.",
    help: "In Labrika open your profile, Public API, and create a key with the serp:read scope. Positions need a Business or Agency subscription.",
    helpLink: { href: "https://labrika.ru/dashboard#/user/public-api", label: "Open Labrika Public API" },
  },
  hosts: ["labrika.ru"],
  maxDatesPerRequest: LABRIKA_MAX_DATES_PER_REQUEST,
  createClient: createLabrikaRankClient,
  testKey: testLabrikaKey,
  // Business: 5000 checks for 360 RUB per 30 days. 1 check = 1 keyword x 1 engine.
  billing: { planName: "Business", planPrice: 360, planChecks: 5000, currency: "RUB", monthlyLimit: 5000 },
  cabinet: {
    keyProvider: "labrika-cabinet",
    name: "Labrika cabinet login",
    description: "The email and password of your Labrika account. Only used to start position checks of projects that have rank checks turned on.",
    help: "The Public API cannot start a check; crawlseo signs in to the cabinet for that. Use an account that can start checks of your projects.",
    helpLink: { href: "https://labrika.ru/login", label: "Open Labrika" },
  },
  startCheck: startLabrikaChecks,
};
