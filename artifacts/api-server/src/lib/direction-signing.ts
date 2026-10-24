import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  db, directionTokens, directionTokenEvents, directionSessions, directionTemplates, signedDirections,
  directionReceipts, yearDocuments, yearUploads, type DirectionEvidence,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { hash, randomToken } from "./auth";
import { append, write, type Tx } from "./records";
import { yearDetail } from "./distribution-years";
import { tokenState, directionCutoff } from "./direction-links";
import { assertDirectionAmount, CONSENT_TEXT, directionPage, money, evidencePage, fillDirection, nyDate, signatureInput } from "./direction-rules";
import { withPdfBrowser, onePagePdf } from "./reports/pdf";
import { yearDocumentStore } from "./year-document-store";
import { replyToSetting } from "./mailings";
import { MAIL_SENDER } from "./mailing-envelope";
import { HttpError } from "./errors";

export const DIRECTION_COOKIE = "hwd_direction_session";
export function tokenMessage(state: string) {
  return state === "expired" ? "This signing link has expired." : state === "voided" ? "This signing link is no longer valid." : "This signing link has already been used.";
}
export async function findSigningToken(raw: unknown) {
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(410, "This signing link is no longer valid.");
  const [token] = await db.select().from(directionTokens).where(eq(directionTokens.tokenHash, hash(raw)));
  if (!token) throw new HttpError(410, "This signing link is no longer valid.");
  return token;
}
export async function continueSigning(raw: unknown, ip: string, browser: string) {
  const token = await findSigningToken(raw), secret = randomToken();
  await write(`signer:${token.id}`, async (tx, actor) => {
    const state = await tokenState(tx, token);
    if (state !== "ready") throw new HttpError(410, tokenMessage(state));
    await append(tx, actor, directionSessions, { tokenId: token.id, sessionHash: hash(secret), ip, browser: browser.slice(0, 1024),
      expiresAt: new Date(Math.min(Date.now() + 30 * 60000, Date.parse(token.expiresAt))).toISOString() }, "DIRECTION_CONTINUED");
    await append(tx, actor, directionTokenEvents, { tokenId: token.id, kind: "continued", createdBy: actor }, "DIRECTION_LINK_CONSUMED");
  });
  return secret;
}
async function restrictedSession(tx: Tx | typeof db, raw: unknown) {
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(410, "This signing link is no longer valid.");
  const [session] = await tx.select().from(directionSessions).where(eq(directionSessions.sessionHash, hash(raw)));
  if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new HttpError(410, "This signing session has expired. Request a new link.");
  const [token] = await tx.select().from(directionTokens).where(eq(directionTokens.id, session.tokenId));
  const reset = await directionCutoff(tx, token.yearId);
  const events = await tx.select().from(directionTokenEvents).where(eq(directionTokenEvents.tokenId, token.id));
  if (Date.parse(token.expiresAt) <= Date.now() || (reset && token.id <= reset.lastTokenId) || events.some((e) => e.kind === "voided")) throw new HttpError(410, "This signing link is no longer valid.");
  const [template] = await tx.select().from(directionTemplates).where(eq(directionTemplates.id, token.templateId));
  return { session, token, template };
}
export async function signingSessionView(raw: unknown) {
  const { token, template } = await restrictedSession(db, raw);
  const [direction] = await db.select().from(signedDirections).where(eq(signedDirections.tokenId, token.id));
  const [receipt] = direction ? await db.select().from(directionReceipts).where(eq(directionReceipts.directionId, direction.id)).orderBy(desc(directionReceipts.id)).limit(1) : [];
  return { state: direction ? "signed" as const : "ready" as const, ...token.context, amountCents: direction?.amountCents.toString() ?? token.context.suggestedAmountCents,
    templateVersion: template.version, templateText: template.text, consentText: CONSENT_TEXT, signedAt: direction?.evidence?.signedAt,
    receiptResult: receipt?.result };
}
async function storeGeneratedPdf(tx: Tx, actor: string, yearId: number, bytes: Buffer, filename: string) {
  const slot = await yearDocumentStore.requestUpload();
  const response = await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(bytes), redirect: "error" });
  if (!response.ok) throw new HttpError(502, "The signed document could not be stored. No signature was recorded.");
  const upload = await append(tx, actor, yearUploads, { yearId, objectPath: slot.objectPath, filename, contentType: "application/pdf", size: bytes.length, createdBy: actor }, "DIRECTION_DOCUMENT_RESERVED");
  const objectPath = await yearDocumentStore.seal(slot.objectPath, "application/pdf", bytes.length);
  return append(tx, actor, yearDocuments, { yearId, uploadId: upload.id, objectPath, filename, contentType: "application/pdf", size: bytes.length, uploadedBy: actor }, "DIRECTION_DOCUMENT_SEALED");
}
export async function signDocument(raw: unknown, input: unknown, ip: string, browser: string) {
  const data = signatureInput.parse(input);
  if (browser.length > 1024) throw new HttpError(400, "Browser identification is too long");
  const signed = await write("public-signature", async (tx) => {
    const { session, token, template } = await restrictedSession(tx, raw);
    const actor = `signer:${token.id}`;
    const [existing] = await tx.select().from(signedDirections).where(eq(signedDirections.tokenId, token.id));
    if (existing) throw new HttpError(410, "This signing link has already been used.");
    const detail = await yearDetail(tx, token.yearId), holder = detail.holders.find((h) => h.personId === token.personId);
    if (!holder || !detail.declarationDate || holder.nominalCents !== token.context.maxAmountCents ||
        detail.declarationDate !== token.context.boardApprovalDate) throw new HttpError(409, "The distribution changed. Request a new signing link.");
    const amount = assertDirectionAmount(data.amountCents, holder.nominalCents), signedAt = new Date().toISOString();
    const evidence: DirectionEvidence = { typedName: data.fullName, signedAt,
      signedAtNewYork: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }).format(new Date(signedAt)),
      email: token.email, linkId: token.id, continuedAt: session.createdAt, ip, browser,
      templateVersion: template.version, consentText: CONSENT_TEXT, consent: true };
    const text = fillDirection(template.text, { holderName: token.context.holderName, amount: money(amount).slice(1),
      boardApprovalDate: token.context.boardApprovalDate, typedName: data.fullName, date: nyDate(signedAt) });
    const pdfs = await withPdfBrowser(async (pdfBrowser) => {
      const source = await onePagePdf(pdfBrowser, directionPage(text, token.context.isPractice));
      const documentHash = createHash("sha256").update(source).digest("hex");
      const evidenceBytes = await onePagePdf(pdfBrowser, evidencePage([
        ["Typed name", evidence.typedName], ["Signed at (UTC)", signedAt], ["Signed at (America/New_York)", evidence.signedAtNewYork],
        ["Email address the link was sent to", evidence.email], ["Link id", String(token.id)], ["Continue pressed at (UTC)", evidence.continuedAt],
        ["Signer IP", ip], ["Browser string", browser], ["Template version", String(template.version)], ["Document hash (SHA-256)", documentHash],
      ], token.context.isPractice));
      const combined = await PDFDocument.create();
      for (const bytes of [source, evidenceBytes]) {
        const pdf = await PDFDocument.load(bytes);
        for (const page of await combined.copyPages(pdf, pdf.getPageIndices())) combined.addPage(page);
      }
      const final = Buffer.from(await combined.save());
      return { source, documentHash, final, pdfHash: createHash("sha256").update(final).digest("hex") };
    });
    const name = `HWD_${token.context.calendarYear}_${token.context.isPractice ? "Practice_" : ""}Tax_Reinvestment_Link_${token.id}`;
    const sourceDoc = await storeGeneratedPdf(tx, actor, token.yearId, pdfs.source, `${name}_Document.pdf`);
    const finalDoc = await storeGeneratedPdf(tx, actor, token.yearId, pdfs.final, `${name}_Signed.pdf`);
    const direction = await append(tx, actor, signedDirections, { yearId: token.yearId, personId: token.personId, tokenId: token.id, templateId: template.id,
      kind: "electronic", amountCents: amount, receivedDate: nyDate(signedAt), documentId: finalDoc.id, sourceDocumentId: sourceDoc.id,
      documentHash: pdfs.documentHash, pdfHash: pdfs.pdfHash, evidence, createdBy: actor }, "DIRECTION_SIGNED_AWAITING_CONFIRMATION");
    await append(tx, actor, directionTokenEvents, { tokenId: token.id, kind: "spent", createdBy: actor }, "DIRECTION_SIGNATURE_SPENT");
    await append(tx, actor, directionReceipts, { directionId: direction.id, result: "reserved", detail: "Signed PDF receipt reserved; no automatic retry" }, "DIRECTION_RECEIPT_RESERVED");
    return { directionId: direction.id, token, final: pdfs.final, filename: finalDoc.filename };
  });
  // External email cannot participate in PostgreSQL's transaction. The intent is
  // committed above; a definite failure or uncertain outcome is appended, not retried.
  let result = "failed", messageId: string | null = null, detail = "RESEND_API_KEY is unset; the signed document is safely stored.";
  if (process.env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `hwd-direction-receipt-${signed.directionId}` },
        body: JSON.stringify({ from: MAIL_SENDER, to: [signed.token.email], reply_to: await replyToSetting(),
          subject: "Your signed Tax & Reinvestment Document",
          text: `${signed.token.context.isPractice ? "PRACTICE — nothing here is a real distribution\n\n" : ""}Your signed Tax & Reinvestment Document is attached.`,
          attachments: [{ filename: signed.filename, content: signed.final.toString("base64") }] }),
        signal: AbortSignal.timeout(30000), redirect: "error",
      });
      const answer = await response.json().catch(() => null);
      if (response.ok && typeof answer?.id === "string") { result = "sent"; messageId = answer.id; detail = "Accepted by Resend"; }
      else { result = response.status >= 500 || response.ok ? "unknown" : "failed"; detail = `Resend returned HTTP ${response.status}; no automatic retry`; }
    } catch { result = "unknown"; detail = "Receipt outcome is uncertain; check Resend before sending another copy."; }
  }
  await write(`signer:${signed.token.id}`, (tx, actor) => append(tx, actor, directionReceipts, { directionId: signed.directionId, result, messageId, detail }, "DIRECTION_RECEIPT_RESULT"));
  return signingSessionView(raw);
}
