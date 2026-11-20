import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { getRankProvider, listRankProviders } from "../registry";
import { labrikaProvider } from "./provider";

// The Labrika adapter on the RankProvider contract, with Labrika answers
// from the fixtures (real answers with example hosts).

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function answering(...bodies: string[]) {
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const body = bodies.shift();
    if (body === undefined) throw new Error("no more answers");
    return new Response(body);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, urls };
}

describe("labrika provider", () => {
  it("is registered with its outbound host", () => {
    expect(getRankProvider("labrika")).toBe(labrikaProvider);
    expect(listRankProviders().map((p) => p.id)).toContain("labrika");
    const allowed = Object.keys(JSON.parse(readFileSync(join(__dirname, "../../../outbound-hosts.json"), "utf8")).requests ?? {});
    for (const host of labrikaProvider.hosts) expect(allowed, host).toContain(host);
  });

  it("lists projects and their engines from one /serp/sites answer", async () => {
    const lastPage = JSON.stringify({ data: [], pagination: { has_more: false, next_offset: null } });
    const { fetch, urls } = answering(fixture("sites.json"), lastPage);
    const client = labrikaProvider.createClient("key", { fetch, minGapMs: 0 });
    const projects = await client.listProjects();
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0]).toEqual({ externalSiteId: expect.any(String), host: expect.any(String), title: expect.any(String) });
    const engines = await client.listEngines(projects[0]);
    expect(engines[0]).toEqual({ externalEngineId: expect.any(String), engine: expect.any(String), region: expect.any(String), device: expect.any(String) });
    // The engines come with the projects: no request of their own.
    expect(urls).toHaveLength(2);
  });

  it("flattens positions to one row per keyword and asked day", async () => {
    const { fetch } = answering(fixture("positions.json"));
    const client = labrikaProvider.createClient("key", { fetch, minGapMs: 0 });
    const rows = await client.fetchPositions({ externalSiteId: "uuid", externalEngineId: "41310" }, ["2026-11-18"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.date).toBe("2026-11-18");
      expect(row.keyword).not.toBe("");
      expect(row.position === null || Number.isInteger(row.position)).toBe(true);
    }
  });
});
