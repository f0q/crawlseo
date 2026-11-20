import { describe, expect, it } from "vitest";
import { matchKey, normalizeDevice, normalizeEngine, normalizeRegion, parseDay } from "./common";

describe("matchKey", () => {
  it("matches the same search engine, region and device across sources", () => {
    const labrika = matchKey({ engine: "Яндекс", region: "Москва (ПК)", device: "desktop" });
    expect(labrika).toBe("yandex|москва|desktop");
    expect(matchKey({ engine: "Yandex", region: "москва", device: "" })).toBe("yandex|москва|desktop");
    expect(matchKey({ engine: "яндекс", region: "Москва", device: "ПК" })).toBe(labrika);
  });

  it("keeps devices and engines apart", () => {
    expect(matchKey({ engine: "Яндекс", region: "Москва (mobile)", device: "" })).toBe("yandex|москва|mobile");
    expect(matchKey({ engine: "Google", region: "Москва", device: "смартфон" })).toBe("google|москва|mobile");
    expect(normalizeEngine("Bing")).toBe("bing");
    expect(normalizeEngine("Yandex.ru")).toBe("yandex");
    expect(normalizeEngine("Yahoo")).toBe("yahoo");
  });

  it("normalises device words and region notes", () => {
    expect(normalizeDevice("PC")).toBe("desktop");
    expect(normalizeDevice(" Mobile ")).toBe("mobile");
    expect(normalizeDevice(undefined)).toBe("");
    expect(normalizeRegion("Санкт-Петербург  (ПК)")).toBe("санкт-петербург");
  });
});

describe("parseDay", () => {
  it("takes a day or a midnight timestamp, nothing else", () => {
    expect(parseDay("2026-11-18")).toBe("2026-11-18");
    expect(parseDay("2026-11-18T00:00:00Z")).toBe("2026-11-18");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay(20261118)).toBeNull();
  });
});
