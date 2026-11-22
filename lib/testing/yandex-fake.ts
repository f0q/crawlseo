/*
 * A fake of the Yandex APIs for the tests (agency fork): a fetch that answers
 * by method, host and path, records every call and never touches the network.
 */

export type FakeCall = { method: string; url: URL; body: string | null; auth: string | null };
export type FakeHandler = (call: FakeCall) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Routes are "METHOD host/path" with ":param" segments, e.g. "GET api.webmaster.yandex.net/v4/user". */
export function fakeYandex(routes: Record<string, FakeHandler>) {
  const calls: FakeCall[] = [];
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ");
    const re = new RegExp(`^${pattern.replace(/[.]/g, "\\.").replace(/:[a-z]+/gi, "[^/]+")}$`);
    return { method, re, handler };
  });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const call: FakeCall = { method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? init.body : null, auth: headers.get("authorization") };
    calls.push(call);
    const target = `${url.host}${url.pathname}`;
    const route = compiled.find((r) => r.method === call.method && r.re.test(target));
    if (!route) return json({ error_code: "NOT_FOUND", error_message: `no fake for ${call.method} ${target}` }, 404);
    return route.handler(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls, paths: () => calls.map((c) => `${c.method} ${c.url.host}${c.url.pathname}`) };
}
