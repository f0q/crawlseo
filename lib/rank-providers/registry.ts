import { labrikaProvider } from "./labrika/provider";
import type { RankProvider, RankProviderMeta } from "./types";

/*
 * Every rank provider of this deployment. Adding one is an adapter under
 * lib/rank-providers/<id>/ and one line here; see docs/agency/rank-providers.md.
 * No database imports: the Settings pages and the key routes read this list.
 */

const PROVIDERS: readonly RankProvider[] = [labrikaProvider];

export function listRankProviders(): readonly RankProvider[] {
  return PROVIDERS;
}

export function getRankProvider(id: string): RankProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function isRankProviderId(id: unknown): id is string {
  return typeof id === "string" && PROVIDERS.some((p) => p.id === id);
}

export function rankProviderIds(): string[] {
  return PROVIDERS.map((p) => p.id);
}

/** What Settings shows, as plain data for client components. */
export function rankProviderMetas(): RankProviderMeta[] {
  return PROVIDERS.map((p) => (p.cabinet && p.startCheck ? { ...p.meta, cabinet: p.cabinet } : p.meta));
}

/** ApiKey.provider ids of the cabinet logins (login and password) of providers that can start checks. */
export function cabinetKeyProviders(): string[] {
  return PROVIDERS.flatMap((p) => (p.cabinet && p.startCheck ? [p.cabinet.keyProvider] : []));
}

export function isCabinetKeyProvider(id: unknown): id is string {
  return typeof id === "string" && cabinetKeyProviders().includes(id);
}
