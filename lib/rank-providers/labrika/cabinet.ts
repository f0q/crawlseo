import type { RankCabinetLogin, RankCheckStartResult, RankCheckTarget, RankProviderClientOptions } from "../types";
import { LabrikaApiError } from "./client";

/*
 * The Labrika cabinet (labrika.ru/dashboard), for the one thing the Public
 * API cannot do: start a position check. It works with the session of a
 * signed-in user, so it needs the cabinet login and password (stored like
 * every per-user key, encrypted, as ApiKey "labrika-cabinet"):
 *
 *   GET  https://labrika.ru/login                 session cookie and the form token, if the page has one
 *   POST https://labrika.ru/login                 form: email, password (and _token)
 *   POST https://labrika.ru/api/v1/sites/<site_uuid>/reports/search_positions/start
 *        {"useAvailableLimits":false,"tagIds":[],"siteEngineId":0,"useBalance":false}
 *        siteEngineId 0 checks every engine of the project, else the one engine.
 *
 * Each start spends checks of the account: keywords x engines. Nothing here
 * runs unless a project has rank checks turned on (lib/projects/rank.ts).
 */

export const LABRIKA_ORIGIN = "https://labrika.ru";
const LOGIN_URL = `${LABRIKA_ORIGIN}/login`;
const startUrl = (siteUuid: string) =>
  `${LABRIKA_ORIGIN}/api/v1/sites/${encodeURIComponent(siteUuid)}/reports/search_positions/start`;

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "crawlseo";

/** The cookies of one cabinet session, by name. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Takes every Set-Cookie of a response. */
  take(headers: Headers): void {
    const list =
      typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? headers.getSetCookie()
        : (headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
    for (const raw of list) {
      const pair = raw.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /max-age=0\b/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  get size(): number {
    return this.cookies.size;
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/** The form token of a login page: a csrf-token meta tag or a hidden _token field. */
export function loginToken(html: string): string | null {
  const meta = /<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i.exec(html);
  if (meta) return meta[1];
  const input = /<input[^>]+name=["']_token["'][^>]*value=["']([^"']+)["']/i.exec(html)
    ?? /<input[^>]+value=["']([^"']+)["'][^>]*name=["']_token["']/i.exec(html);
  return input ? input[1] : null;
}

function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type LabrikaCabinet = {
  /** Starts a check of the project's engines; engineId "0" or undefined: every engine. */
  startPositions(siteUuid: string, engineId?: string): Promise<void>;
};

/**
 * Signs in to the cabinet and returns a session. Throws LabrikaApiError 401
 * when the login is refused. Never logs or returns the password.
 */
export async function openLabrikaCabinet(login: RankCabinetLogin, opts: RankProviderClientOptions = {}): Promise<LabrikaCabinet> {
  const doFetch = opts.fetch ?? fetch;
  const jar = new CookieJar();

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      const res = await doFetch(url, {
        ...init,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, ...(jar.size ? { Cookie: jar.header() } : {}), ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      jar.take(res.headers);
      return res;
    } catch (err) {
      throw new LabrikaApiError(0, "network", `Labrika did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const page = await send(LOGIN_URL, { method: "GET", headers: { Accept: "text/html" } });
  const token = loginToken(await page.text().catch(() => ""));

  const form = new URLSearchParams({ email: login.login, password: login.password });
  if (token) form.set("_token", token);
  const signedIn = await send(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html,application/json" },
    body: form.toString(),
  });
  await signedIn.text().catch(() => "");
  const location = signedIn.headers.get("location") ?? "";
  // A refused login comes back to the login page (or answers 401/419/422); a good one leaves it.
  const refused =
    signedIn.status === 401 ||
    signedIn.status === 419 ||
    signedIn.status === 422 ||
    signedIn.status >= 500 ||
    (signedIn.status >= 300 && signedIn.status < 400 && /\/login\b/.test(location)) ||
    (signedIn.status === 200 && !location && jar.size === 0);
  if (refused) {
    throw new LabrikaApiError(signedIn.status >= 500 ? signedIn.status : 401, "cabinet_login", "Labrika refused the cabinet login");
  }

  return {
    async startPositions(siteUuid, engineId) {
      const xsrf = jar.get("XSRF-TOKEN");
      const res = await send(startUrl(siteUuid), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(xsrf ? { "X-XSRF-TOKEN": decodeCookie(xsrf) } : {}),
        },
        body: JSON.stringify({
          useAvailableLimits: false,
          tagIds: [],
          siteEngineId: engineId ? Number(engineId) || 0 : 0,
          useBalance: false,
        }),
      });
      const text = await res.text().catch(() => "");
      if (res.status >= 200 && res.status < 300) return;
      let message = `Labrika answered ${res.status} to the check start`;
      try {
        const body = JSON.parse(text) as { message?: unknown; error?: unknown };
        const m = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : null;
        if (m) message = `${message}: ${m.slice(0, 200)}`;
      } catch {
        // not JSON: keep the status only
      }
      throw new LabrikaApiError(res.status, "start_refused", message);
    },
  };
}

/**
 * RankProvider.startCheck of Labrika: one sign-in, then one start per project
 * (every engine at once) or per engine when only some engines are wanted.
 */
export async function startLabrikaChecks(
  login: RankCabinetLogin,
  targets: RankCheckTarget[],
  opts: RankProviderClientOptions = {}
): Promise<RankCheckStartResult[]> {
  const cabinet = await openLabrikaCabinet(login, opts);
  const out: RankCheckStartResult[] = [];
  for (const target of targets) {
    const calls = target.allEnginesOfSite ? [undefined] : target.externalEngineIds;
    for (const engineId of calls) {
      const covered = engineId === undefined ? target.externalEngineIds : [engineId];
      try {
        await cabinet.startPositions(target.externalSiteId, engineId);
        for (const id of covered) out.push({ externalEngineId: id, started: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        for (const id of covered) out.push({ externalEngineId: id, started: false, error });
      }
    }
  }
  return out;
}
