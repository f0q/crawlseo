"use client";

import { createContext, useContext } from "react";
import { setBrowserTimeZone } from "@/lib/timezone";

/*
 * Agency fork: the signed-in user's display time zone for client components
 * (lib/timezone.ts). The dashboard layout reads it on the server and wraps
 * the app in this provider, so the server render and the browser agree.
 * Without a provider, times stay in UTC as upstream shows them.
 */

const TimeZoneContext = createContext<string>("UTC");

export function TimeZoneProvider({ zone, children }: { zone: string; children: React.ReactNode }) {
  // For text built after an interaction (e.g. a job's next attempt), formatDay's default in the browser.
  setBrowserTimeZone(zone);
  return <TimeZoneContext.Provider value={zone}>{children}</TimeZoneContext.Provider>;
}

/** The zone to pass to formatDay as `timeZone` when it shows a date-time. */
export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}
