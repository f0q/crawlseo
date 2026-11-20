import { createHash, randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";

/*
 * Access keys for the API (/api/v1) and the MCP server. A key is read-only
 * unless it was created with the "write" scope (agency fork), which also
 * allows writing rank positions. A key is
 * "crawlseo_" plus 32 random bytes; only its SHA-256 hash is stored, so a key
 * is shown once, when it is created, and cannot be read back. High-entropy
 * keys need no slow hash: nobody can guess one, and the hash is what the
 * lookup uses.
 */

export const KEY_PREFIX = "crawlseo_";
/** How much of the key Settings shows to tell keys apart. */
const SHOWN_CHARS = KEY_PREFIX.length + 6;
/** lastUsedAt is written at most this often per key. */
const LAST_USED_EVERY_MS = 60_000;
export const MAX_KEY_NAME = 60;
export const MAX_KEYS_PER_USER = 20;

type Db = Pick<PrismaClient, "accessKey">;

/** "read": GET only. "write": also POST /api/v1/sites/{id}/positions (agency fork). */
export const KEY_SCOPES = ["read", "write"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export function isKeyScope(value: unknown): value is KeyScope {
  return typeof value === "string" && (KEY_SCOPES as readonly string[]).includes(value);
}

const scopeOf = (value: string): KeyScope => (value === "write" ? "write" : "read");

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type CreatedKey = { id: string; name: string; prefix: string; scope: KeyScope; createdAt: Date; key: string };

/** Creates a key for the user and returns it with the key itself, the only time it is available. */
export async function createAccessKey(db: Db, userId: string, name: string, scope: KeyScope = "read"): Promise<CreatedKey> {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  const row = await db.accessKey.create({
    data: { userId, name, keyHash: hashKey(key), prefix: key.slice(0, SHOWN_CHARS), scope },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });
  return { ...row, scope, key };
}

/** The key from an `Authorization: Bearer <key>` header, or null. */
export function bearerKey(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export type KeyOwner = { keyId: string; userId: string; mcpEnabled: boolean; lastUsedAt: Date | null; scope: KeyScope };

/** Who the key belongs to, or null for a key that does not exist (never did, or was revoked). */
export async function findKeyOwner(db: Db, key: string): Promise<KeyOwner | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const row = await db.accessKey.findUnique({
    where: { keyHash: hashKey(key) },
    select: { id: true, userId: true, lastUsedAt: true, scope: true, user: { select: { settings: { select: { mcpEnabled: true } } } } },
  });
  if (!row) return null;
  return {
    keyId: row.id,
    userId: row.userId,
    mcpEnabled: row.user.settings?.mcpEnabled ?? false,
    lastUsedAt: row.lastUsedAt,
    scope: scopeOf(row.scope),
  };
}

/** Records that an accepted request used the key, at most once a minute. */
export async function touchKey(db: Db, owner: KeyOwner, now = new Date()): Promise<void> {
  if (owner.lastUsedAt && now.getTime() - owner.lastUsedAt.getTime() < LAST_USED_EVERY_MS) return;
  // updateMany: a key revoked in the meantime is not an error.
  await db.accessKey.updateMany({ where: { id: owner.keyId }, data: { lastUsedAt: now } });
}

export type KeyView = { id: string; name: string; prefix: string; scope: KeyScope; createdAt: Date; lastUsedAt: Date | null };

/** The user's keys for Settings > MCP: never the key or its hash. */
export async function listAccessKeys(db: Db, userId: string): Promise<KeyView[]> {
  const rows = await db.accessKey.findMany({
    where: { userId },
    select: { id: true, name: true, prefix: true, scope: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ ...r, scope: scopeOf(r.scope) }));
}

/** Revokes one of the user's keys; false when the user has no such key. */
export async function revokeAccessKey(db: Db, userId: string, keyId: string): Promise<boolean> {
  const { count } = await db.accessKey.deleteMany({ where: { id: keyId, userId } });
  return count > 0;
}
