import { importRowSchema, type ImportRow } from "./rows";

/*
 * CSV import of positions (agency fork), run in the browser for the preview
 * and the same rules again on the server (rows.ts). Columns, by header name
 * in English or Russian, any order: keyword, date, position, url (optional),
 * engine, region, device (optional). The delimiter is found from the header:
 * comma, semicolon or tab. A UTF-8 byte order mark is dropped.
 */

export type CsvColumn = "keyword" | "date" | "position" | "url" | "engine" | "region" | "device" | "frequency";

const ALIASES: Record<CsvColumn, string[]> = {
  keyword: ["keyword", "query", "phrase", "key", "запрос", "ключ", "ключевое слово", "ключевая фраза", "фраза"],
  date: ["date", "check date", "checked", "дата", "дата проверки", "дата съема", "дата съёма"],
  position: ["position", "pos", "rank", "позиция", "место"],
  url: ["url", "page", "landing page", "страница", "адрес", "релевантный url", "релевантная страница"],
  engine: ["engine", "search engine", "se", "поисковик", "пс", "поисковая система"],
  region: ["region", "location", "city", "регион", "город"],
  device: ["device", "устройство"],
  frequency: ["frequency", "freq", "volume", "частота", "частотность"],
};

export const REQUIRED_COLUMNS: CsvColumn[] = ["keyword", "date", "position", "engine"];

export type CsvError = { line: number; message: string };

export type RankCsvResult = {
  rows: ImportRow[];
  errors: CsvError[];
  /** Data lines read, the header and blank lines aside. */
  total: number;
  columns: Partial<Record<CsvColumn, number>>;
};

/** At most this many errors are listed; the count says how many there were. */
export const MAX_LISTED_ERRORS = 100;

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180: quoted fields with doubled quotes and line breaks inside, CRLF or LF. Each record keeps its first line number. */
export function parseCsv(text: string, delimiter?: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cells.push(cell);
      out.push({ line: start, cells });
      cells = [];
      cell = "";
      line++;
      start = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length) {
    cells.push(cell);
    out.push({ line: start, cells });
  }
  return out.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е");

/** Which column holds what, from the header. */
export function mapColumns(header: string[]): Partial<Record<CsvColumn, number>> {
  const map: Partial<Record<CsvColumn, number>> = {};
  header.forEach((h, i) => {
    const name = norm(h);
    for (const [col, names] of Object.entries(ALIASES) as [CsvColumn, string[]][]) {
      if (map[col] === undefined && names.some((n) => norm(n) === name)) map[col] = i;
    }
  });
  return map;
}

const NOT_RANKED = /^(|-|–|—|0|n\/a|na|нет|none|not ranked|>\s*\d+|\d+\s*\+)$/i;

/** A rank from a cell: a whole number from 1, null for "not ranked" markers, undefined when unreadable. */
export function parsePositionCell(value: string): number | null | undefined {
  const v = value.trim();
  if (NOT_RANKED.test(v)) return null;
  const n = Number(v.replace(",", "."));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** YYYY-MM-DD from YYYY-MM-DD, an ISO timestamp, or DD.MM.YYYY; the text unchanged otherwise (the schema refuses it). */
export function parseDateCell(value: string): string {
  const v = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]+Z?)?$/.exec(v);
  if (iso) return iso[1];
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  return v;
}

/** Reads a positions CSV into rows the import route takes, with an error per line it cannot use. */
export function parseRankCsv(text: string): RankCsvResult {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty" }], total: 0, columns: {} };
  const [header, ...data] = records;
  const columns = mapColumns(header.cells);
  const missing = REQUIRED_COLUMNS.filter((c) => columns[c] === undefined);
  if (missing.length) {
    return {
      rows: [],
      errors: [{ line: header.line, message: `Missing column(s): ${missing.join(", ")}. The header names the columns.` }],
      total: data.length,
      columns,
    };
  }

  const rows: ImportRow[] = [];
  const errors: CsvError[] = [];
  const cell = (cells: string[], col: CsvColumn) => (columns[col] === undefined ? "" : (cells[columns[col]!] ?? "").trim());

  for (const { line, cells } of data) {
    const position = parsePositionCell(cell(cells, "position"));
    if (position === undefined) {
      errors.push({ line, message: `position "${cell(cells, "position")}" is not a whole number from 1` });
      continue;
    }
    const freq = cell(cells, "frequency");
    const url = cell(cells, "url");
    const parsed = importRowSchema.safeParse({
      keyword: cell(cells, "keyword"),
      date: parseDateCell(cell(cells, "date")),
      position,
      url: url || null,
      frequency: freq && /^\d+$/.test(freq) ? Number(freq) : null,
      engine: cell(cells, "engine"),
      region: cell(cells, "region"),
      device: cell(cells, "device"),
    });
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ line, message: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  return { rows, errors, total: data.length, columns };
}
