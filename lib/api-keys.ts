import type { PrismaClient } from "@prisma/client";
import { cabinetKeyProviders, rankProviderIds } from "@/lib/rank-providers/registry";

/**
 * Providers with a key stored per user in ApiKey. dataforseo takes a login +
 * password pair; the others take one key, stored in `encryptedPassword` with
 * `encryptedLogin` left null.
 */
export const API_KEY_PROVIDERS = ["dataforseo", "google_pagespeed", "bing"] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/**
 * Agency fork: every provider with a stored key, the rank providers
 * (lib/rank-providers) and their cabinet logins (login + password, like
 * dataforseo) included.
 */
export function allKeyProviders(): string[] {
  return [...API_KEY_PROVIDERS, ...rankProviderIds(), ...cabinetKeyProviders()];
}

/** Providers stored as a login and a password; the rest as one key. */
export function isLoginPasswordProvider(provider: string): boolean {
  return provider === "dataforseo" || cabinetKeyProviders().includes(provider);
}

export type ApiKeyStatus = Record<string, { connected: boolean; updatedAt?: string }>;

/** Which providers the user has a key for: the body of GET /api/user/api-keys. */
export async function apiKeyStatus(
  db: Pick<PrismaClient, "apiKey">,
  userId: string
): Promise<ApiKeyStatus> {
  const keys = await db.apiKey.findMany({
    where: { userId },
    select: { provider: true, updatedAt: true },
  });
  const status: ApiKeyStatus = Object.fromEntries(
    allKeyProviders().map((provider) => [provider, { connected: false }])
  );
  for (const key of keys) {
    status[key.provider] = { connected: true, updatedAt: key.updatedAt.toISOString() };
  }
  return status;
}
