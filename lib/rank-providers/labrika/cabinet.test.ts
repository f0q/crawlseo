import { describe, expect, it } from "vitest";
import { CookieJar, loginToken, openLabrikaCabinet, startLabrikaChecks } from "./cabinet";
import { labrikaProvider } from "./provider";

// The Labrika cabinet session with a fake fetch: no request leaves the test.

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeLabrika(opts: { loginStatus?: number; loginLocation?: string; start?: (url: string, body: string) => Response } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url, method: init.method ?? "GET", headers, body });
    if (url === "https://labrika.ru/login" && (init.method ?? "GET") === "GET") {
      const h = new Headers({ "content-type": "text/html" });
      h.append("set-cookie", "XSRF-TOKEN=abc%3D; path=/");
      h.append("set-cookie", "labrika_session=s1; path=/; httponly");
      return new Response('<html><head><meta name="csrf-token" content="tok123"></head></html>', { status: 200, headers: h });
    }
    if (url === "https://labrika.ru/login") {
      const h = new Headers({ location: opts.loginLocation ?? "https://labrika.ru/dashboard" });
      h.append("set-cookie", "labrika_session=s2; path=/; httponly");
      return new Response("", { status: opts.loginStatus ?? 302, headers: h });
    }
    if (url.includes("/reports/search_positions/start")) {
      return opts.start ? opts.start(url, body) : Response.json({ ok: true });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const LOGIN = { login: "me@example.com", password: "hunter2" };

describe("labrika cabinet", () => {
  it("reads the form token from a meta tag or a hidden field", () => {
    expect(loginToken('<meta name="csrf-token" content="a1">')).toBe("a1");
    expect(loginToken('<input type="hidden" name="_token" value="b2">')).toBe("b2");
    expect(loginToken("<form></form>")).toBeNull();
  });

  it("keeps the newest value of each cookie", () => {
    const jar = new CookieJar();
    const h = new Headers();
    h.append("set-cookie", "a=1; path=/");
    h.append("set-cookie", "b=2; path=/");
    jar.take(h);
    const h2 = new Headers();
    h2.append("set-cookie", "a=3; path=/");
    jar.take(h2);
    expect(jar.header()).toBe("a=3; b=2");
  });

  it("signs in with the form and starts every engine of a project with siteEngineId 0", async () => {
    const { fetch, calls } = fakeLabrika();
    const cabinet = await openLabrikaCabinet(LOGIN, { fetch });
    await cabinet.startPositions("uuid-1");
    const login = calls[1];
    expect(login.method).toBe("POST");
    expect(new URLSearchParams(login.body).get("email")).toBe("me@example.com");
    expect(new URLSearchParams(login.body).get("_token")).toBe("tok123");
    const start = calls[2];
    expect(start.url).toBe("https://labrika.ru/api/v1/sites/uuid-1/reports/search_positions/start");
    expect(JSON.parse(start.body)).toEqual({ useAvailableLimits: false, tagIds: [], siteEngineId: 0, useBalance: false });
    expect(start.headers.Cookie).toContain("labrika_session=s2");
    expect(start.headers["X-XSRF-TOKEN"]).toBe("abc=");
  });

  it("refuses a login that goes back to the login page, and starts nothing", async () => {
    const { fetch, calls } = fakeLabrika({ loginLocation: "https://labrika.ru/login" });
    await expect(startLabrikaChecks(LOGIN, [{ externalSiteId: "u", externalEngineIds: ["1"], allEnginesOfSite: true }], { fetch })).rejects.toMatchObject({
      status: 401,
      message: "Labrika refused the cabinet login",
    });
    expect(calls.some((c) => c.url.includes("/start"))).toBe(false);
  });

  it("starts one engine at a time when only some are wanted, and reports each", async () => {
    const { fetch, calls } = fakeLabrika({
      start: (_url, body) => (JSON.parse(body).siteEngineId === 2 ? Response.json({ message: "No limits left" }, { status: 402 }) : Response.json({})),
    });
    const r = await startLabrikaChecks(
      LOGIN,
      [
        { externalSiteId: "u1", externalEngineIds: ["1", "2"], allEnginesOfSite: false },
        { externalSiteId: "u2", externalEngineIds: ["7", "8"], allEnginesOfSite: true },
      ],
      { fetch }
    );
    expect(r).toEqual([
      { externalEngineId: "1", started: true },
      { externalEngineId: "2", started: false, error: "Labrika answered 402 to the check start: No limits left" },
      { externalEngineId: "7", started: true },
      { externalEngineId: "8", started: true },
    ]);
    expect(calls.filter((c) => c.url.includes("/start")).map((c) => JSON.parse(c.body).siteEngineId)).toEqual([1, 2, 0]);
    // The password goes only to the login form.
    expect(calls.filter((c) => JSON.stringify(c).includes("hunter2")).map((c) => c.url)).toEqual(["https://labrika.ru/login"]);
  });

  it("is the provider's startCheck, with a cabinet key and the Business plan", () => {
    expect(labrikaProvider.startCheck).toBe(startLabrikaChecks);
    expect(labrikaProvider.cabinet?.keyProvider).toBe("labrika-cabinet");
    expect(labrikaProvider.billing).toMatchObject({ planPrice: 360, planChecks: 5000, monthlyLimit: 5000, currency: "RUB" });
  });
});
