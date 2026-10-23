import { PDFDocument } from "pdf-lib";
import { reportContext, reportHolder, finalized } from "./reports/context";
import { statementHtml, statementNoticeHtml } from "./reports/templates";
import { onePagePdf, withPdfBrowser } from "./reports/pdf";
import type { mailingView } from "./mailings";
import { HttpError } from "./errors";

export async function printPaperLetters(yearId: number, view: Awaited<ReturnType<typeof mailingView>>) {
  const context = await reportContext(yearId); finalized(context);
  const paper = view.recipients.filter((r) => r.channel !== "Email");
  if (!paper.length) throw new HttpError(409, "No paper recipients");
  const combined = await PDFDocument.create();
  await withPdfBrowser(async (browser) => {
    for (const recipient of paper) {
      if (recipient.attachment === "none") {
        // HTML print uses the same Chromium/font support as reports.
        const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
        const html = `<html><head><style>@page{size:Letter;margin:.55in}.sheet{font-family:Arial} .mark{position:fixed;top:45%;transform:rotate(-32deg);font-size:34px;color:#aaa}</style></head><body><main class="sheet">${view.isPractice ? '<div class="mark">PRACTICE — NOT A STATEMENT</div>' : ""}<h1>Paper mailing</h1><h2>${escape(recipient.displayName)}</h2><p>No per-person attachment was chosen.</p></main></body></html>`;
        const doc = await PDFDocument.load(await onePagePdf(browser, html));
        for (const page of await combined.copyPages(doc, doc.getPageIndices())) combined.addPage(page);
      } else {
        const holder = reportHolder(context, recipient.personId);
        const doc = await PDFDocument.load(await onePagePdf(browser, recipient.attachment === "notice" ? statementNoticeHtml(context, holder) : statementHtml(context, holder)));
        for (const page of await combined.copyPages(doc, doc.getPageIndices())) combined.addPage(page);
      }
    }
  });
  // Keep PDF text layers intact; no rasterization.
  return Buffer.from(await combined.save());
}
