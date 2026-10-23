import { createHash } from "node:crypto";
import { db, yearDocuments, type MailAttachmentRecord, type MailingDraft } from "@workspace/db";
import { eq } from "drizzle-orm";
import { reportContext, reportHolder, finalized, noticeFilename, statementFilename } from "./reports/context";
import { statementHtml, statementNoticeHtml } from "./reports/templates";
import { onePagePdf, withPdfBrowser } from "./reports/pdf";
import { yearDocumentStore } from "./year-document-store";
import { assertEnvelopeSize, uniformMailText } from "./mailing-rules";
import { HttpError } from "./errors";

export const MAIL_SENDER = "Horace W. Davis Realty Corp. <horace@hwdfarm.com>";
export async function mailingEnvelope(yearId: number, content: MailingDraft, personId: string, to: string, replyTo: string, preview: boolean) {
  const context = await reportContext(yearId);
  finalized(context);
  const holder = reportHolder(context, personId);
  const attachments: { filename: string; content: string }[] = [], records: MailAttachmentRecord[] = [];
  let encodedBytes = 0;
  function attach(filename: string, bytes: Buffer, documentId?: number) {
    encodedBytes += Math.ceil(bytes.length / 3) * 4;
    if (encodedBytes >= 39_900_000) throw new HttpError(400, "Email exceeds the 40 MB limit; remove shared attachments.");
    attachments.push({ filename, content: bytes.toString("base64") });
    records.push({ filename, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...(documentId ? { documentId } : {}) });
  }
  for (const id of content.documentIds) {
    const [doc] = await db.select().from(yearDocuments).where(eq(yearDocuments.id, id));
    if (!doc || doc.yearId !== yearId || doc.contentType !== "application/pdf") throw new HttpError(400, "Shared attachment is not a sealed PDF for this year");
    if (encodedBytes + Math.ceil(doc.size / 3) * 4 >= 39_900_000) throw new HttpError(400, "Email exceeds the 40 MB limit; remove shared attachments.");
    const file = await yearDocumentStore.getFile(doc.objectPath);
    const [bytes] = await file.download();
    attach(doc.filename, bytes, id);
  }
  const choice = content.choices[personId] ?? content.attachment;
  if (choice !== "none") {
    const bytes = await withPdfBrowser((browser) => onePagePdf(browser, choice === "notice" ? statementNoticeHtml(context, holder) : statementHtml(context, holder)));
    attach(choice === "notice" ? noticeFilename(context, holder) : statementFilename(context, holder), bytes);
  }
  const { subject, body } = uniformMailText(content, context.year.isPractice, preview);
  const payload = { from: MAIL_SENDER, to: [to], reply_to: replyTo, subject, text: body, attachments };
  const wireBytes = assertEnvelopeSize(payload);
  return { payload, records, wireBytes, subject, body };
}
