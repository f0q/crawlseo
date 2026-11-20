import { db } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getRankProvider } from "./registry";
import { RankKeyMissingError, type RankProjectWithEngines, type RankProviderClient } from "./types";

/*
 * A rank provider key is issued per provider account, which is the grain of
 * the ApiKey table (provider = the provider id). Like every single-key
 * provider it is stored in `encryptedPassword` with `encryptedLogin` null.
 */

export class UnknownRankProviderError extends Error {
  constructor(id: string) {
    super(`Unknown rank provider: ${id}`);
    this.name = "UnknownRankProviderError";
  }
}

export async function getRankProviderKey(userId: string, providerId: string): Promise<string> {
  const provider = getRankProvider(providerId);
  if (!provider) throw new UnknownRankProviderError(providerId);
  const apiKey = await db.apiKey.findUnique({ where: { userId_provider: { userId, provider: providerId } } });
  if (!apiKey) throw new RankKeyMissingError(provider.name);
  return decrypt(apiKey.encryptedPassword);
}

/** A client of the provider with the user's stored key. */
export async function rankClientFor(userId: string, providerId: string): Promise<RankProviderClient> {
  const provider = getRankProvider(providerId);
  if (!provider) throw new UnknownRankProviderError(providerId);
  return provider.createClient(await getRankProviderKey(userId, providerId));
}

/** Every project of the user's provider account with its engines, read live from the provider. */
export async function listProjectsWithEngines(userId: string, providerId: string): Promise<RankProjectWithEngines[]> {
  const client = await rankClientFor(userId, providerId);
  const projects = await client.listProjects();
  const out: RankProjectWithEngines[] = [];
  for (const project of projects) out.push({ ...project, engines: await client.listEngines(project) });
  return out;
}
