import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCX, HTML, JPEG, PDF, PNG, SVG, TEXT, XLSX } from "@/lib/testing/project-files";
import { checkUpload, cleanFileName, contentDisposition, downloadResponse, MAX_UPLOAD_BYTES, readStoredFile, storeFile } from "./uploads";

// Project uploads (agency fork): extension and content must agree, at most
// 20 MB, random names on disk, always downloaded as an attachment.

describe("checkUpload", () => {
  it.each([
    ["brief.pdf", PDF, "pdf", "application/pdf"],
    ["Brief.PDF", PDF, "pdf", "application/pdf"],
    ["logo.png", PNG, "png", "image/png"],
    ["photo.jpeg", JPEG, "jpeg", "image/jpeg"],
    ["notes.txt", TEXT, "txt", "text/plain; charset=utf-8"],
    ["contract.docx", DOCX, "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["prices.xlsx", XLSX, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("accepts %s", (name, bytes, type, mime) => {
    expect(checkUpload(name, bytes)).toMatchObject({ ok: true, type, mime });
  });

  it.each([
    ["page.html", HTML, /not accepted/],
    ["icon.svg", SVG, /not accepted/],
    ["run.exe", PDF, /not accepted/],
    ["noext", PDF, /not accepted/],
    ["fake.pdf", HTML, /not a pdf file/],
    ["fake.png", PDF, /not a png file/],
    ["fake.docx", XLSX, /not a docx file/],
    ["binary.txt", Buffer.from([0x41, 0x00, 0x42]), /not a txt file/],
    ["empty.pdf", Buffer.alloc(0), /empty/],
  ])("refuses %s", (name, bytes, error) => {
    const r = checkUpload(name, bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });

  it("refuses a file over 20 MB with 413", () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect(checkUpload("big.pdf", big)).toMatchObject({ ok: false, status: 413 });
  });

  it("cleans names: no folders, no control or quote characters", () => {
    expect(cleanFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(cleanFileName('C:\\Users\\x\\"evil"\r\n.pdf')).toBe("evil.pdf");
    expect(cleanFileName(`${"a".repeat(300)}.pdf`)).toMatch(/^a{196}\.pdf$/);
  });
});

describe("storage and download", () => {
  let dir: string;
  const before = process.env.UPLOADS_DIR;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "crawlseo-uploads-"));
    process.env.UPLOADS_DIR = dir;
  });
  afterAll(async () => {
    process.env.UPLOADS_DIR = before;
    await rm(dir, { recursive: true, force: true });
  });

  it("stores under a random name in the project's folder", async () => {
    const a = await storeFile("projabc12345", "pdf", PDF);
    const b = await storeFile("projabc12345", "pdf", PDF);
    expect(a.storageName).toMatch(/^[a-f0-9]{32}\.pdf$/);
    expect(a.storageName).not.toBe(b.storageName);
    expect(a.sha256).toBe(b.sha256);
    expect((await readdir(join(dir, "projabc12345"))).sort()).toEqual([a.storageName, b.storageName].sort());
    expect((await readStoredFile("projabc12345", a.storageName)).equals(PDF)).toBe(true);
  });

  it("never reads outside the uploads folder", async () => {
    await expect(readStoredFile("projabc12345", "../../etc/passwd")).rejects.toThrow(/bad storage name/);
    await expect(readStoredFile("../x", "0".repeat(32) + ".pdf")).rejects.toThrow(/bad project id/);
    await expect(readStoredFile("a/b", "0".repeat(32) + ".pdf")).rejects.toThrow(/bad project id/);
  });

  it("sends an attachment that is never sniffed or rendered", async () => {
    const res = downloadResponse({ name: "Бриф \"v2\".pdf", mime: "application/pdf" }, PDF);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="____ _v2_.pdf"; filename*=UTF-8''%D0%91%D1%80%D0%B8%D1%84%20%22v2%22.pdf`
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("encodes quotes and parentheses in the exact file name", () => {
    expect(contentDisposition("a'(1).txt")).toContain("filename*=UTF-8''a%27%281%29.txt");
  });
});
