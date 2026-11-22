/*
 * One request helper for the Yandex APIs (agency fork): Webmaster, Metrika and
 * the login info. Every call carries `Authorization: OAuth <token>`, waits its
 * turn on a per-service pace, and retries 429, 420 (Metrika's quota answer),
 * 5xx and network errors with backoff, honouring Retry-After. Kept free of
 * database imports, and every network call goes through `opts.fetch`, so the
 * tests run without Yandex.
 */

export type YandexHttpOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Least time between two requests to one service, in this process. 0 in tests. */
  minGapMs?: number;
};

/** Yandex refused or did not answer. `status` 0: no answer (network error or timeout). */
export class YandexApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "YandexApiError";
  }

  /** A refused token or a missing object: a retry cannot help. */
  get permanent(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 404;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
/** Longest wait for a Retry-After or a backoff, so a wrong header cannot stall a job. */
const MAX_WAIT_MS = 65_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One schedule per service for the whole process: two syncs at once share the quota. */
const pacing = globalThis as unknown as { crawlseoYandexNextAt?: Record<string, number> };

async function paced(service: string, minGapMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  if (minGapMs <= 0) return;
  const table = (pacing.crawlseoYandexNextAt ??= {});
  const now = Date.now();
  const at = Math.max(now, table[service] ?? 0);
  table[service] = at + minGapMs;
  if (at > now) await sleep(at - now);
}

/** Retry-After in seconds, when present and sane. */
export function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const s = Number(raw);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : null;
}

/** The error code and message out of a Webmaster ({error_code, error_message}) or Metrika ({errors:[...], message}) body. */
export function parseYandexError(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.error_code === "string") {
    return { code: b.error_code, message: typeof b.error_message === "string" ? b.error_message : "" };
  }
  if (Array.isArray(b.errors) && b.errors.length) {
    const first = b.errors[0] as Record<string, unknown>;
    return {
      code: typeof first.error_type === "string" ? first.error_type : String(b.code ?? "error"),
      message: typeof first.message === "string" ? first.message : typeof b.message === "string" ? b.message : "",
    };
  }
  if (typeof b.error === "string") {
    return { code: b.error, message: typeof b.error_description === "string" ? b.error_description : "" };
  }
  return null;
}

export type YandexRequest = {
  /** Names the pace and the errors: "Webmaster", "Metrika", "Yandex ID". */
  service: string;
  token: string;
  url: string;
  defaultGapMs: number;
};

/** GET a JSON document. Throws YandexApiError; retries what a retry can fix. */
export async function yandexGetJson(req: YandexRequest, opts: YandexHttpOptions = {}): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const gap = opts.minGapMs ?? req.defaultGapMs;
  const path = new URL(req.url).pathname;
  let lastError: YandexApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await paced(req.service, gap, sleep);
    let response: Response;
    let text: string;
    try {
      response = await doFetch(req.url, {
        headers: { Authorization: `OAuth ${req.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (err) {
      lastError = new YandexApiError(0, "network", `${req.service} did not answer: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(MAX_WAIT_MS, 2_000 * 2 ** (attempt - 1)));
      continue;
    }

    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // a proxy error page: reported with its status below
    }
    if (response.ok) {
      if (body === null) throw new YandexApiError(response.status, "invalid_json", `${req.service} answered with something other than JSON`);
      return body;
    }

    const detail = parseYandexError(body);
    lastError = new YandexApiError(
      response.status,
      detail?.code ?? `http_${response.status}`,
      `${req.service} ${path} failed: ${response.status}${detail ? ` ${detail.code}${detail.message ? `: ${detail.message}` : ""}` : ` ${text.slice(0, 200)}`}`
    );
    // Webmaster's daily quota stays exhausted until exceeded_until: the next scheduled sync is the retry.
    const dailyQuota = detail?.code === "QUOTA_EXCEEDED" || detail?.code === "quota_requests_by_uid";
    const retryable = !dailyQuota && (response.status === 429 || response.status === 420 || response.status === 503 || response.status >= 500);
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    const wait = retryAfterMs(response.headers) ?? (response.status === 429 || response.status === 420 ? 5_000 * attempt : 2_000 * 2 ** (attempt - 1));
    await sleep(Math.min(MAX_WAIT_MS, wait));
  }
  throw lastError ?? new YandexApiError(0, "network", `${req.service} did not answer`);
}
