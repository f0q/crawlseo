/*
 * The file types a project accepts (agency fork) and the size limit. No
 * server imports, so the upload form uses them too; the checks and storage
 * are in ./uploads.ts.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

export type FileKind = "pdf" | "zip-word" | "zip-excel" | "text" | "png" | "jpeg" | "gif" | "webp";

export const FILE_TYPES: Record<string, { mime: string; kind: FileKind }> = {
  pdf: { mime: "application/pdf", kind: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "zip-word" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "zip-excel" },
  txt: { mime: "text/plain; charset=utf-8", kind: "text" },
  md: { mime: "text/markdown; charset=utf-8", kind: "text" },
  csv: { mime: "text/csv; charset=utf-8", kind: "text" },
  png: { mime: "image/png", kind: "png" },
  jpg: { mime: "image/jpeg", kind: "jpeg" },
  jpeg: { mime: "image/jpeg", kind: "jpeg" },
  gif: { mime: "image/gif", kind: "gif" },
  webp: { mime: "image/webp", kind: "webp" },
};

export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);
/** For <input accept>. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

