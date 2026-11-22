import { Prisma, type PrismaClient } from "@prisma/client";
import { YANDEX_UI } from "./messages";
import type { MetrikaCounter, MetrikaGoal } from "./metrika";
import type { WebmasterHost } from "./webmaster";

/*
 * Which Webmaster host and Metrika counter (with goals) feed a site. Every id
 * is checked against what the user's Yandex account can see, read live from
 * Yandex by the route, so a site can only be linked to the account's own
 * hosts and counters.
 */

export class YandexLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YandexLinkError";
  }
}

/** A host name without scheme, port, path and www., lower case. */
export function bareHost(value: string): string {
  let v = value.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "");
  v = v.split(/[/?#]/)[0];
  v = v.replace(/:\d+$/, "");
  return v.replace(/^www\./, "");
}

/** The Webmaster host of the domain: verified first, then https, then the main mirror itself. */
export function suggestHost(hosts: WebmasterHost[], domain: string): WebmasterHost | null {
  const want = bareHost(domain);
  const matches = hosts.filter((h) => bareHost(h.asciiUrl || h.unicodeUrl) === want || bareHost(h.unicodeUrl) === want);
  const score = (h: WebmasterHost) =>
    (h.verified ? 4 : 0) + (h.asciiUrl.startsWith("https:") ? 2 : 0) + (h.mainMirrorHostId === null ? 1 : 0);
  return matches.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** The Metrika counter of the domain, if one counter's site matches it. */
export function suggestCounter(counters: MetrikaCounter[], domain: string): MetrikaCounter | null {
  const want = bareHost(domain);
  return counters.find((c) => c.site && bareHost(c.site) === want) ?? null;
}

export type LinkInput = {
  webmasterHostId?: string | null;
  metrikaCounterId?: string | null;
  goalIds?: string[];
};

/** The body of PUT /api/sites/{id}/yandex, or null when it is malformed. */
export function parseLinkInput(body: unknown): LinkInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: LinkInput = {};
  for (const key of ["webmasterHostId", "metrikaCounterId"] as const) {
    if (!(key in b) || b[key] === undefined) continue;
    const v = b[key];
    if (v === null || v === "") out[key] = null;
    else if (typeof v === "string" && v.length <= 300) out[key] = v;
    else if (typeof v === "number" && key === "metrikaCounterId") out[key] = String(v);
    else return null;
  }
  if ("goalIds" in b && b.goalIds !== undefined) {
    if (!Array.isArray(b.goalIds) || b.goalIds.length > 200) return null;
    const ids = b.goalIds.map((g) => (typeof g === "number" ? String(g) : g));
    if (!ids.every((g) => typeof g === "string" && /^\d{1,20}$/.test(g))) return null;
    out.goalIds = [...new Set(ids as string[])];
  }
  return out;
}

export type LinkView = {
  webmasterHostId: string | null;
  webmasterHostUrl: string | null;
  metrikaCounterId: string | null;
  metrikaCounterName: string | null;
  goals: { id: string; name: string }[];
  webmasterSyncedAt: string | null;
  metrikaSyncedAt: string | null;
  webmasterError: string | null;
  metrikaError: string | null;
};

type LinkRow = Prisma.YandexSiteLinkGetPayload<object>;

export function linkView(row: LinkRow | null): LinkView {
  const names = (row?.metrikaGoalNames ?? {}) as Record<string, string>;
  return {
    webmasterHostId: row?.webmasterHostId ?? null,
    webmasterHostUrl: row?.webmasterHostUrl ?? null,
    metrikaCounterId: row?.metrikaCounterId ?? null,
    metrikaCounterName: row?.metrikaCounterName ?? null,
    goals: (row?.metrikaGoalIds ?? []).map((id) => ({ id, name: names[id] ?? id })),
    webmasterSyncedAt: row?.webmasterSyncedAt?.toISOString() ?? null,
    metrikaSyncedAt: row?.metrikaSyncedAt?.toISOString() ?? null,
    webmasterError: row?.webmasterError ?? null,
    metrikaError: row?.metrikaError ?? null,
  };
}

export async function siteLink(db: Pick<PrismaClient, "yandexSiteLink">, siteId: string): Promise<LinkView> {
  return linkView(await db.yandexSiteLink.findUnique({ where: { siteId } }));
}

type Db = Pick<
  PrismaClient,
  "yandexSiteLink" | "yandexWebmasterDaily" | "yandexQueryWeekly" | "yandexMetrikaDaily" | "yandexGoalDaily" | "$transaction"
>;

/**
 * Applies a link change. `available` holds what the account can see: hosts
 * when the host changes, counters when the counter changes, the goals of the
 * new (or current) counter when goals change. A new host or counter starts
 * with no data: the old one's rows are deleted in the same transaction.
 * Returns which services need a sync.
 */
export async function setSiteLink(
  db: Db,
  siteId: string,
  input: LinkInput,
  available: { hosts?: WebmasterHost[]; counters?: MetrikaCounter[]; goals?: MetrikaGoal[] }
): Promise<{ link: LinkView; syncWebmaster: boolean; syncMetrika: boolean }> {
  const current = await db.yandexSiteLink.findUnique({ where: { siteId } });
  const data: Prisma.YandexSiteLinkUncheckedUpdateInput = {};
  let hostChanged = false;
  let counterChanged = false;
  let goalsAdded = false;

  if (input.webmasterHostId !== undefined && input.webmasterHostId !== (current?.webmasterHostId ?? null)) {
    hostChanged = true;
    if (input.webmasterHostId === null) {
      Object.assign(data, { webmasterHostId: null, webmasterHostUrl: null });
    } else {
      const host = available.hosts?.find((h) => h.hostId === input.webmasterHostId);
      if (!host) throw new YandexLinkError(YANDEX_UI.errors.unknownHost);
      Object.assign(data, { webmasterHostId: host.hostId, webmasterHostUrl: host.unicodeUrl || host.asciiUrl });
    }
    Object.assign(data, { webmasterProblems: Prisma.DbNull, webmasterSitemaps: Prisma.DbNull, webmasterSyncedAt: null, webmasterError: null });
  }

  const counterId = input.metrikaCounterId !== undefined ? input.metrikaCounterId : (current?.metrikaCounterId ?? null);
  if (input.metrikaCounterId !== undefined && input.metrikaCounterId !== (current?.metrikaCounterId ?? null)) {
    counterChanged = true;
    if (input.metrikaCounterId === null) {
      Object.assign(data, { metrikaCounterId: null, metrikaCounterName: null });
    } else {
      const counter = available.counters?.find((c) => c.id === input.metrikaCounterId);
      if (!counter) throw new YandexLinkError(YANDEX_UI.errors.unknownCounter);
      Object.assign(data, { metrikaCounterId: counter.id, metrikaCounterName: counter.name || counter.site || counter.id });
    }
    Object.assign(data, { metrikaSyncedAt: null, metrikaError: null });
  }

  // A new counter keeps no goals of the old one unless they are sent again.
  let goalIds = counterChanged ? [] : (current?.metrikaGoalIds ?? []);
  if (input.goalIds !== undefined) goalIds = counterId ? input.goalIds : [];
  if (counterChanged || input.goalIds !== undefined) {
    const names: Record<string, string> = {};
    if (goalIds.length) {
      for (const id of goalIds) {
        const goal = available.goals?.find((g) => g.id === id);
        if (!goal) throw new YandexLinkError(YANDEX_UI.errors.unknownGoal);
        names[id] = goal.name;
      }
    }
    const before = new Set(current?.metrikaGoalIds ?? []);
    goalsAdded = goalIds.some((id) => counterChanged || !before.has(id));
    Object.assign(data, { metrikaGoalIds: goalIds, metrikaGoalNames: names });
  }

  const removedGoals = counterChanged ? null : (current?.metrikaGoalIds ?? []).filter((id) => !goalIds.includes(id));
  const hostAfter = hostChanged ? (data.webmasterHostId as string | null) : (current?.webmasterHostId ?? null);
  const empty = !hostAfter && !counterId;

  await db.$transaction(async (tx) => {
    if (hostChanged) {
      await tx.yandexWebmasterDaily.deleteMany({ where: { siteId } });
      await tx.yandexQueryWeekly.deleteMany({ where: { siteId } });
    }
    if (counterChanged) {
      await tx.yandexMetrikaDaily.deleteMany({ where: { siteId } });
      await tx.yandexGoalDaily.deleteMany({ where: { siteId } });
    } else if (removedGoals?.length) {
      await tx.yandexGoalDaily.deleteMany({ where: { siteId, goalId: { in: removedGoals } } });
    }
    if (empty) {
      // Nothing linked any more: the row goes too.
      if (current) await tx.yandexSiteLink.delete({ where: { siteId } });
    } else {
      await tx.yandexSiteLink.upsert({
        where: { siteId },
        create: { ...(data as Prisma.YandexSiteLinkUncheckedCreateInput), siteId },
        update: data,
      });
    }
  });

  const link = await siteLink(db, siteId);
  return {
    link,
    syncWebmaster: hostChanged && link.webmasterHostId !== null,
    syncMetrika: (counterChanged || goalsAdded) && link.metrikaCounterId !== null,
  };
}
