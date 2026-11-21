import type { PrismaClient } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The project tools (agency fork) end to end against /api/v1 on PGlite: the
// write tools need a write-scoped key, and what they write reads back
// through get_project.

const holder = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", async () => {
  const { lazyDb } = await import("@/lib/testing/pglite");
  return { db: lazyDb(holder) };
});

import { handleApiV1 } from "@/lib/api-v1/router";
import { seedApiFixtures, snapshotUserData, type Fixtures } from "@/lib/testing/api-fixtures";
import { createTestDb, type TestDb } from "@/lib/testing/pglite";
import { createApiClient } from "./api-client";
import { createMcpServer } from "./tools";

let t: TestDb;
let db: PrismaClient;
let f: Fixtures;

beforeAll(async () => {
  t = await createTestDb();
  db = holder.db = t.db;
  f = await seedApiFixtures(db);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function connect(apiKey: string) {
  const api = createApiClient({ baseUrl: "http://crawlseo.test", apiKey, fetch: (req) => handleApiV1(req) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(api, "test").connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError ?? false };
}

describe("project MCP tools", () => {
  it("every write tool is refused with a read-only key, and nothing changes", async () => {
    const client = await connect(f.keyA);
    const before = await snapshotUserData(db);
    for (const [name, args] of [
      ["create_project", { name: "Nope" }],
      ["upsert_note", { slug: "quilltab", title: "x", body: "y" }],
      ["add_journal_entry", { slug: "quilltab", text: "x" }],
      ["upsert_task", { slug: "quilltab", title: "x" }],
      ["add_budget_entry", { slug: "quilltab", category: "work", amount: 10 }],
    ] as const) {
      const r = await call(client, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toMatch(/read-only/);
    }
    expect(await snapshotUserData(db)).toBe(before);
    await client.close();
  });

  it("writes with a write-scoped key and get_project reads it back", async () => {
    const client = await connect(f.keyAWrite);
    const created = await call(client, "create_project", { name: "Acme", domains: ["acme-books.com"], accessNotes: "SSH: ACME_SSH_KEY in agent-secrets/.env" });
    expect(created.text).toBe("Created project Acme (slug: acme) with 1 site(s): acme-books.com.");
    expect((await call(client, "create_project", { name: "Leak", accessNotes: "password=Hunter2Hunter2" })).text).toMatch(/look like they contain a secret/);

    expect((await call(client, "upsert_note", { slug: "acme", kind: "brief", title: "Brief", body: "Books for kids" })).text).toMatch(/^Created note \[brief\] Brief .*version 1/);
    expect((await call(client, "upsert_note", { slug: "acme", kind: "brief", title: "Brief", body: "Books for kids, Moscow" })).text).toMatch(/^Updated note .*version 2/);
    const stale = await call(client, "upsert_note", { slug: "acme", kind: "brief", title: "Brief", body: "x", baseVersion: 1 });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.text).toMatch(/now version 2/);

    const entry = { slug: "acme", text: "Set up the project", date: "2026-11-20", author: "seo-agent" };
    expect((await call(client, "add_journal_entry", entry)).text).toMatch(/^Added 2026-11-20 Set up the project/);
    expect((await call(client, "add_journal_entry", entry)).text).toMatch(/^Already there:/);
    expect((await call(client, "upsert_task", { slug: "acme", externalKey: "presale-1", title: "Express audit" })).text).toMatch(/^Created task \[todo\] Express audit/);
    expect((await call(client, "upsert_task", { slug: "acme", externalKey: "presale-1", title: "Express audit", status: "doing" })).text).toMatch(/^Updated task \[doing\]/);

    const read = await call(client, "get_project", { slug: "acme" });
    expect(read.isError, read.text).toBe(false);
    expect(read.text).toMatch(/Project Acme[\s\S]*ACME_SSH_KEY[\s\S]*acme-books\.com[\s\S]*\[brief\] Brief \(id \S+, version 2[\s\S]*Books for kids, Moscow[\s\S]*\[doing\] Express audit \(id \S+, key presale-1[\s\S]*2026-11-20 Set up the project \[seo-agent\]/);
    expect((await call(client, "list_projects", {})).text).toMatch(/2 project\(s\)[\s\S]*Acme/);
    expect((await call(client, "get_project", { slug: "secret-b" })).text).toBe("Project not found");
    await client.close();
  });

  it("add_budget_entry adds once per externalKey and get_project_budget reads it back", async () => {
    const client = await connect(f.keyAWrite);
    const entry = { slug: "quilltab", category: "links", amount: 1500, date: new Date().toISOString().slice(0, 10), note: "Two guest posts", externalKey: "inv-7" };
    expect((await call(client, "add_budget_entry", entry)).text).toMatch(/^Added \d{4}-\d{2}-\d{2} links 1500 \(id \S+\)\.$/);
    expect((await call(client, "add_budget_entry", { ...entry, amount: 1600 })).text).toMatch(/^Updated .* links 1600/);
    const bad = await call(client, "add_budget_entry", { ...entry, category: "travel", externalKey: undefined });
    expect(bad).toMatchObject({ isError: true });
    expect(bad.text).toMatch(/Unknown category "travel"/);
    const read = await call(client, "get_project_budget", { slug: "quilltab" });
    expect(read.text).toMatch(/actual 1600[\s\S]*links\s+\|\s+0 \|\s+1600[\s\S]*links 1600 RUB Two guest posts \[b?a@quilltab\.app \(key parser\)\] \(id \S+, key inv-7\)/);
    expect((await call(client, "get_project_budget", { slug: "secret-b" })).text).toBe("Project not found");
    await client.close();
  });
});
