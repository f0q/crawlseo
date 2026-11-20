"use client";

import { useId, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_LISTED_ERRORS, parseRankCsv, type RankCsvResult } from "@/lib/rank-providers/csv";
import { RANK_UI } from "@/lib/rank-providers/messages";
import { MAX_PUSH_ROWS } from "@/lib/rank-providers/rows";

const T = RANK_UI.import;

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none";

/** Files above this are refused in the browser: a year of daily checks of a few thousand keywords fits. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * CSV import of positions: the file is read and checked in the browser, with
 * a preview of the first rows and every line that cannot be used, then sent
 * in chunks of MAX_PUSH_ROWS to the import route, which checks them again.
 */
export function RankImport({ siteId, onDone, onClose }: { siteId: string; onDone: () => void; onClose: () => void }) {
  const id = useId();
  const [label, setLabel] = useState("");
  const [parsed, setParsed] = useState<RankCsvResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readFile(file: File | undefined) {
    setParsed(null);
    setMessage(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`The file is over ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it and import the parts.`);
      return;
    }
    setParsed(parseRankCsv(await file.text()));
    if (!label) setLabel(file.name.replace(/\.[^.]+$/, "").slice(0, 60));
  }

  async function runImport() {
    if (!parsed?.rows.length) return;
    setError(null);
    setMessage(null);
    const total = parsed.rows.length;
    let rowsWritten = 0;
    const engines = new Set<string>();
    try {
      for (let i = 0; i < total; i += MAX_PUSH_ROWS) {
        setProgress({ done: i, total });
        const res = await fetch(`/api/sites/${siteId}/rank-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim(), rows: parsed.rows.slice(i, i + MAX_PUSH_ROWS) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Import failed");
        rowsWritten += data.rowsWritten ?? 0;
        for (const engineId of data.engineIds ?? []) engines.add(engineId);
      }
      setMessage(T.done(rowsWritten, engines.size));
      setParsed(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setProgress(null);
    }
  }

  const preview = parsed?.rows.slice(0, 10) ?? [];

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
      <div>
        <h4 className="text-sm font-semibold text-text-strong">{T.title}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{T.description}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-label`} className="mb-1 block text-xs font-medium text-muted-foreground">
            {T.label}
          </label>
          <input
            id={`${id}-label`}
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={INPUT_CLASS}
            aria-describedby={`${id}-label-hint`}
          />
          <p id={`${id}-label-hint`} className="mt-1 text-[11px] text-muted-foreground">
            {T.labelHint}
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-file`} className="mb-1 block text-xs font-medium text-muted-foreground">
            {T.file}
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={(e) => void readFile(e.target.files?.[0])}
            className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-soft file:px-2.5 file:py-1 file:text-sm"
          />
        </div>
      </div>

      {parsed && (
        <div className="space-y-2">
          <p className="text-sm text-text-strong">{T.preview(parsed.rows.length, parsed.total)}</p>
          {preview.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-bg-soft text-muted-foreground">
                  <tr>
                    {["keyword", "date", "position", "engine", "region", "device", "url"].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border-soft">
                      <td className="px-2 py-1">{r.keyword}</td>
                      <td className="px-2 py-1 font-data">{r.date}</td>
                      <td className="px-2 py-1 font-data">{r.position ?? "-"}</td>
                      <td className="px-2 py-1">{r.engine}</td>
                      <td className="px-2 py-1">{r.region}</td>
                      <td className="px-2 py-1">{r.device}</td>
                      <td className="max-w-[16rem] truncate px-2 py-1 text-muted-foreground">{r.url ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parsed.errors.length > 0 && (
            <div className="text-xs text-danger">
              <p>{T.errors(parsed.errors.length)}</p>
              <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto">
                {parsed.errors.slice(0, MAX_LISTED_ERRORS).map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    {T.line(e.line)}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!parsed?.rows.length || !label.trim() || progress !== null}
          onClick={() => void runImport()}
        >
          {progress ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
          {progress ? T.running(progress.done, progress.total) : T.run(parsed?.rows.length ?? 0)}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={progress !== null}>
          {T.cancel}
        </Button>
      </div>

      {message && <p className="text-xs text-success">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
