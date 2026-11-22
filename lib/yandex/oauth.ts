import { YandexApiError, yandexGetJson, type YandexHttpOptions } from "./http";

/*
 * Yandex OAuth for the agency fork. The app is registered as "API access",
 * whose redirect URI is fixed to https://oauth.yandex.ru/verification_code:
 * Yandex shows the user a confirmation code, the user pastes it here, and the
 * server exchanges it for tokens. Refresh uses the refresh token before the
 * access token expires. Credentials come from YANDEX_CLIENT_ID and
 * YANDEX_CLIENT_SECRET.
 */

export const YANDEX_OAUTH_BASE = "https://oauth.yandex.ru";
const LOGIN_INFO_URL = "https://login.yandex.ru/info?format=json";

type Env = Record<string, string | undefined>;

export type YandexClientCredentials = { clientId: string; clientSecret: string };

/** The app credentials, or null when the operator has not set them. */
export function yandexCredentials(env: Env = process.env): YandexClientCredentials | null {
  const clientId = env.YANDEX_CLIENT_ID?.trim();
  const clientSecret = env.YANDEX_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where "Connect" sends the user: Yandex asks to allow access, then shows the code. */
export function yandexAuthorizeUrl(clientId: string): string {
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, force_confirm: "yes" });
  return `${YANDEX_OAUTH_BASE}/authorize?${query}`;
}

export type YandexTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** null when Yandex did not say. */
  expiresAt: Date | null;
  scope: string;
};

/** The code was wrong, used or expired, or the refresh token was revoked: the user connects again. */
export class YandexOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "YandexOAuthError";
  }
}

/** A confirmation code as Yandex shows it: digits (7 today), with any spaces the user copied removed. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "");
  return /^[A-Za-z0-9_-]{4,64}$/.test(code) ? code : null;
}

export function parseTokenResponse(body: unknown, now: Date = new Date()): YandexTokens {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.access_token !== "string" || !b.access_token) {
    throw new YandexOAuthError("invalid_response", "Yandex OAuth answered without an access token");
  }
  const expiresIn = Number(b.expires_in);
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token ? b.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null,
    scope: typeof b.scope === "string" ? b.scope : "",
  };
}

async function tokenRequest(
  params: Record<string, string>,
  creds: YandexClientCredentials,
  opts: YandexHttpOptions & { now?: Date } = {}
): Promise<YandexTokens> {
  const doFetch = opts.fetch ?? fetch;
  const form = new URLSearchParams({ ...params, client_id: creds.clientId, client_secret: creds.clientSecret });
  let response: Response;
  let text: string;
  try {
    response = await doFetch(`${YANDEX_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    text = await response.text();
  } catch (err) {
    throw new YandexApiError(0, "network", `Yandex OAuth did not answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // reported below
  }
  if (response.ok) return parseTokenResponse(body, opts.now);
  const b = (body ?? {}) as { error?: unknown; error_description?: unknown };
  const code = typeof b.error === "string" ? b.error : `http_${response.status}`;
  const description = typeof b.error_description === "string" ? b.error_description : text.slice(0, 200);
  if (response.status >= 500) throw new YandexApiError(response.status, code, `Yandex OAuth failed: ${response.status} ${description}`);
  throw new YandexOAuthError(code, `Yandex refused: ${code}${description ? ` (${description})` : ""}`);
}

/** Exchanges the confirmation code the user pasted. */
export function exchangeCode(code: string, creds: YandexClientCredentials, opts?: YandexHttpOptions & { now?: Date }) {
  return tokenRequest({ grant_type: "authorization_code", code }, creds, opts);
}

/** A new access token from the refresh token. Yandex may return a new refresh token too. */
export function refreshTokens(refreshToken: string, creds: YandexClientCredentials, opts?: YandexHttpOptions & { now?: Date }) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, creds, opts);
}

/**
 * The Yandex login of the token, or null when the token has no login:info
 * scope (or the call fails): the connection then shows "connected" only.
 */
export async function fetchLogin(accessToken: string, opts: YandexHttpOptions = {}): Promise<string | null> {
  try {
    const body = (await yandexGetJson(
      { service: "Yandex ID", token: accessToken, url: LOGIN_INFO_URL, defaultGapMs: 0 },
      { ...opts, sleep: opts.sleep ?? (async () => {}) }
    )) as { login?: unknown };
    return typeof body.login === "string" && body.login ? body.login : null;
  } catch {
    return null;
  }
}

/** Revokes the token at Yandex on disconnect. Best effort: false when Yandex refused or did not answer. */
export async function revokeToken(accessToken: string, creds: YandexClientCredentials, opts: YandexHttpOptions = {}): Promise<boolean> {
  try {
    const response = await (opts.fetch ?? fetch)(`${YANDEX_OAUTH_BASE}/revoke_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: accessToken, client_id: creds.clientId, client_secret: creds.clientSecret }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
