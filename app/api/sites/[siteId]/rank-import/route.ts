import { db } from "@/lib/db";
import { IMPORT_SOURCE } from "@/lib/rank-providers/common";
import { ensureManualEngine, writeManualRows } from "@/lib/rank-providers/manual";
import { importBatchSchema, zodMessage, type ImportRow } from "@/lib/rank-providers/rows";
import { ownSiteOrResponse, rankErrorResponse } from "@/lib/rank-providers/routes";

/*
 * POST { label, rows }: positions from a CSV file, parsed and checked in the
 * browser (lib/rank-providers/csv.ts) and checked again here. Rows go to one
 * engine per search engine, region and device under source "import" and the
 * label; the same keyword on the same day is replaced, so importing a file
 * twice leaves the same rows. A large file comes in several requests.
 */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const owner = await ownSiteOrResponse(siteId);
    if ("error" in owner) return owner.error;

    const parsed = importBatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { label, rows } = parsed.data;

    const groups = new Map<string, ImportRow[]>();
    for (const row of rows) {
      const key = JSON.stringify([row.engine, row.region, row.device]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    let rowsWritten = 0;
    const engineIds: string[] = [];
    for (const group of groups.values()) {
      const { engine, region, device } = group[0];
      const target = await ensureManualEngine(db, owner.site, { source: IMPORT_SOURCE, engine, region, device, label });
      rowsWritten += (await writeManualRows(db, target.id, group)).rowsWritten;
      engineIds.push(target.id);
    }
    return Response.json({ rowsWritten, engines: engineIds.length, engineIds });
  } catch (error) {
    const known = rankErrorResponse(error);
    if (known) return known;
    console.error("Rank import error:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
