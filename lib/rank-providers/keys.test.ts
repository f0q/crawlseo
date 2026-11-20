import { beforeAll, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/encryption";

const db = vi.hoisted(() => ({ apiKey: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db }));

import { getRankProviderKey, UnknownRankProviderError } from "./keys";
import { RankKeyMissingError } from "./types";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest-only";
});

describe("getRankProviderKey", () => {
  it("reads the key from encryptedPassword, like the other single-key providers", async () => {
    db.apiKey.findUnique.mockResolvedValue({ encryptedLogin: null, encryptedPassword: encrypt("labrika-key") });
    expect(await getRankProviderKey("user-1", "labrika")).toBe("labrika-key");
    expect(db.apiKey.findUnique).toHaveBeenCalledWith({ where: { userId_provider: { userId: "user-1", provider: "labrika" } } });
  });

  it("says which key is missing, and refuses an unknown provider", async () => {
    db.apiKey.findUnique.mockResolvedValue(null);
    await expect(getRankProviderKey("user-1", "labrika")).rejects.toBeInstanceOf(RankKeyMissingError);
    await expect(getRankProviderKey("user-1", "nope")).rejects.toBeInstanceOf(UnknownRankProviderError);
  });
});
