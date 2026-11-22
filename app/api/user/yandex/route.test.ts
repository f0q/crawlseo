import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeYandex, json } from "@/lib/testing/yandex-fake";

// Settings > Connections > Yandex: the confirmation code is exchanged on the
// server and only the status goes back to the browser. Yandex is faked.

const { auth, db } = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    yandexConnection: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ db }));

const { GET, POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://localhost/api/user/yandex", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest-only";
  vi.stubEnv("YANDEX_CLIENT_ID", "cid");
  vi.stubEnv("YANDEX_CLIENT_SECRET", "csecret");
  auth.mockResolvedValue({ user: { id: "u1" } });
  db.yandexConnection.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/user/yandex", () => {
  it("needs a session", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await post({ code: "1234567" })).status).toBe(401);
  });

  it("GET gives the status and the authorize URL, never a token", async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({ configured: true, connected: false });
    expect(body.authorizeUrl).toBe("https://oauth.yandex.ru/authorize?response_type=code&client_id=cid&force_confirm=yes");
    vi.stubEnv("YANDEX_CLIENT_SECRET", "");
    expect(await (await GET()).json()).toMatchObject({ configured: false, authorizeUrl: null });
  });

  it("POST exchanges the code and stores encrypted tokens", async () => {
    const fake = fakeYandex({
      "POST oauth.yandex.ru/token": () => json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
      "GET login.yandex.ru/info": () => json({ login: "agency" }),
    });
    vi.stubGlobal("fetch", fake.fetch);
    db.yandexConnection.findUnique.mockResolvedValue({ login: "agency", expiresAt: new Date(), createdAt: new Date() });
    const res = await post({ code: " 123 4567 " });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ connected: true, login: "agency" });
    expect(JSON.stringify(body)).not.toContain("AT");
    expect(new URLSearchParams(fake.calls[0].body!).get("code")).toBe("1234567");
    const saved = db.yandexConnection.upsert.mock.calls[0][0].create;
    expect(saved.encryptedAccessToken).not.toBe("AT");
    expect(saved.login).toBe("agency");
  });

  it("POST says why Yandex refused the code", async () => {
    vi.stubGlobal("fetch", fakeYandex({ "POST oauth.yandex.ru/token": () => json({ error: "bad_verification_code", error_description: "Invalid" }, 400) }).fetch);
    const res = await post({ code: "1234567" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bad_verification_code/);
    expect((await post({ code: "" })).status).toBe(400);
    expect(db.yandexConnection.upsert).not.toHaveBeenCalled();
  });
});
