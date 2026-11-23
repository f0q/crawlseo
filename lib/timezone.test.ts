import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDay } from "./format";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  normalizeTimeZone,
  setBrowserTimeZone,
  timeZoneOffsetLabel,
  timeZoneOptions,
  todayIn,
  zonedParts,
} from "./timezone";

// Agency fork: the display time zone. Instants move to the user's zone; calendar days never do.

const AT = new Date("2026-11-22T17:30:00Z");

describe("time zones", () => {
  it("accepts IANA names and falls back to the default", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Makassar");
    expect(isValidTimeZone("Europe/Moscow")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    for (const bad of ["", "Mars/Olympus", 3, null, "x".repeat(65)]) expect(isValidTimeZone(bad)).toBe(false);
    expect(normalizeTimeZone("Nope/Zone")).toBe("Asia/Makassar");
    expect(normalizeTimeZone(undefined)).toBe("Asia/Makassar");
    expect(normalizeTimeZone("Europe/Moscow")).toBe("Europe/Moscow");
  });

  it("lists the common zones first, then every other zone once", () => {
    const list = timeZoneOptions();
    expect(list.slice(0, 2)).toEqual(["UTC", "Asia/Makassar"]);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain("Pacific/Auckland");
  });

  it("gives the offset and calendar parts of an instant in a zone", () => {
    expect(timeZoneOffsetLabel("Asia/Makassar", AT)).toBe("GMT+8");
    expect(timeZoneOffsetLabel("UTC", AT)).toBe("UTC");
    expect(zonedParts(AT, "Asia/Makassar")).toEqual({ year: 2026, month: 10, day: 23, hour: 1, minute: 30 });
    expect(zonedParts(AT, "America/New_York")).toEqual({ year: 2026, month: 10, day: 22, hour: 12, minute: 30 });
    expect(todayIn("Asia/Makassar", AT)).toBe("2026-11-23");
    expect(todayIn("UTC", AT)).toBe("2026-11-22");
  });
});

describe("formatDay with a time zone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the upstream UTC output without a zone", () => {
    expect(formatDay(AT, { time: true })).toBe("22 Nov 17:30 UTC");
    expect(formatDay(AT, { year: true })).toBe("22 Nov 2026");
  });

  it("shows a date-time in the zone, without a suffix", () => {
    expect(formatDay(AT, { year: true, time: true, timeZone: "Asia/Makassar" })).toBe("23 Nov 2026 01:30");
    expect(formatDay(AT.toISOString(), { time: true, timeZone: "Europe/Moscow" })).toBe("22 Nov 20:30");
    expect(formatDay(AT, { time: true, timeZone: "UTC" })).toBe("22 Nov 17:30 UTC");
    // A zone that is not one: UTC, labelled as such.
    expect(formatDay(AT, { time: true, timeZone: "Nope/Zone" })).toBe("22 Nov 17:30 UTC");
  });

  it("never shifts a calendar day", () => {
    expect(formatDay("2026-11-22", { year: true, timeZone: "America/Los_Angeles" })).toBe("22 Nov 2026");
    expect(formatDay("2026-11-22", { time: true, timeZone: "Asia/Makassar" })).toBe("22 Nov 00:00 UTC");
    // A GSC day stored as UTC midnight is only moved when a zone is passed on purpose.
    expect(formatDay(new Date("2026-11-22T00:00:00Z"))).toBe("22 Nov");
  });

  it("moves the day of an instant when a zone is passed", () => {
    expect(formatDay(AT, { timeZone: "Asia/Makassar" })).toBe("23 Nov");
  });

  it("uses the browser's zone for date-times built without one, never on the server", () => {
    setBrowserTimeZone("Asia/Makassar"); // no window: ignored
    expect(formatDay(AT, { time: true })).toBe("22 Nov 17:30 UTC");
    vi.stubGlobal("window", {});
    setBrowserTimeZone("Asia/Makassar");
    expect(formatDay(AT, { time: true })).toBe("23 Nov 01:30");
    expect(formatDay(AT)).toBe("22 Nov");
    setBrowserTimeZone("UTC");
  });
});
