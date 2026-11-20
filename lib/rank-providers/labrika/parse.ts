/**
 * Pure parsing helpers for the Labrika Public API (serp endpoints).
 * Kept free of database imports so they can be unit tested on their own.
 *
 * Every list answers `{ data: [...], pagination: { next_offset, has_more } }`.
 * Positions are keyed by check date (`YYYY-MM-DDT00:00:00Z`); a position of
 * null means the site was not within the depth Labrika checks.
 */

import { parseDay } from "../common";

/** ExternalRankEngine.source and ApiKey.provider of Labrika. */
export const LABRIKA_SOURCE = "labrika";

/** One search engine of a Labrika project: a search engine, a region and a device. */
export interface LabrikaEngine {
  id: string;
  engine: string;
  region: string;
  device: string;
}

export interface LabrikaSite {
  siteUuid: string;
  host: string;
  title: string;
  engines: LabrikaEngine[];
}

export interface LabrikaCheck {
  date: string; // YYYY-MM-DD
  position: number | null;
  url: string | null;
}

export interface LabrikaKeywordRow {
  keyword: string;
  frequency: number | null;
  frequencyExact: number | null;
  /** Only the dates Labrika returned an entry for, oldest first. */
  checks: LabrikaCheck[];
}

export interface LabrikaPage<T> {
  items: T[];
  /** The offset of the next page, or null on the last one. */
  nextOffset: number | null;
}

/** The answer did not have the shape the API documents. */
export class LabrikaResponseError extends Error {
  constructor(message: string) {
    super(`Unexpected Labrika response: ${message}`);
    this.name = "LabrikaResponseError";
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** A count Labrika left out stays null: absent is not zero. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** A rank is a whole number from 1; anything else is "not ranked". */
export function normalisePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** `2026-11-18T00:00:00Z` (or a bare day) to `2026-11-18`; null when it is not a day. */
export const parseLabrikaDay = parseDay;

/** The collected_at value of a day, the only format the API accepts besides `last`. */
export function labrikaCollectedAt(day: string): string {
  if (parseLabrikaDay(day) !== day) throw new Error(`Not a day: ${day}`);
  return `${day}T00:00:00Z`;
}

function page<T>(body: unknown, parseItem: (item: unknown) => T | null): LabrikaPage<T> {
  if (!isObject(body) || !Array.isArray(body.data)) throw new LabrikaResponseError("no data list");
  const pagination = isObject(body.pagination) ? body.pagination : {};
  const next = pagination.next_offset;
  const nextOffset =
    pagination.has_more !== false && typeof next === "number" && Number.isInteger(next) && next > 0 ? next : null;
  const items = body.data.map(parseItem).filter((item): item is T => item !== null);
  return { items, nextOffset };
}

function parseEngine(value: unknown): LabrikaEngine | null {
  if (!isObject(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  return {
    id,
    engine: str(value.engine_title),
    region: str(value.region_title),
    device: str(value.device),
  };
}

export function parseSitesPage(body: unknown): LabrikaPage<LabrikaSite> {
  return page(body, (value) => {
    if (!isObject(value)) return null;
    const siteUuid = str(value.site_uuid);
    if (!siteUuid) return null;
    const engines = Array.isArray(value.search_engines) ? value.search_engines : [];
    return {
      siteUuid,
      host: str(value.host),
      title: str(value.title),
      engines: engines.map(parseEngine).filter((e): e is LabrikaEngine => e !== null),
    };
  });
}

/** Check dates as days. The API lists them newest first; the order is kept. */
export function parseDatesPage(body: unknown): LabrikaPage<string> {
  return page(body, (value) => (isObject(value) ? parseLabrikaDay(value.collected_at) : null));
}

export function parsePositionsPage(body: unknown): LabrikaPage<LabrikaKeywordRow> {
  return page(body, (value) => {
    if (!isObject(value)) return null;
    const keyword = str(value.keyword).trim();
    if (!keyword) return null;
    const checks: LabrikaCheck[] = [];
    if (isObject(value.positions)) {
      for (const [key, entry] of Object.entries(value.positions)) {
        const date = parseLabrikaDay(key);
        if (!date || !isObject(entry)) continue;
        const url = typeof entry.url === "string" && /^https?:\/\//.test(entry.url) ? entry.url : null;
        checks.push({ date, position: normalisePosition(entry.position), url });
      }
    }
    checks.sort((a, b) => a.date.localeCompare(b.date));
    return {
      keyword,
      frequency: count(value.frequency),
      frequencyExact: count(value.frequency_exact),
      checks,
    };
  });
}

/** `{ error: { code, message } }`, the documented error body, or null. */
export function parseLabrikaError(body: unknown): { code: string; message: string } | null {
  if (!isObject(body) || !isObject(body.error)) return null;
  const code = str(body.error.code);
  const message = str(body.error.message);
  return code || message ? { code, message } : null;
}
