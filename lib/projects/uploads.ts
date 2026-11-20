import { createHash, randomBytes } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { ALLOWED_EXTENSIONS, FILE_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, type FileKind } from "./file-types";
import { PROJECT_MESSAGES as M } from "./messages";

/*
 * Project files on disk (agency fork). A file is accepted only when its
 * extension is in ./file-types.ts and its first bytes match that type, at
 * most 20 MB. It is stored as UPLOADS_DIR/<projectId>/<32 random hex>.<ext>,
 * so a name from the browser never reaches the file system, and it is always
 * sent back as an attachment with the type from this list. HTML, SVG and
 * anything executable are refused.
 */

export { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS, FILE_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./file-types";
export const DEFAULT_UPLOADS_DIR = "/data/uploads";

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function hasBytes(b: Buffer, s: string): boolean {
  return b.indexOf(Buffer.from(s, "latin1")) !== -1;
}

function isUtf8Text(b: Buffer): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Whether the bytes are a file of that kind, by its signature. */
export function matchesKind(kind: FileKind, b: Buffer): boolean {
  switch (kind) {
    case "pdf":
      return startsWith(b, ascii("%PDF-"));
    case "zip-word":
      return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && hasBytes(b, "[Content_Types].xml") && hasBytes(b, "word/");
    case "zip-excel":
      return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && hasBytes(b, "[Content_Types].xml") && hasBytes(b, "xl/");
    case "text":
      return isUtf8Text(b);
    case "png":
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg":
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"));
    case "webp":
      return startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8);
  }
}

/** The name to show and send: no folders, no control or quote characters, at most 200 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 200) return cleaned || "file";
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 200 - ext.length) + ext;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export type CheckedUpload = { ok: true; name: string; type: string; mime: string } | { ok: false; error: string; status: 400 | 413 };

/** Whether a file may be stored: size, an allowed extension and content of that type. */
export function checkUpload(name: string, bytes: Buffer): CheckedUpload {
  if (bytes.length === 0) return { ok: false, error: M.errors.fileEmpty, status: 400 };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: M.errors.fileTooLarge(MAX_UPLOAD_MB), status: 413 };
  const clean = cleanFileName(name);
  const ext = extensionOf(clean);
  const type = FILE_TYPES[ext];
  if (!type) return { ok: false, error: M.errors.fileType(ext, ALLOWED_EXTENSIONS.join(", ")), status: 400 };
  if (!matchesKind(type.kind, bytes)) return { ok: false, error: M.errors.fileContent(ext), status: 400 };
  return { ok: true, name: clean, type: ext, mime: type.mime };
}

export function uploadsDir(): string {
  return resolve(process.env.UPLOADS_DIR?.trim() || DEFAULT_UPLOADS_DIR);
}

const STORAGE_NAME = /^[a-f0-9]{32}\.[a-z0-9]{1,5}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,40}$/;

function pathOf(projectId: string, storageName?: string): string {
  if (!PROJECT_ID.test(projectId)) throw new Error("bad project id");
  if (storageName !== undefined && !STORAGE_NAME.test(storageName)) throw new Error("bad storage name");
  return storageName ? join(uploadsDir(), projectId, storageName) : join(uploadsDir(), projectId);
}

/** Writes the bytes under a new random name and returns it with the file's SHA-256. */
export async function storeFile(projectId: string, type: string, bytes: Buffer): Promise<{ storageName: string; sha256: string }> {
  const storageName = `${randomBytes(16).toString("hex")}.${type}`;
  await mkdir(pathOf(projectId), { recursive: true, mode: 0o700 });
  await writeFile(pathOf(projectId, storageName), bytes, { flag: "wx", mode: 0o600 });
  return { storageName, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readStoredFile(projectId: string, storageName: string): Promise<Buffer> {
  return readFile(pathOf(projectId, storageName));
}

export async function removeStoredFile(projectId: string, storageName: string): Promise<void> {
  await rm(pathOf(projectId, storageName), { force: true });
}

export async function removeProjectFiles(projectId: string): Promise<void> {
  await rm(pathOf(projectId), { recursive: true, force: true });
}

/** `attachment; filename="..."; filename*=UTF-8''...`: the ASCII form for old clients, the exact one for the rest. */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** The response of a download: always an attachment, never sniffed or rendered. */
export function downloadResponse(file: { name: string; mime: string }, bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(file.name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
