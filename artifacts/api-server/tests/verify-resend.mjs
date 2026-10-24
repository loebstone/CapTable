import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { rosterFixture } from "./roster-fixture.ts";
import { mailingEvents, mailingAttempts, mailingBatches } from "@workspace/db";
import { append, write } from "../src/lib/records.ts";

if (process.env.NODE_ENV === "production") throw new Error("Development only");
const h = await stage2Harness(), { call, expect, record, client } = h;
const originalFetch = globalThis.fetch, captured = [];
const plain = (body) => body.split("\n\nSign your Tax & Reinvestment Document")[0];
const token = (body) => new URL(body.match(/https?:\/\/[^\s]+/)[0]).searchParams.get("token");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const holdings = structuredClone(rosterFixture);
const holder = holdings.holdings.find((p) => p.displayName === "Forster Nancy Anne");
holder.email = "original@example.test";
async function sharedPdf(base, cookie) {
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Shared DEVELOPMENT mailing attachment");
  const bytes = Buffer.from(await pdf.save());
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "Shared_original.pdf", size: bytes.length, contentType: "application/pdf" }), 201);
  const uploaded = await originalFetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
  assert.ok(uploaded.ok);
  const document = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  return { document, bytes };
}
try {
  record("Environment", (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0]);
  h.setHoldings(holdings);
  const real = await finalizedFixture(h), { base, cookie } = real;
  expect(await call("post", `${base}/finalize`, cookie, {}), 201);
  const shared = await sharedPdf(base, cookie);
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      captured.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: `resend-mock-${captured.length}` }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  process.env.RESEND_API_KEY = "mock-resend-no-real-email";
  const draft = { subject: "Original uniform subject", body: "Please review the attached documents.", documentIds: [shared.document.id],
    attachment: "notice", choices: {}, includeSigningLink: false };
  expect(await call("post", `${base}/mailing`, cookie, draft), 200);
  expect(await call("post", `${base}/directions/resend`, cookie, { personId: holder.personId }), 409);
  const mailing = expect(await call("get", `${base}/mailing`, cookie), 200);
  expect(await call("post", `${base}/mailing/send`, cookie, { kind: "send", draftId: mailing.draftId }), 200);
  assert.equal(captured.length, 1);
  const original = captured[0];
  expect(await call("post", `${base}/directions/issue`, cookie, { personId: holder.personId }), 200);
  const oldToken = token(captured.at(-1).text);
  // Simulated delivery, no provider webhook or production request.
  await write(real.detail.holders[0].personId, (tx, actor) => append(tx, actor, mailingEvents,
    { webhookId: "resend-test-delivered", messageId: "resend-mock-1", event: "email.delivered", occurredAt: new Date().toISOString() }, "TEST_DELIVERY"));
  assert.equal(expect(await call("get", `${base}/mailing`, cookie), 200).recipients.find((r) => r.personId === holder.personId).status, "Delivered");

  const corrected = structuredClone(holdings);
  Object.assign(corrected.holdings.find((p) => p.personId === holder.personId), { email: "corrected@example.test", shares: "19.9999" });
  corrected.holdings.push({ ...holder, personId: "new-contact-test", displayName: "New contact STUB", addressState: "GA", shares: "0.0001" });
  corrected.classes.find((c) => c.shareClass === holder.shareClass).holderCount++;
  h.setHoldings(corrected); // Deliberately NO holdings/fetch call: resend refreshes it.
  expect(await call("post", `${base}/directions/resend`, cookie, { personId: holder.personId }), 200);
  const resent = captured.at(-1);
  assert.deepEqual(resent.to, ["corrected@example.test"]);
  const proposed = (await client.query("SELECT state_code,confirmed FROM tax_residences WHERE person_id='new-contact-test'")).rows[0];
  assert.equal(proposed.state_code, "GA"); assert.equal(proposed.confirmed, false);
  assert.equal(resent.subject, original.subject); assert.equal(plain(resent.text), plain(original.text));
  assert.equal(resent.reply_to, original.reply_to);
  assert.equal(resent.attachments.length, 2);
  assert.equal(resent.attachments[0].content, original.attachments[0].content);
  assert.equal(sha(Buffer.from(resent.attachments[0].content, "base64")), sha(shared.bytes));
  assert.match(resent.attachments[1].filename, /Notice_/);
  assert.ok(token(resent.text) !== oldToken);
  expect(await call("get", `/api/signing/open?token=${oldToken}`), 410);
  expect(await call("get", `/api/signing/open?token=${token(resent.text)}`), 200);
  let view = expect(await call("get", `${base}/directions`, cookie), 200);
  assert.equal(view.rows.find((r) => r.personId === holder.personId).resendCount, 1);
  const log = (await client.query("SELECT a.*, b.kind, b.draft_id FROM mailing_attempts a JOIN mailing_batches b ON b.id=a.batch_id WHERE b.year_id=$1 AND b.kind='resend'", [real.detail.id])).rows;
  assert.equal(log.length, 1); assert.equal(log[0].draft_id, mailing.draftId);
  assert.equal(log[0].recipient_email, "corrected@example.test"); assert.equal(log[0].attachments.length, 2);
  assert.equal(log[0].attachments[1].sha256, sha(Buffer.from(resent.attachments[1].content, "base64")));
  assert.ok(log[0].signing_token_id); assert.equal(log[0].subject, null); assert.equal(log[0].body, null);
  expect(await call("post", `${base}/directions/resend`, cookie, { personId: holder.personId }), 200);
  view = expect(await call("get", `${base}/directions`, cookie), 200);
  assert.equal(view.rows.find((r) => r.personId === holder.personId).resendCount, 2);
  expect(await call("get", `/api/signing/open?token=${token(resent.text)}`), 410);
  record("Full envelope resend", { deliveredHolderEligible: true, currentRosterAddress: "corrected@example.test", originalUniformText: true,
    sharedAttachmentByteMatch: true, regeneratedNoticeHashMatchesLog: true, oldLinksVoided: true, resendCount: 2, bodyStoredOnce: true });

  expect(await call("post", `${base}/directions/issue`, cookie, { personId: holder.personId }), 200);
  assert.equal(captured.at(-1).attachments?.length ?? 0, 0);
  expect(await call("post", `${base}/directions/remind`, cookie), 200);
  assert.equal(captured.at(-1).attachments?.length ?? 0, 0);
  assert.equal(expect(await call("get", `${base}/directions`, cookie), 200).rows.find((r) => r.personId === holder.personId).resendCount, 2);
  expect(await call("post", `${base}/directions/resend`, null, { personId: holder.personId }), 401);
  expect(await request(h.app).post(`${base}/directions/resend`).set("Cookie", cookie).set("Origin", "https://wrong.example.test").send({ personId: holder.personId }), 403);
  const noEmail = structuredClone(holdings); noEmail.holdings.find((p) => p.personId === holder.personId).email = null; h.setHoldings(noEmail);
  const beforeRefused = captured.length;
  expect(await call("post", `${base}/directions/resend`, cookie, { personId: holder.personId }), 400);
  assert.equal(captured.length, beforeRefused);
  h.setHoldings(corrected);
  await write(real.detail.holders[0].personId, async (tx, actor) => {
    const batch = await append(tx, actor, mailingBatches, { yearId: real.detail.id, draftId: mailing.draftId, kind: "resend", createdBy: actor }, "TEST_PENDING_RESEND");
    await append(tx, actor, mailingAttempts, { batchId: batch.id, personId: holder.personId, to: "corrected@example.test", replyTo: original.reply_to,
      attachments: [], createdBy: actor }, "TEST_PENDING_ENVELOPE");
  });
  expect(await call("post", `${base}/directions/resend`, cookie, { personId: holder.personId }), 409);
  assert.equal(captured.length, beforeRefused);
  record("Separate link actions / safety", { reissueAndReminder: "link only; resend count unchanged", unauthenticated: 401, crossOrigin: 403, missingCurrentEmail: 400,
    unfinishedReservation: 409, originalMailingWithoutSigningLink: "resend adds fresh link" });

  delete process.env.RESEND_API_KEY; h.setHoldings(holdings);
  const practice = await finalizedFixture(h, { isPractice: true }), pbase = practice.base;
  process.env.RESEND_API_KEY = "mock-resend-no-real-email";
  const pshared = await sharedPdf(pbase, practice.cookie);
  const pdraft = { ...draft, documentIds: [pshared.document.id], attachment: "statement", includeSigningLink: true };
  expect(await call("post", `${pbase}/mailing`, practice.cookie, pdraft), 200);
  const pm = expect(await call("get", `${pbase}/mailing`, practice.cookie), 200);
  expect(await call("post", `${pbase}/mailing/send`, practice.cookie, { kind: "preview", draftId: pm.draftId, personId: holder.personId }), 200);
  const preview = captured.at(-1);
  expect(await call("post", `${pbase}/mailing`, practice.cookie, { ...pdraft, subject: "Changed unsent draft", body: "Not the original body", documentIds: [] }), 200);
  expect(await call("post", `${pbase}/directions/resend`, practice.cookie, { personId: holder.personId }), 200);
  const selfResend = captured.at(-1);
  assert.deepEqual(selfResend.to, ["bootstrap@example.test"]);
  assert.equal(selfResend.subject, preview.subject); assert.equal(plain(selfResend.text), plain(preview.text));
  assert.equal(selfResend.attachments[0].content, preview.attachments[0].content);
  assert.equal(selfResend.attachments.length, 2); assert.match(selfResend.text, /PRACTICE/);
  assert.match(selfResend.attachments[1].filename, /Notice_/);
  assert.ok(token(selfResend.text) !== token(preview.text));
  expect(await call("get", `/api/signing/open?token=${token(preview.text)}`), 410);
  const refusalStart = captured.length;
  expect(await call("post", `${pbase}/directions/resend`, practice.cookie, { personId: holder.personId, to: "original@example.test" }), 400);
  expect(await call("post", `${pbase}/mailing/send`, practice.cookie, { kind: "resend", draftId: pm.draftId, personId: holder.personId }), 403);
  assert.equal(captured.length, refusalStart);
  assert.equal(expect(await call("get", `${pbase}/mailing`, practice.cookie), 200).status, "draft");
  expect(await call("post", `${pbase}/mailing`, practice.cookie, pdraft), 200); // Practice resend does not lock drafts.
  assert.equal(expect(await call("get", `${pbase}/directions`, practice.cookie), 200).rows.find((r) => r.personId === holder.personId).resendCount, 1);
  const audits = (await client.query("SELECT operation,count(*)::int FROM audit_log WHERE operation IN ('MAILING_PERSON_RESEND','MAILING_ENVELOPE_RESERVED','MAILING_SEND_RESULT','MAILING_RESEND_ROSTER_REFRESH') GROUP BY operation")).rows;
  assert.equal(audits.find((r) => r.operation === "MAILING_PERSON_RESEND").count, 3);
  record("Practice / original source / audit", { recipient: "bootstrap@example.test ONLY (MOCK)", originalPreviewNotChangedDraft: true,
    noticeAndSharedPdf: true, banner: true, recipientOverrideRejected: 400, shareholderResendRefused: 403, practiceRemainsDraft: true, practiceResendCount: 1, audits });
  expect(await call("post", `${pbase}/reset-practice`, practice.cookie, { confirmation: "RESET" }), 200);
} finally {
  globalThis.fetch = originalFetch;
  await h.finish();
}
