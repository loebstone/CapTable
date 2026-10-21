import { Router, type IRouter, type Request, type Response } from "express";
import JSZip from "jszip";
import {
  DownloadStatementParams, DownloadStatementsZipParams, DownloadBoardSummaryParams, DownloadLedgerParams,
} from "@workspace/api-zod";
import { reportContext, reportHolder, finalized, statementFilename, reportFilename } from "../lib/reports/context";
import { statementHtml, boardHtml } from "../lib/reports/templates";
import { withPdfBrowser, onePagePdf } from "../lib/reports/pdf";
import { ledgerWorkbook } from "../lib/reports/workbook";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
async function sendReport(req: Request, res: Response, filename: string, mime: string, bytes: Buffer) {
  // The common router already checks Roster + local access. Recheck local access
  // after rendering too, so revocation during a longer ZIP cannot release data.
  await assertAccess(currentIdentity(req).personId);
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
}
router.get("/years/:id/reports/statement/:personId.pdf", async (req, res): Promise<void> => {
  const { id, personId } = DownloadStatementParams.parse(req.params);
  const context = await reportContext(id); finalized(context);
  const holder = reportHolder(context, personId);
  const bytes = await withPdfBrowser((browser) => onePagePdf(browser, statementHtml(context, holder)));
  await sendReport(req, res, statementFilename(context, holder), "application/pdf", bytes);
});
router.get("/years/:id/reports/statements.zip", async (req, res): Promise<void> => {
  const { id } = DownloadStatementsZipParams.parse(req.params);
  const context = await reportContext(id); finalized(context);
  const filenames = context.year.holders.map((holder) => statementFilename(context, holder));
  if (new Set(filenames).size !== filenames.length) throw new HttpError(409, "Two shareholders produce the same inferred statement filename; export them individually rather than silently replacing a ZIP entry");
  const bytes = await withPdfBrowser(async (browser) => {
    const zip = new JSZip();
    for (const [index, holder] of context.year.holders.entries()) {
      zip.file(filenames[index], await onePagePdf(browser, statementHtml(context, holder)));
    }
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  });
  await sendReport(req, res, reportFilename(context, "zip"), "application/zip", bytes);
});
router.get("/years/:id/reports/board.pdf", async (req, res): Promise<void> => {
  const { id } = DownloadBoardSummaryParams.parse(req.params);
  const context = await reportContext(id);
  const bytes = await withPdfBrowser((browser) => onePagePdf(browser, boardHtml(context), true));
  await sendReport(req, res, reportFilename(context, "board"), "application/pdf", bytes);
});
router.get("/years/:id/reports/ledger.xlsx", async (req, res): Promise<void> => {
  const { id } = DownloadLedgerParams.parse(req.params);
  const context = await reportContext(id); finalized(context, "ledger");
  await sendReport(req, res, reportFilename(context, "ledger"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await ledgerWorkbook(context));
});
export default router;
