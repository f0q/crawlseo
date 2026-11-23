"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveTimeZone } from "@/lib/timezone-server";

/*
 * Agency fork: Settings > Time zone. POST only, with Next.js's own Origin
 * check; acts on the signed-in user from the session.
 */

export type TimeZoneResult = { ok: boolean; error?: string };

export async function saveTimeZoneAction(zone: string): Promise<TimeZoneResult> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, error: "Sign in again to change the time zone." };
  if (!(await saveTimeZone(db, id, String(zone ?? "")))) return { ok: false, error: "Pick a time zone from the list." };
  // Every page shows times in it: render them again.
  revalidatePath("/", "layout");
  return { ok: true };
}
