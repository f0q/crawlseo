/*
 * Small files of each accepted type, and lookalikes, for the upload tests
 * (agency fork). Only the bytes the checks read are real.
 */

export const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
export const TEXT = Buffer.from("Бриф клиента\nGoals: more leads.\n");
export const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** The local file headers of a minimal Office Open XML zip: what the check looks for. */
function ooxml(folder: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    Buffer.from("[Content_Types].xml"),
    Buffer.alloc(8, 0),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    Buffer.from(`${folder}/document.xml`),
  ]);
}
export const DOCX = ooxml("word");
export const XLSX = ooxml("xl");
