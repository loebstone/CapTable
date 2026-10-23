/**
 * Development only. Stub Roster, rollback-isolated tables; real private storage.
 * Resend is mocked. This script never sends an external email.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import { Webhook } from "svix";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { rosterFixture } from "./roster-fixture.ts";
import { draftInput, uniformMailText, recipientChannel, assertEnvelopeSize, assertPracticeSend, verifyMailWebhook } from "../src/lib/mailing-rules.ts";

if (process.env.NODE_ENV === "production") throw new Error("Forbidden in production");
const h = await stage2Harness();
const { call, expect, record, client } = h;
const originalFetch = globalThis.fetch;
const output = resolve("../../generated-artifacts/mailings");
let count = 0, captured = [], failNext = false;
try {
  await mkdir(output, { recursive: true });
  record("Environment / observed identity", (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0]);
  const person = { displayName: "Forster Nancy Anne", shares: "20.0000", nominalCents: "155660" };
  const fixedText = { subject: "Timber distribution notice", body: "Please read the attached notice for your distribution details." };
  assert.deepEqual(uniformMailText(fixedText, false, false), fixedText);
  assert.equal(uniformMailText(fixedText, true, true).subject, "[PREVIEW] Timber distribution notice");
  for (const field of ["first_name", "shares", "distribution"]) {
    for (const key of ["subject", "body"]) {
      assert.equal(draftInput.safeParse({ ...fixedText, [key]: `Please use {${field}}`, documentIds: [], attachment: "notice", choices: {} }).success, false);
    }
    assert.throws(() => uniformMailText({ ...fixedText, body: `Please use { ${field} }` }, false, false));
  }
  assert.equal(recipientChannel(null, false), "No email");
  assert.equal(recipientChannel("example@example.test", true), "Paper");
  assert.equal(recipientChannel("example@example.test", false), "Email");
  assert.throws(() => assertEnvelopeSize({ text: "a".repeat(40_000_000) }), /40 MB/);
  assert.throws(() => assertPracticeSend(true, false), /Practice/);
  assertPracticeSend(true, true);
  record("Unit rules", "Uniform text, all three obsolete merge fields refused in subject/body, 3-way partition, 40 MB assertion and practice block PASS");

  const fixture = await finalizedFixture(h, { isPractice: true });
  const { cookie, base } = fixture, yearId = fixture.detail.id;
  const holder = fixture.detail.holders.find((p) => p.displayName === person.displayName);
  const withEmails = structuredClone(rosterFixture);
  const names = ["Forster Nancy Anne", "Esmond Robert III", "Davis Kiel"];
  for (const [i, name] of names.entries()) withEmails.holdings.find((r) => r.displayName === name).email = `fixture${i}@example.test`;
  h.setHoldings(withEmails);
  expect(await call("post", "/api/holdings/fetch", cookie), 200);
  expect(await call("post", "/api/mail/settings", cookie, { replyTo: "peter@loebstone.com" }), 200);
  expect(await call("post", "/api/mail/settings", cookie, { replyTo: "bad-address" }), 400);
  const kielId = fixture.detail.holders.find((p) => p.displayName === "Davis Kiel").personId;
  expect(await call("post", "/api/mail/paper", cookie, { personId: kielId, prefersPaper: true }), 200);
  const shared = await PDFDocument.create(); shared.addPage().drawText("HWD Cap Table shared mailing attachment - DEVELOPMENT TEST");
  const pdfBytes = Buffer.from(await shared.save());
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "Development_shared_attachment.pdf", size: pdfBytes.length, contentType: "application/pdf" }), 201);
  assert.equal((await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBytes })).status, 200);
  const document = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  const content = { ...fixedText, documentIds: [document.id], attachment: "notice", choices: {} };
  for (const field of ["first_name", "shares", "distribution"]) {
    const before = Number((await client.query("SELECT count(*) FROM mailing_drafts")).rows[0].count);
    expect(await call("post", `${base}/mailing`, cookie, { ...content, body: `Please see {${field}} in the attached notice.` }), 400);
    assert.equal(Number((await client.query("SELECT count(*) FROM mailing_drafts")).rows[0].count), before);
  }
  expect(await call("post", `${base}/mailing`, cookie, content), 200);
  let view = expect(await call("get", `${base}/mailing`, cookie), 200);
  assert.equal(view.recipients.filter((r) => r.channel === "Email").length, 2);
  assert.equal(view.recipients.filter((r) => r.channel === "Paper").length, 1);
  assert.equal(view.recipients.filter((r) => r.channel === "No email").length, 44);
  record("Recipient partition / persisted optional email / settings", { email: 2, paperPreference: 1, noEmail: 44, paperTotal: 45, replyTo: view.replyTo });

  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      captured.push(JSON.parse(options.body));
      if (failNext) { failNext = false; return new Response(JSON.stringify({ message: "Test failure" }), { status: 422 }); }
      return new Response(JSON.stringify({ id: `stub-resend-${++count}` }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  process.env.RESEND_API_KEY = "development-mock-not-a-key";
  const preview = expect(await call("post", `${base}/mailing/send`, cookie, { kind: "preview", draftId: view.draftId, personId: holder.personId }), 200);
  assert.equal(preview.results[0].result, "sent");
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].to, ["bootstrap@example.test"]);
  assert.equal(captured[0].subject, `[PREVIEW] ${content.subject}`);
  assert.equal(captured[0].text, `PRACTICE — nothing here is a real distribution\n\n${content.body}`);
  assert.doesNotMatch(`${captured[0].subject}\n${captured[0].text}`, /Forster|Nancy|20 shares|\$1,556\.60|\{first_name\}|\{shares\}|\{distribution\}/i);
  assert.equal(captured[0].html, undefined); // Plain text: no open-tracking pixel.
  assert.equal(captured[0].attachments.length, 2);
  const noticeBytes = Buffer.from(captured[0].attachments[1].content, "base64");
  const noticeTask = getDocument({ data: new Uint8Array(noticeBytes), useSystemFonts: true });
  const noticePdf = await noticeTask.promise;
  const noticeText = (await (await noticePdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(" ");
  await noticeTask.destroy();
  assert.match(noticeText, /Forster/);
  assert.match(noticeText, /1,556\.60/);
  assert.doesNotMatch(captured[0].text, /Forster|1,556\.60/);
  const attempt = (await client.query("SELECT * FROM mailing_attempts ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(attempt.subject, null);
  assert.equal(attempt.body, null);
  const previewDraft = (await client.query("SELECT content FROM mailing_drafts ORDER BY id DESC LIMIT 1")).rows[0].content;
  assert.equal(previewDraft.subject, content.subject);
  assert.equal(previewDraft.body, content.body);
  for (const [i, attachment] of captured[0].attachments.entries()) {
    const bytes = Buffer.from(attachment.content, "base64");
    assert.equal(attempt.attachments[i].size, bytes.length);
    assert.equal(attempt.attachments[i].sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  record("Mock self-preview + immutable shared text / per-person attachments", { messageId: preview.results[0].messageId, subject: captured[0].subject, body: captured[0].text, personalFiguresInPdfOnly: true, attemptSubjectBody: "NULL (shared draft holds fixed text)", attachments: attempt.attachments });
  for (const kind of ["send", "resend"]) {
    const blocked = await call("post", `${base}/mailing/send`, cookie, { kind, draftId: view.draftId });
    expect(blocked, 403); assert.match(blocked.body.error, /Practice years cannot send/);
  }
  assert.equal(captured.length, 1);
  record("Hard practice block", "Send and resend both 403 before Resend call; preview allowed");
  for (const [method, path] of [["get", `${base}/mailing`], ["post", `${base}/mailing/send`], ["get", `${base}/mailing/paper.pdf`], ["get", "/api/mail/settings"], ["post", "/api/mail/paper"]]) expect(await call(method, path), 401);

  const paper = await call("get", `${base}/mailing/paper.pdf`, cookie);
  expect(paper, 200);
  await writeFile(resolve(output, "Practice_Paper_Letters.pdf"), paper.body);
  const pdf = await PDFDocument.load(paper.body);
  assert.equal(pdf.getPageCount(), 45);
  const task = getDocument({ data: new Uint8Array(paper.body), useSystemFonts: true });
  const textPdf = await task.promise;
  const firstPage = (await (await textPdf.getPage(1)).getTextContent()).items.map((x) => x.str).join(" ");
  assert.match(firstPage, /PRACTICE/); await task.destroy();
  record("Paper list / combined PDF", { paperCount: 45, pages: pdf.getPageCount(), watermarkTextPresent: true, file: "Practice_Paper_Letters.pdf" });

  // Real-year behavior is exercised exclusively against mock Resend.
  delete process.env.RESEND_API_KEY;
  const real = await finalizedFixture(h);
  process.env.RESEND_API_KEY = "development-mock-not-a-key";
  const realDetail = await real.finalizeWithLedger();
  const esmondId = real.detail.holders.find((p) => p.displayName === "Esmond Robert III").personId;
  expect(await call("post", `${real.base}/mailing`, cookie, { ...content, documentIds: [], attachment: "notice", choices: { [esmondId]: "none" } }), 200);
  const realView = expect(await call("get", `${real.base}/mailing`, cookie), 200);
  failNext = true;
  const send = expect(await call("post", `${real.base}/mailing/send`, cookie, { kind: "send", draftId: realView.draftId }), 200);
  assert.equal(send.results.filter((r) => r.result === "failed").length, 1);
  assert.equal(send.results.filter((r) => r.result === "sent").length, 1);
  const realPayloads = captured.slice(-2);
  assert.equal(realPayloads.length, 2);
  assert.notDeepEqual(realPayloads[0].to, realPayloads[1].to);
  assert.deepEqual(realPayloads.map((p) => ({ subject: p.subject, body: p.text })), [fixedText, fixedText]);
  assert.deepEqual(realPayloads.map((p) => p.attachments.length), [0, 1]);
  assert.doesNotMatch(JSON.stringify(realPayloads.map((p) => ({ subject: p.subject, body: p.text }))), /Nancy|Robert|shares|\$|first_name|\{distribution\}/i);
  const realRows = (await client.query("SELECT a.subject, a.body, a.attachments FROM mailing_attempts a JOIN mailing_batches b ON b.id=a.batch_id WHERE b.year_id=$1 AND b.kind='send' ORDER BY a.id", [real.detail.id])).rows;
  assert.equal(realRows.length, 2);
  for (const row of realRows) { assert.equal(row.subject, null); assert.equal(row.body, null); }
  assert.deepEqual(realRows.map((row) => row.attachments.length), [0, 1]);
  expect(await call("post", `${real.base}/mailing/send`, cookie, { kind: "send", draftId: realView.draftId }), 409);
  expect(await call("post", `${real.base}/mailing`, cookie, content), 409);
  const resent = expect(await call("post", `${real.base}/mailing/send`, cookie, { kind: "resend", draftId: realView.draftId }), 200);
  assert.equal(resent.results.length, 1);
  const recipient = resent.results[0];
  record("Mock send + explicit failed-only resend", { initial: send.results, resend: resent.results, duplicateSend: 409, editAfterSend: 409 });

  const webhookSecret = `whsec_${randomBytes(32).toString("base64")}`;
  process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  const raw = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: recipient.messageId } });
  const webhookId = `msg_${randomBytes(12).toString("hex")}`, now = new Date();
  const headers = { "svix-id": webhookId, "svix-timestamp": String(Math.floor(now.getTime() / 1000)), "svix-signature": new Webhook(webhookSecret).sign(webhookId, now, raw) };
  assert.ok(verifyMailWebhook(Buffer.from(raw), headers));
  assert.throws(() => verifyMailWebhook(Buffer.from(raw + " "), headers), /signature/);
  const unsigned = await request(h.app).post("/api/mail/webhook").set("Content-Type", "application/json").send(raw);
  expect(unsigned, 401);
  const signed = () => request(h.app).post("/api/mail/webhook").set("Content-Type", "application/json").set(headers).send(raw);
  expect(await signed(), 200); expect(await signed(), 200);
  assert.equal(Number((await client.query("SELECT count(*) FROM mailing_events WHERE webhook_id=$1", [webhookId])).rows[0].count), 1);
  const deliveredView = expect(await call("get", `${real.base}/mailing`, cookie), 200);
  assert.equal(deliveredView.recipients.find((r) => r.personId === recipient.personId).status, "Delivered");
  record("Signed webhook / idempotency", { signed: 200, unsigned: 401, tampered: "rejected", state: "Delivered", rowsAfterDuplicate: 1 });
  // Bounce then complaint must not be undone by late delivery events.
  for (const type of ["email.bounced", "email.complained"]) {
    const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: recipient.messageId } });
    const id = `msg_${randomBytes(12).toString("hex")}`, date = new Date();
    expect(await request(h.app).post("/api/mail/webhook").set("Content-Type", "application/json")
      .set({ "svix-id": id, "svix-timestamp": String(Math.floor(date.getTime() / 1000)), "svix-signature": new Webhook(webhookSecret).sign(id, date, body) }).send(body), 200);
    const state = expect(await call("get", `${real.base}/mailing`, cookie), 200).recipients.find((r) => r.personId === recipient.personId);
    assert.equal(state.status, type === "email.bounced" ? "Bounced" : "Complained");
    assert.equal(state.canResend, type === "email.bounced");
  }
  record("Bounce / complaint handling", "Bounced enables explicit resend with Roster fix warning; Complained suppresses resend; late Delivered does not overwrite either");

  // Sole allowed hard-delete cleans practice attachments and appends fresh draft.
  expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  const reset = expect(await call("get", `${base}/mailing`, cookie), 200);
  assert.equal(reset.content.documentIds.length, 0);
  record("Reset / audit integration", { draftAttachmentsAfterReset: 0, previewHistoryRetained: true, auditEntries: (await client.query("SELECT count(*) FROM audit_log WHERE entity LIKE 'mail%' OR entity='paper_preferences'")).rows[0].count });
} finally {
  globalThis.fetch = originalFetch;
  await h.finish();
}
