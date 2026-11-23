import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db as appDb } from "@/lib/db";
import { DEFAULT_TIME_ZONE, isValidTimeZone, normalizeTimeZone } from "@/lib/timezone";

/*
 * The signed-in user's display time zone on the server (agency fork). Stored
 * in UserSettings.timeZone (migration 20261127000000_agency_time_zone); a
 * user without a settings row gets the default. See lib/timezone.ts.
 */

type Db = Pick<PrismaClient, "userSettings">;

export async function readTimeZone(db: Db, userId: string): Promise<string> {
  try {
    const row = await db.userSettings.findUnique({ where: { userId }, select: { timeZone: true } });
    return normalizeTimeZone(row?.timeZone);
  } catch {
    // A display preference never breaks a page.
    return DEFAULT_TIME_ZONE;
  }
}

/** Saves the zone; false when it is not an IANA zone name. */
export async function saveTimeZone(db: Db, userId: string, zone: string): Promise<boolean> {
  if (!isValidTimeZone(zone)) return false;
  await db.userSettings.upsert({ where: { userId }, create: { userId, timeZone: zone }, update: { timeZone: zone } });
  return true;
}

/** The zone of the user of this request, read once per request. Signed out: the default. */
export const getDisplayTimeZone = cache(async (): Promise<string> => {
  const session = await auth();
  const id = session?.user?.id;
  return id ? readTimeZone(appDb, id) : DEFAULT_TIME_ZONE;
});
