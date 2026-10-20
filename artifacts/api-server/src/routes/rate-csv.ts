import { Router, type IRouter } from "express";
import { db, rateTables, rateImports, rateCodeRevisions } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { PreviewRateCsvBody, PreviewRateCsvResponse, ConfirmRateCsvBody, ConfirmRateCsvResponse, DownloadRatesCsvParams } from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { append, write } from "../lib/records";
import { currentRates } from "../lib/rate-data";
import { parseRateCsv, previewRows, previewToken, verifyPreview, ratesCsv } from "../lib/rate-csv";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
function checkSize(body: unknown) {
  if (body && typeof body === "object" && "csv" in body && typeof body.csv === "string" && Buffer.byteLength(body.csv, "utf8") > 65536) {
    throw new HttpError(413, "CSV file exceeds the 64 KB limit");
  }
}
router.post("/rates/csv/preview", async (req, res): Promise<void> => {
  checkSize(req.body);
  const input = PreviewRateCsvBody.parse(req.body);
  const parsed = parseRateCsv(input.filename, input.csv);
  const actor = currentIdentity(req).personId;
  const current = await db.transaction((tx) => currentRates(tx, input.taxYear), { isolationLevel: "repeatable read", accessMode: "read only" });
  const rows = previewRows(parsed, current);
  res.json(PreviewRateCsvResponse.parse({
    ...input, rows, previewToken: previewToken(actor, input, current),
    changedCount: rows.filter((r) => r.status !== "unchanged").length,
    unchangedCount: rows.filter((r) => r.status === "unchanged").length,
  }));
});
router.post("/rates/csv/confirm", async (req, res): Promise<void> => {
  checkSize(req.body);
  const { previewToken: token, ...input } = ConfirmRateCsvBody.parse(req.body);
  const parsed = parseRateCsv(input.filename, input.csv);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const current = await currentRates(tx, input.taxYear);
    verifyPreview(token, actor, input, current);
    const rows = previewRows(parsed, current), changed = rows.filter((r) => r.status !== "unchanged");
    const summary = { taxYear: input.taxYear, filename: input.filename, rows, changedCount: changed.length, unchangedCount: rows.length - changed.length };
    // An identical import is truly read-only: no import record and no audit row.
    if (!changed.length) return { ...summary, importId: null };
    const [base] = await tx.select({ id: rateTables.id }).from(rateTables).where(eq(rateTables.taxYear, input.taxYear)).orderBy(desc(rateTables.id)).limit(1);
    const imported = await append(tx, actor, rateImports, {
      taxYear: input.taxYear, baseTableId: base?.id ?? null, filename: input.filename,
      changedCount: summary.changedCount, unchangedCount: summary.unchangedCount, createdBy: actor,
    }, `CSV_IMPORT ${JSON.stringify({ filename: input.filename, rows: rows.length, changed: changed.length, unchanged: summary.unchangedCount })}`);
    for (const row of changed) await append(tx, actor, rateCodeRevisions, { importId: imported.id, code: row.code, rate: row.rate, sourceNote: row.sourceNote });
    return { ...summary, importId: imported.id };
  });
  res.json(ConfirmRateCsvResponse.parse(result));
});
router.get("/rates/:taxYear/csv", async (req, res): Promise<void> => {
  const { taxYear } = DownloadRatesCsvParams.parse(req.params);
  const current = await db.transaction((tx) => currentRates(tx, taxYear), { isolationLevel: "repeatable read", accessMode: "read only" });
  if (!current) throw new HttpError(404, "Rate year not found");
  res.type("text/csv").attachment(`HWD_Rates_${taxYear}.csv`).send(ratesCsv(current));
});
export default router;
