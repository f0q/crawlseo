import { describe, expect, it } from "vitest";
import { bareHost, parseLinkInput, suggestCounter, suggestHost } from "./links";

const host = (hostId: string, url: string, verified = true, mainMirrorHostId: string | null = null) => ({
  hostId,
  asciiUrl: url,
  unicodeUrl: url,
  verified,
  mainMirrorHostId,
});

describe("suggestions by domain", () => {
  it("normalises hosts", () => {
    expect(bareHost("https://WWW.Quilltab.app:443/path?x")).toBe("quilltab.app");
    expect(bareHost("quilltab.app")).toBe("quilltab.app");
  });

  it("prefers the verified https main mirror", () => {
    const hosts = [
      host("http:quilltab.app:80", "http://quilltab.app/", true, "https:quilltab.app:443"),
      host("https:www.quilltab.app:443", "https://www.quilltab.app/", false),
      host("https:quilltab.app:443", "https://quilltab.app/"),
      host("https:other.example:443", "https://other.example/"),
    ];
    expect(suggestHost(hosts, "quilltab.app")?.hostId).toBe("https:quilltab.app:443");
    expect(suggestHost(hosts, "nothing.example")).toBeNull();
  });

  it("matches a counter by its site", () => {
    const counters = [
      { id: "1", name: "Other", site: "other.example", status: "", permission: "" },
      { id: "2", name: "Quilltab", site: "www.quilltab.app", status: "", permission: "" },
    ];
    expect(suggestCounter(counters, "quilltab.app")?.id).toBe("2");
  });
});

describe("link body", () => {
  it("takes ids, null to clear and goal lists", () => {
    expect(parseLinkInput({ webmasterHostId: "https:a.example:443", metrikaCounterId: 1001, goalIds: [5, "6", 5] })).toEqual({
      webmasterHostId: "https:a.example:443",
      metrikaCounterId: "1001",
      goalIds: ["5", "6"],
    });
    expect(parseLinkInput({ webmasterHostId: null, metrikaCounterId: "" })).toEqual({ webmasterHostId: null, metrikaCounterId: null });
    expect(parseLinkInput({})).toEqual({});
  });

  it("refuses the rest", () => {
    expect(parseLinkInput(null)).toBeNull();
    expect(parseLinkInput({ goalIds: "5" })).toBeNull();
    expect(parseLinkInput({ goalIds: ["abc"] })).toBeNull();
    expect(parseLinkInput({ webmasterHostId: 5 })).toBeNull();
  });
});
