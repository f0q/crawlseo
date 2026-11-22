import type { PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/encryption";
import type { YandexHttpOptions } from "./http";
import { YANDEX_UI } from "./messages";
import {
  exchangeCode,
  fetchLogin,
  refreshTokens,
  revokeToken,
  yandexCredentials,
  YandexOAuthError,
  type YandexTokens,
} from "./oauth";

/*
 * One Yandex OAuth token per user (YandexConnection), encrypted like every
 * stored key (lib/encryption.ts), used for Webmaster and Metrika of all the
 * user's sites. The access token is refreshed before it expires.
 */

type Db = Pick<PrismaClient, "yandexConnection" | "yandexSiteLink" | "yandexWebmasterDaily" | "yandexQueryWeekly" | "yandexMetrikaDaily" | "yandexGoalDaily" | "$transaction">;

/** Refresh when the token expires within this window. */
export const REFRESH_AHEAD_MS = 24 * 60 * 60 * 1000;

/** No token, or Yandex no longer accepts it: the user connects again in Settings. */
export class YandexNotConnectedError extends Error {
  constructor(message: string = YANDEX_UI.errors.notConnected) {
    super(message);
    this.name = "YandexNotConnectedError";
  }
}

/** The operator has not set YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET. */
export class YandexNotConfiguredError extends Error {
  constructor() {
    super(YANDEX_UI.errors.notConfigured);
    this.name = "YandexNotConfiguredError";
  }
}

export type YandexStatus = {
  configured: boolean;
  connected: boolean;
  login: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
};

export async function yandexStatus(db: Pick<PrismaClient, "yandexConnection">, userId: string): Promise<YandexStatus> {
  const row = await db.yandexConnection.findUnique({
    where: { userId },
    select: { login: true, expiresAt: true, createdAt: true },
  });
  return {
    configured: yandexCredentials() !== null,
    connected: row !== null,
    login: row?.login ?? null,
    expiresAt: row?.expiresAt?.toISOString() ?? null,
    connectedAt: row?.createdAt.toISOString() ?? null,
  };
}

function credentialsOrThrow() {
  const creds = yandexCredentials();
  if (!creds) throw new YandexNotConfiguredError();
  return creds;
}

async function store(db: Pick<PrismaClient, "yandexConnection">, userId: string, tokens: YandexTokens, extra: { login?: string | null; keepRefresh?: string | null } = {}) {
  const refresh = tokens.refreshToken ?? extra.keepRefresh ?? null;
  const data = {
    encryptedAccessToken: encrypt(tokens.accessToken),
    encryptedRefreshToken: refresh ? encrypt(refresh) : null,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    ...(extra.login !== undefined && { login: extra.login }),
  };
  await db.yandexConnection.upsert({
    where: { userId },
    create: { userId, ...data, login: extra.login ?? null },
    update: data,
  });
}

/**
 * Exchanges the pasted confirmation code and stores the tokens. A new
 * connection replaces the old one; the Webmaster user id is read again.
 */
export async function connectWithCode(
  db: Pick<PrismaClient, "yandexConnection">,
  userId: string,
  code: string,
  opts: YandexHttpOptions & { now?: Date } = {}
): Promise<YandexStatus> {
  const creds = credentialsOrThrow();
  const tokens = await exchangeCode(code, creds, opts);
  const login = await fetchLogin(tokens.accessToken, opts);
  await store(db, userId, tokens, { login });
  await db.yandexConnection.update({ where: { userId }, data: { webmasterUserId: null } });
  return yandexStatus(db, userId);
}

/**
 * A valid access token of the user, refreshed first when it expires within
 * REFRESH_AHEAD_MS. A refresh Yandex refuses means the user must connect again.
 */
export async function accessTokenFor(
  db: Pick<PrismaClient, "yandexConnection">,
  userId: string,
  opts: YandexHttpOptions & { now?: Date } = {}
): Promise<string> {
  const row = await db.yandexConnection.findUnique({ where: { userId } });
  if (!row) throw new YandexNotConnectedError();
  const now = opts.now ?? new Date();
  const access = decrypt(row.encryptedAccessToken);
  if (!row.expiresAt || row.expiresAt.getTime() - now.getTime() > REFRESH_AHEAD_MS) return access;

  const refresh = row.encryptedRefreshToken ? decrypt(row.encryptedRefreshToken) : null;
  if (!refresh) {
    if (row.expiresAt.getTime() > now.getTime()) return access;
    throw new YandexNotConnectedError(YANDEX_UI.errors.expired);
  }
  try {
    const tokens = await refreshTokens(refresh, credentialsOrThrow(), opts);
    await store(db, userId, tokens, { keepRefresh: refresh });
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof YandexOAuthError) throw new YandexNotConnectedError(YANDEX_UI.errors.expired);
    // Yandex did not answer: the old token still works until it expires.
    if (row.expiresAt.getTime() > now.getTime()) return access;
    throw err;
  }
}

/** The Webmaster user id, read once per connection and kept. */
export async function cachedWebmasterUserId(
  db: Pick<PrismaClient, "yandexConnection">,
  userId: string,
  read: () => Promise<string>
): Promise<string> {
  const row = await db.yandexConnection.findUnique({ where: { userId }, select: { webmasterUserId: true } });
  if (row?.webmasterUserId) return row.webmasterUserId;
  const id = await read();
  await db.yandexConnection.updateMany({ where: { userId }, data: { webmasterUserId: id } });
  return id;
}

/**
 * Removes the connection: the token (revoked at Yandex, best effort), every
 * site link of the user and the Yandex data synced for those sites. Another
 * Yandex account may not see the same hosts and counters.
 */
export async function disconnectYandex(db: Db, userId: string, opts: YandexHttpOptions = {}): Promise<void> {
  const row = await db.yandexConnection.findUnique({ where: { userId } });
  const creds = yandexCredentials();
  if (row && creds) {
    try {
      await revokeToken(decrypt(row.encryptedAccessToken), creds, opts);
    } catch {
      // an unreadable token: nothing to revoke
    }
  }
  const mine = { site: { userId } };
  await db.$transaction([
    db.yandexSiteLink.deleteMany({ where: mine }),
    db.yandexWebmasterDaily.deleteMany({ where: mine }),
    db.yandexQueryWeekly.deleteMany({ where: mine }),
    db.yandexMetrikaDaily.deleteMany({ where: mine }),
    db.yandexGoalDaily.deleteMany({ where: mine }),
    db.yandexConnection.deleteMany({ where: { userId } }),
  ]);
}
