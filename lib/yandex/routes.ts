import type { PrismaClient } from "@prisma/client";
import { accessTokenFor, cachedWebmasterUserId, YandexNotConfiguredError, YandexNotConnectedError } from "./connection";
import { YandexApiError } from "./http";
import { YandexLinkError } from "./links";
import { createMetrikaClient } from "./metrika";
import { createWebmasterClient } from "./webmaster";

/*
 * What the Yandex session routes share: the live lists from the user's
 * account, and one mapping from Yandex errors to responses.
 */

export async function listHosts(db: Pick<PrismaClient, "yandexConnection">, userId: string) {
  const wm = createWebmasterClient(await accessTokenFor(db, userId));
  const uid = await cachedWebmasterUserId(db, userId, () => wm.userId());
  return wm.hosts(uid);
}

export async function listCounters(db: Pick<PrismaClient, "yandexConnection">, userId: string) {
  return createMetrikaClient(await accessTokenFor(db, userId)).counters();
}

export async function listGoals(db: Pick<PrismaClient, "yandexConnection">, userId: string, counterId: string) {
  return createMetrikaClient(await accessTokenFor(db, userId)).goals(counterId);
}

/** A known Yandex error as a response, or null for anything else. */
export function yandexErrorResponse(error: unknown): Response | null {
  if (error instanceof YandexNotConnectedError) return Response.json({ error: error.message, code: "NOT_CONNECTED" }, { status: 400 });
  if (error instanceof YandexNotConfiguredError) return Response.json({ error: error.message, code: "NOT_CONFIGURED" }, { status: 503 });
  if (error instanceof YandexLinkError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof YandexApiError) return Response.json({ error: error.message, code: error.code }, { status: 502 });
  return null;
}
