import { describe, expect, it } from "vitest";
import { accessNotesSchema } from "./schema";
import { findSecret } from "./secrets";

// accessNotes (agency fork) may say where access lives, never hold a secret.

describe("findSecret", () => {
  it.each([
    ["Hosting: Beget panel, login and password in BEGET_PASS (agent-secrets/.env)"],
    ["FTP password: AGENT_FTP_PASS in ~/.claude/agent-secrets/.env"],
    ["token: see YANDEX_DIRECT_TOKEN"],
    ["password: in the 1Password vault, item Client X"],
    ["SSH key in ~/.ssh/beget_ed25519, user modulpech"],
    ["api_key=${METRIKA_TOKEN}"],
    ["Пароль: в менеджере паролей, запись Клиент"],
    ["Admin https://test.example.com/bitrix/admin/ (login in BITRIX_ADMIN_LOGIN)"],
    ["Metrika counter 12345678, Webmaster host https:example.com:443"],
  ])("lets references through: %s", (text) => {
    expect(findSecret(text)).toBeNull();
  });

  it.each([
    ["password=hunter2Secret", /password/],
    ["FTP password: Qw3rty!2026", /password/],
    ["token: 9f8e7d6c5b4a", /token/],
    ["пароль: Zx81spectrum", /пароль/],
    ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----", /private key/],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", /JWT/],
    ["github: ghp_abcdefghijklmnopqrstuvwxyz0123456789", /GitHub/],
    ["github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz", /GitHub/],
    ["openai sk-proj-abcdefghijklmnop1234567890", /sk-/],
    ["slack xoxb-1234567890-abcdefghijkl", /Slack/],
    ["aws AKIAIOSFODNN7EXAMPLE", /AWS/],
    ["yandex y0_AgAAAAABcdEfGhIjKlMnOpQrStUvWxYz", /Yandex/],
    ["bot 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", /Telegram/],
    ["the key is Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg==", /random/],
    ["hash 3f1b0c9a7e5d4f2a8b6c0e1d3a5f7b9c", /random/],
  ])("refuses %s", (text, reason) => {
    expect(findSecret(text)?.reason).toMatch(reason);
  });

  it("the schema answers with a clear message", () => {
    const r = accessNotesSchema.safeParse("ssh password: S3cr3tPassw0rd");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/look like they contain a secret[\s\S]*never the secret itself/);
    expect(accessNotesSchema.safeParse("  ").data).toBeNull();
  });
});
