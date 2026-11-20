"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/format";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { FILE_CATEGORIES } from "@/lib/projects/schema";
import { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/projects/file-types";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, useAction } from "./ui";

const T = M.files;

export type FileItem = { id: string; name: string; size: number; category: string; uploadedBy: string; createdAt: string };

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Upload, list, download (always as an attachment) and delete the project's files. */
export function FilesSection({ slug, files, canEdit }: { slug: string; files: FileItem[]; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>("materials");
  const { busy, error, setError, run } = useAction();

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError(M.errors.fileTooLarge(MAX_UPLOAD_MB));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    const r = await run("upload", () => send(projectUrl(slug, "files"), "POST", fd));
    if (r && input.current) input.current.value = "";
  }

  return (
    <Section title={T.title} description={T.description(ALLOWED_EXTENSIONS.join(", "), MAX_UPLOAD_MB)}>
      {canEdit && (
        <form onSubmit={upload} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input ref={input} type="file" accept={ACCEPT_ATTRIBUTE} required className="flex-1 text-[13px] text-text-strong file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-section file:px-3 file:py-1.5" />
          <Field label={T.category}>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {FILE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {M.labels.fileCategory[c]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="outline" disabled={busy !== null}>
            <Upload aria-hidden />
            {busy === "upload" ? T.uploading : T.upload}
          </Button>
        </form>
      )}
      <ErrorLine error={error} />
      {files.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{T.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-text-strong">{f.name}</p>
                <p className="mono-label text-[11px] text-muted-foreground">
                  {(M.labels.fileCategory as Record<string, string>)[f.category] ?? f.category} · {size(f.size)} · {T.by(f.uploadedBy, formatDay(f.createdAt, { year: true }))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a href={projectUrl(slug, "files", f.id)} download className="inline-flex items-center gap-1.5 text-[13px] text-link hover:underline">
                  <Download className="size-3.5" aria-hidden />
                  {T.download}
                </a>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy !== null}
                    onClick={() => window.confirm(T.deleteConfirm) && run(f.id, () => send(projectUrl(slug, "files", f.id), "DELETE"))}
                  >
                    {T.delete}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
