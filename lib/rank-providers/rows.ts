import { z } from "zod";
import { parseDay, SOURCE_PATTERN } from "./common";

/*
 * The shape of positions that arrive from outside a provider sync: a CSV
 * import in the UI and POST /api/v1/sites/{id}/positions. Pure (zod only), so
 * the import dialog validates with the same rules as the server.
 */

/** Rows per request: one write API call or one import chunk. */
export const MAX_PUSH_ROWS = 5_000;
/** Engines of imports and pushes per site, so a script cannot grow the list without end. */
export const MAX_MANUAL_ENGINES_PER_SITE = 200;

const day = z
  .string()
  .refine((v) => parseDay(v) !== null, "date must be YYYY-MM-DD")
  .transform((v) => parseDay(v)!)
  .refine((v) => Date.parse(`${v}T00:00:00Z`) <= Date.now() + 86_400_000, "date is in the future");

const count = z.number().int().min(0).max(2_000_000_000).nullable().optional();

export const pushRowSchema = z.object({
  keyword: z.string().trim().min(1, "keyword is empty").max(500),
  date: day,
  /** A whole rank from 1; null when the site was checked and not found. */
  position: z.number().int().min(1).max(1000).nullable(),
  url: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\/\S+$/, "url must start with http:// or https://")
    .nullable()
    .optional(),
  frequency: count,
  frequencyExact: count,
});

export type PushRow = z.infer<typeof pushRowSchema>;

const engineFields = {
  engine: z.string().trim().min(1, "engine is empty").max(60),
  region: z.string().trim().max(120).default(""),
  device: z.string().trim().max(30).default(""),
};

/** The body of POST /api/v1/sites/{id}/positions. */
export const pushBatchSchema = z.object({
  source: z.string().regex(SOURCE_PATTERN, "source must be 2 to 32 of a-z, 0-9, - and _, starting with a letter or digit"),
  ...engineFields,
  label: z.string().trim().max(60).default(""),
  rows: z.array(pushRowSchema).min(1, "rows is empty").max(MAX_PUSH_ROWS, `at most ${MAX_PUSH_ROWS} rows per request`),
});

export type PushBatch = z.infer<typeof pushBatchSchema>;

/** One imported row: a position row with its engine, region and device. */
export const importRowSchema = pushRowSchema.extend(engineFields);
export type ImportRow = z.infer<typeof importRowSchema>;

/** The body of the CSV import route: rows already parsed in the browser. */
export const importBatchSchema = z.object({
  label: z.string().trim().min(1, "Give the import a label").max(60),
  rows: z.array(importRowSchema).min(1).max(MAX_PUSH_ROWS),
});

/** "rows.3.date: date must be YYYY-MM-DD", for the first few problems. */
export function zodMessage(error: z.ZodError, max = 5): string {
  const lines = error.issues.slice(0, max).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  const more = error.issues.length > max ? ` (and ${error.issues.length - max} more)` : "";
  return lines.join("; ") + more;
}
