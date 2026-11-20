/*
 * Project.accessNotes says where the access to a client's systems lives (the
 * name of a variable, a vault entry, a file), never the secret itself. This
 * refuses text that looks like a secret: private keys, JWTs, tokens with a
 * well-known prefix, "password=..." with a real value, and long high-entropy
 * strings. Pure, so the form checks with the same rules as the server.
 *
 * It is a guard against pasting a secret by mistake, not a proof that none is
 * there.
 */

export type SecretFinding = { reason: string };

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bPuTTY-User-Key-File-\d/;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/;

/** Token formats with a well-known prefix: GitHub, OpenAI and Stripe style, Slack, AWS, GitLab, Google, Yandex OAuth, Telegram bots, our own keys. */
const PREFIXED: [RegExp, string][] = [
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an API secret key (sk-...)"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/, "a Stripe key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/, "a GitLab token"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/\by0_[A-Za-z0-9_-]{20,}/, "a Yandex OAuth token"],
  [/\bAQAAAA[A-Za-z0-9_-]{20,}/, "a Yandex OAuth token"],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, "a Telegram bot token"],
  [/\bcrawlseo_[A-Za-z0-9_-]{20,}/, "a crawlseo access key"],
];

/** "password: ...", "token=...", "пароль - ..." and the like, with the value after it. */
const ASSIGNMENT =
  /\b(pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?([^\s"',;]+)|(пароль|ключ|токен)\s*[:=-]\s*["']?([^\s"',;]+)/giu;

/** A value that names where a secret is instead of being it: an env variable, ${VAR}, a path, a vault reference. */
function isReference(value: string): boolean {
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value)) return true; // $VAR, ${VAR}
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) return true; // AGENT_FTP_PASS
  if (/^(~|\.{0,2}\/)/.test(value)) return true; // ~/.claude/agent-secrets/.env, ./x, /etc/x
  // agent-secrets/.env, vault/client-x: a path of plain names, no long random run in it.
  if ((value.includes("/") || /\.env$/.test(value)) && !/[A-Za-z0-9+]{16,}/.test(value)) return true;
  if (/^(vault|op|bw|keepass|1password):/i.test(value)) return true;
  // Plain words such as "in", "see", "stored", "ask": no digits, all lower case, short.
  return /^[a-zа-яё-]{1,12}$/u.test(value);
}

/** Bits per character over the string's own characters. */
export function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A run of 24+ token characters that mixes letter cases or letters and digits and reads as random. */
function looksRandom(token: string): boolean {
  if (token.length < 24) return false;
  if (/^[A-Z0-9_]+$/.test(token)) return false; // an env variable name
  const lower = /[a-z]/.test(token);
  const upper = /[A-Z]/.test(token);
  const digit = /\d/.test(token);
  if ([lower, upper, digit].filter(Boolean).length < 2) return false;
  // Words joined by - or _ (a file or host name) are not random.
  if (/^[A-Za-z]+(?:[-_][A-Za-z]+)+$/.test(token)) return false;
  return shannonEntropy(token) >= 3.6;
}

/** The first thing in the text that looks like a secret, or null. */
export function findSecret(text: string): SecretFinding | null {
  if (PRIVATE_KEY.test(text)) return { reason: "a private key" };
  if (JWT.test(text)) return { reason: "a JWT" };
  for (const [pattern, reason] of PREFIXED) if (pattern.test(text)) return { reason };

  for (const m of text.matchAll(ASSIGNMENT)) {
    const name = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    if (value && !isReference(value)) return { reason: `a value after "${name}"` };
  }

  // Long tokens. Paths are split at "/", so a long path of plain names is not one token.
  for (const token of text.split(/[^A-Za-z0-9+/=_-]+/)) {
    for (const part of token.split("/")) {
      if (looksRandom(part)) return { reason: "a long random-looking string" };
    }
  }
  return null;
}
