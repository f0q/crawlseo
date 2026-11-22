import { describe, expect, it } from "vitest";
import { fakeYandex, json } from "@/lib/testing/yandex-fake";
import {
  exchangeCode,
  fetchLogin,
  normalizeCode,
  parseTokenResponse,
  refreshTokens,
  revokeToken,
  yandexAuthorizeUrl,
  yandexCredentials,
  YandexOAuthError,
} from "./oauth";
import { YandexApiError } from "./http";

const creds = { clientId: "cid", clientSecret: "csecret" };
const now = new Date("2026-11-22T10:00:00Z");

describe("Yandex OAuth (confirmation code flow)", () => {
  it("reads the app credentials from the environment", () => {
    expect(yandexCredentials({})).toBeNull();
    expect(yandexCredentials({ YANDEX_CLIENT_ID: "a" })).toBeNull();
    expect(yandexCredentials({ YANDEX_CLIENT_ID: " a ", YANDEX_CLIENT_SECRET: "b" })).toEqual({ clientId: "a", clientSecret: "b" });
  });

  it("builds the authorize URL with force_confirm and no redirect_uri", () => {
    const url = new URL(yandexAuthorizeUrl("cid"));
    expect(url.origin + url.pathname).toBe("https://oauth.yandex.ru/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "cid", force_confirm: "yes" });
  });

  it("cleans a pasted code and refuses junk", () => {
    expect(normalizeCode(" 123 4567\n")).toBe("1234567");
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });

  it("exchanges the code with a form body and computes the expiry", async () => {
    const fake = fakeYandex({
      "POST oauth.yandex.ru/token": () => json({ token_type: "bearer", access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
    });
    const tokens = await exchangeCode("1234567", creds, { fetch: fake.fetch, now });
    expect(tokens).toEqual({ accessToken: "AT", refreshToken: "RT", expiresAt: new Date("2026-11-22T11:00:00Z"), scope: "" });
    expect(Object.fromEntries(new URLSearchParams(fake.calls[0].body!))).toEqual({
      grant_type: "authorization_code",
      code: "1234567",
      client_id: "cid",
      client_secret: "csecret",
    });
  });

  it("refreshes with the refresh token", async () => {
    const fake = fakeYandex({ "POST oauth.yandex.ru/token": () => json({ access_token: "AT2", expires_in: 100 }) });
    const tokens = await refreshTokens("RT", creds, { fetch: fake.fetch, now });
    expect(tokens.accessToken).toBe("AT2");
    expect(tokens.refreshToken).toBeNull();
    expect(new URLSearchParams(fake.calls[0].body!).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(fake.calls[0].body!).get("refresh_token")).toBe("RT");
  });

  it("a refused code is a YandexOAuthError, a 5xx a YandexApiError", async () => {
    const refused = fakeYandex({ "POST oauth.yandex.ru/token": () => json({ error: "bad_verification_code", error_description: "Invalid code" }, 400) });
    const err = await exchangeCode("1", creds, { fetch: refused.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(YandexOAuthError);
    expect(err.code).toBe("bad_verification_code");
    const down = fakeYandex({ "POST oauth.yandex.ru/token": () => new Response("oops", { status: 502 }) });
    expect(await exchangeCode("1", creds, { fetch: down.fetch }).catch((e) => e)).toBeInstanceOf(YandexApiError);
  });

  it("an answer without an access token is refused", () => {
    expect(() => parseTokenResponse({ token_type: "bearer" })).toThrow(YandexOAuthError);
  });

  it("reads the login with an OAuth header, and null without login:info", async () => {
    const ok = fakeYandex({ "GET login.yandex.ru/info": () => json({ login: "agency", id: "1" }) });
    expect(await fetchLogin("AT", { fetch: ok.fetch, minGapMs: 0 })).toBe("agency");
    expect(ok.calls[0].auth).toBe("OAuth AT");
    expect(ok.calls[0].url.searchParams.get("format")).toBe("json");
    const denied = fakeYandex({ "GET login.yandex.ru/info": () => json({ error: "forbidden" }, 403) });
    expect(await fetchLogin("AT", { fetch: denied.fetch, minGapMs: 0 })).toBeNull();
  });

  it("revokes best effort", async () => {
    const ok = fakeYandex({ "POST oauth.yandex.ru/revoke_token": () => json({ status: "ok" }) });
    expect(await revokeToken("AT", creds, { fetch: ok.fetch })).toBe(true);
    const down = fakeYandex({});
    expect(await revokeToken("AT", creds, { fetch: down.fetch })).toBe(false);
  });
});
