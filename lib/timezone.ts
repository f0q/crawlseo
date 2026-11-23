/*
 * The display time zone (agency fork). Times are stored in UTC; each user
 * picks the zone date-times are shown in (Settings > Time zone). Pure, so the
 * browser and the server both import it; reading the setting is in
 * ./timezone-server.ts, the React context in components/timezone-provider.tsx.
 *
 * Only date-times move to the zone. Calendar days (GSC and Metrika days,
 * journal dates, due dates, "YYYY-MM-DD" strings) are never shifted.
 */

/** The default for existing and new users (the owner's choice). */
export const DEFAULT_TIME_ZONE = "Asia/Makassar";

/** Zones offered first in the picker; every IANA zone the runtime knows is listed after them. */
export const COMMON_TIME_ZONES = [
  "UTC",
  "Asia/Makassar",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Vladivostok",
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Istanbul",
  "Europe/Minsk",
  "Europe/Kyiv",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Australia/Sydney",
] as const;

const valid = new Map<string, boolean>();

/** An IANA zone name the runtime accepts ("UTC" included). */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  const known = valid.get(zone);
  if (known !== undefined) return known;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  valid.set(zone, ok);
  return ok;
}

/** The zone to show times in: the stored one when valid, else the default. */
export function normalizeTimeZone(zone: unknown): string {
  return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

/** Every zone for the picker: the common ones first, then the rest in alphabetical order. */
export function timeZoneOptions(current?: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const head: string[] = [...COMMON_TIME_ZONES].filter((z) => z === "UTC" || isValidTimeZone(z));
  if (current && isValidTimeZone(current) && !head.includes(current)) head.push(current);
  const seen = new Set(head);
  return [...head, ...all.filter((z) => !seen.has(z)).sort()];
}

/** "GMT+8", "GMT+5:30", "UTC": the zone's offset at the given moment. */
export function timeZoneOffsetLabel(zone: string, at: Date = new Date()): string {
  if (!isValidTimeZone(zone)) return zone;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return part === "GMT" || part === "GMT+0" ? "UTC" : (part ?? zone);
  } catch {
    return zone;
  }
}

/*
 * The zone used when a caller passes none. Only the browser sets it (the
 * provider, from the signed-in user's setting), so text built after an
 * interaction (a job's "next attempt at ...") is in the user's zone. The
 * server never sets it: a server render passes the zone explicitly, and the
 * server default stays UTC, so two requests never share a zone.
 */
let browserZone: string | null = null;

export function setBrowserTimeZone(zone: string): void {
  if (typeof window === "undefined") return;
  browserZone = normalizeTimeZone(zone);
}

/** The zone for a date-time when none is passed: the browser's setting, else UTC. */
export function fallbackTimeZone(): string {
  return typeof window !== "undefined" && browserZone ? browserZone : "UTC";
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar parts of an instant in a zone (month 0-11). */
export function zonedParts(d: Date, zone: string): ZonedParts {
  if (zone === "UTC" || !isValidTimeZone(zone)) {
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  const parts = f.formatToParts(d);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { year: num("year"), month: num("month") - 1, day: num("day"), hour: num("hour") % 24, minute: num("minute") };
}

/** Today's calendar day ("YYYY-MM-DD") in a zone, e.g. the default date of a new journal entry. */
export function todayIn(zone: string, now: Date = new Date()): string {
  const p = zonedParts(now, zone);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
