/*
 * The contract every rank tracking provider implements (agency fork). A
 * provider is a service that checks keyword positions on its own schedule
 * (Labrika now; Topvisor, SerpRiver or an XMLRiver-based parser later). It is
 * one adapter under lib/rank-providers/<id>/ registered in ./registry.ts; the
 * key storage, linking, sync, history, UI, /api/v1 and MCP are shared.
 *
 * Kept free of database and Node imports: the settings pages read the
 * provider metadata, and the tests build fake providers from these types.
 */

/** One search engine of a provider project: a search engine, a region and a device. */
export interface RankEngineInfo {
  /** The provider's id of this engine inside the project. */
  externalEngineId: string;
  /** The search engine as the provider names it, e.g. "Яндекс", "Google". */
  engine: string;
  /** e.g. "Москва", "Москва (ПК)". */
  region: string;
  /** "desktop" | "mobile" or the provider's own word; "" when unknown. */
  device: string;
}

/** One rank tracking project of the provider account (usually one site). */
export interface RankProject {
  externalSiteId: string;
  host: string;
  title: string;
}

/** A project with its engines, as the site settings list them. */
export interface RankProjectWithEngines extends RankProject {
  engines: RankEngineInfo[];
}

/** One linked engine as a provider call needs it. */
export interface RankEngineRef {
  externalSiteId: string;
  externalEngineId: string;
}

/** One keyword on one check day. position null: checked, not within the depth the provider checks. */
export interface RankRow {
  keyword: string;
  /** YYYY-MM-DD */
  date: string;
  position: number | null;
  url: string | null;
  frequency?: number | null;
  frequencyExact?: number | null;
}

/** A provider client, bound to one account key. */
export interface RankProviderClient {
  /** The cheapest call that needs a valid key: throws when the key is refused. */
  ping(): Promise<void>;
  listProjects(): Promise<RankProject[]>;
  listEngines(project: RankProject): Promise<RankEngineInfo[]>;
  /** Every check day the provider has for the engine, YYYY-MM-DD, any order. */
  listDates(engine: RankEngineRef): Promise<string[]>;
  /** The rows of the given days (at most `maxDatesPerRequest` of them). A day without a check has no rows. */
  fetchPositions(engine: RankEngineRef, dates: string[]): Promise<RankRow[]>;
}

/** What Settings shows for a provider: plain data, safe to pass to client components. */
export interface RankProviderMeta {
  id: string;
  name: string;
  description: string;
  /** Under the key field: where the key comes from. */
  help: string;
  helpLink: { href: string; label: string };
}

export interface RankProviderClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Spacing between requests of this process; tests set 0. */
  minGapMs?: number;
}

export interface RankProvider {
  /** ExternalRankEngine.source and ApiKey.provider: lower case, stable. */
  id: string;
  /** Display name. */
  name: string;
  meta: RankProviderMeta;
  /** Hosts the adapter calls; each must be in outbound-hosts.json. */
  hosts: string[];
  /** Days per fetchPositions call. */
  maxDatesPerRequest: number;
  createClient(apiKey: string, opts?: RankProviderClientOptions): RankProviderClient;
  /** Whether the key works. Never throws. */
  testKey(apiKey: string, opts?: RankProviderClientOptions): Promise<boolean>;
}

/**
 * A provider refused or did not answer. `status` 0: no answer. Adapters throw
 * a subclass; `permanent` says no retry can help (key, subscription, project gone).
 */
export class RankProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RankProviderError";
  }

  get permanent(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 404;
  }
}

export class RankKeyMissingError extends Error {
  constructor(readonly providerName: string) {
    super(`No ${providerName} API key configured. Add one in Settings > Rank tracking.`);
    this.name = "RankKeyMissingError";
  }
}
