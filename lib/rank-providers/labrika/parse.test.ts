import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  labrikaCollectedAt,
  LabrikaResponseError,
  parseDatesPage,
  parseLabrikaDay,
  parseLabrikaError,
  parsePositionsPage,
  parseSitesPage,
} from "./parse";
import { bareHost, engineLabel, suggestProjects } from "../common";

// Fixtures follow real Labrika answers (serp sites, dates and positions,
// 2026-11-18), with the hosts replaced by example ones.
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

describe("parseSitesPage", () => {
  it("reads projects with their engines and the next offset", () => {
    const { items, nextOffset } = parseSitesPage(fixture("sites.json"));
    expect(nextOffset).toBe(2);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      siteUuid: "350a586273314ceb8dafb2ee93c32b4f",
      host: "books.example.com",
      title: "books.example.com",
      engines: [
        { id: "41310", engine: "Яндекс", region: "Москва (ПК)", device: "desktop" },
        { id: "41311", engine: "Яндекс", region: "Москва (mobile)", device: "mobile" },
      ],
    });
  });

  it("stops paging when has_more is false, whatever next_offset says", () => {
    expect(parseSitesPage({ data: [], pagination: { has_more: false, next_offset: 100 } }).nextOffset).toBeNull();
  });

  it("refuses an answer without a data list", () => {
    expect(() => parseSitesPage({ error: { code: "x" } })).toThrow(LabrikaResponseError);
  });
});

describe("parseDatesPage", () => {
  it("turns check dates into days and drops what is not one", () => {
    expect(parseDatesPage(fixture("dates.json"))).toEqual({ items: ["2026-11-18", "2026-11-11"], nextOffset: null });
  });
});

describe("parsePositionsPage", () => {
  it("keeps a null position (not in the checked top) apart from a missing check", () => {
    const { items } = parsePositionsPage(fixture("positions.json"));
    expect(items[0]).toEqual({
      keyword: "книги на иностранных языках",
      frequency: 369,
      frequencyExact: 8,
      checks: [
        { date: "2026-11-11", position: 14, url: "https://books.example.com/catalog/" },
        { date: "2026-11-18", position: null, url: null },
      ],
    });
    // A keyword checked only on the latest day has one check, not a null one for the other.
    expect(items[1].checks).toEqual([{ date: "2026-11-18", position: 3, url: "https://books.example.com/" }]);
    expect(items[1].frequencyExact).toBe(0);
  });

  it("reads a position that is not a whole number from 1 as not ranked", () => {
    const { items } = parsePositionsPage({
      data: [{ keyword: "k", positions: { "2026-11-18T00:00:00Z": { position: 0, url: "javascript:x" } } }],
      pagination: {},
    });
    expect(items[0].checks).toEqual([{ date: "2026-11-18", position: null, url: null }]);
    expect(items[0].frequency).toBeNull();
  });
});

describe("dates", () => {
  it("accepts only real calendar days", () => {
    expect(parseLabrikaDay("2026-11-18T00:00:00Z")).toBe("2026-11-18");
    expect(parseLabrikaDay("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseLabrikaDay("2026-11-18T10:00:00Z")).toBeNull();
  });

  it("writes collected_at in the one format the API accepts", () => {
    expect(labrikaCollectedAt("2026-11-18")).toBe("2026-11-18T00:00:00Z");
    expect(() => labrikaCollectedAt("18.11.2026")).toThrow();
  });
});

describe("errors and labels", () => {
  it("reads the documented error body", () => {
    expect(parseLabrikaError(fixture("error-subscription.json"))).toEqual({
      code: "serp_subscription_required",
      message: "An active Business or Agency subscription is required",
    });
    expect(parseLabrikaError("<html>")).toBeNull();
  });

  it("names the device only when the region title does not", () => {
    expect(engineLabel({ engine: "Яндекс", region: "Москва (ПК)", device: "desktop" })).toBe("Яндекс, Москва (ПК)");
    expect(engineLabel({ engine: "Google", region: "Berlin", device: "mobile" })).toBe("Google, Berlin (mobile)");
  });
});

describe("suggestProjects", () => {
  it("matches the site's domain with or without www", () => {
    const { items } = parseSitesPage(fixture("sites.json"));
    expect(suggestProjects("school.example.com", items).map((s) => s.siteUuid)).toEqual([
      "7a64132a55b149ecbcdb8949faa0e469",
    ]);
    expect(suggestProjects("www.books.example.com", items)).toHaveLength(1);
    expect(suggestProjects("other.example.com", items)).toEqual([]);
    expect(bareHost("https://WWW.Example.com:443/path")).toBe("example.com");
  });
});
