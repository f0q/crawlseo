/*
 * Pure helpers shared by every rank source (agency fork): labels, host and
 * day parsing, and the key that matches one engine across sources. No
 * database imports, so client components and tests use them directly.
 */

/** ExternalRankEngine.source of rows imported from a CSV file in the UI. */
export const IMPORT_SOURCE = "import";

/** A source name pushed through the write API: lower case letters, digits, "-" and "_". */
export const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** "Яндекс, Москва (ПК)": how an engine is named in the UI and the API. */
export function engineLabel(e: { engine: string; region: string; device?: string }): string {
  const name = [e.engine, e.region].filter(Boolean).join(", ");
  // A region title often names the device already: "(ПК)", "(mobile)".
  const device = e.device && !/\(.+\)\s*$/.test(e.region) ? ` (${e.device})` : "";
  return `${name}${device}` || "Search engine";
}

/** The bare host for matching: lower case, no scheme, no "www.", no trailing dot or path. */
export function bareHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The projects whose host is the site's domain, "www." or not. */
export function suggestProjects<T extends { host: string; title: string }>(domain: string, projects: T[]): T[] {
  const host = bareHost(domain);
  return projects.filter((p) => bareHost(p.host || p.title) === host);
}

const DAY = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.0+)?Z)?$/;

/** `2026-11-18T00:00:00Z` or a bare day to `2026-11-18`; null when it is not a real day. */
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DAY.exec(value.trim());
  if (!match) return null;
  const day = match[1];
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

/** "desktop", "mobile" or "" from the many words trackers and spreadsheets use. */
export function normalizeDevice(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "";
  if (/^(desktop|pc|пк|компьютер|десктоп|d)$/.test(v)) return "desktop";
  if (/^(mobile|phone|смартфон|мобильный|моб|телефон|m|touch)$/.test(v)) return "mobile";
  return v;
}

/** The search engine as one word for matching: "yandex", "google", or the name in lower case. */
export function normalizeEngine(value: string): string {
  const v = value.trim().toLowerCase();
  // No \b: it does not see Cyrillic letters as word characters.
  if (/^(яндекс|yandex|ya)(?=$|[\s,.(-])/.test(v)) return "yandex";
  if (/^(google|гугл)(?=$|[\s,.(-])/.test(v)) return "google";
  return v;
}

/** The region without a trailing device note: "Москва (ПК)" and "москва" match. */
export function normalizeRegion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\((пк|pc|desktop|mobile|моб\.?|мобильный|смартфон|touch)\)\s*$/, "")
    .replace(/\s+/g, " ");
}

/** The device a region title names in brackets, when it does. */
function deviceInRegion(region: string): string {
  const m = /\(([^)]+)\)\s*$/.exec(region);
  return m ? normalizeDevice(m[1]) : "";
}

/**
 * What makes two engines of different sources "the same": search engine,
 * region and device, normalised. A missing device counts as desktop.
 */
export function matchKey(e: { engine: string; region: string; device: string }): string {
  const device = normalizeDevice(e.device) || deviceInRegion(e.region) || "desktop";
  return `${normalizeEngine(e.engine)}|${normalizeRegion(e.region)}|${device}`;
}
