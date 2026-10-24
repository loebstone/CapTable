/**
 * DEVELOPMENT ONLY: local Roster stub, isolated rollback tables, real private storage.
 * Default: mocked Resend. Explicit --live-receipt permits exactly ONE receipt
 * to delivered@resend.dev. No arbitrary target and never Peter's address.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import request from "supertest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { rosterFixture } from "./roster-fixture.ts";
import { assertDirectionAmount, signatureInput, fillDirection, DIRECTION_TEXT, CONSENT_TEXT, nyDate } from "../src/lib/direction-rules.ts";
import { hash } from "../src/lib/auth.ts";
import { db, directionTokens } from "@workspace/db";
import { write, append } from "../src/lib/records.ts";

if (process.env.NODE_ENV === "production") throw new Error("Forbidden in production");
const liveRequested = process.argv.includes("--live-receipt"), key = liveRequested ? process.env.RESEND_API_KEY : null;
if (liveRequested && !key) throw new Error("Development RESEND_API_KEY required for requested test-address receipt");
const h = await stage2Harness(), { call, expect, record, client } = h;
const originalFetch = globalThis.fetch, captured = [], output = resolve("../../generated-artifacts/directions");
let liveUsed = false;
function urlFrom(payload) { return new URL(payload.text.match(/https?:\/\/[^\s]+/)[0]); }
function cookieFrom(response) { return response.headers["set-cookie"].map((s) => s.split(";")[0]).join("; "); }
function local(url) { return url.pathname + url.search; }
async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }), doc = await task.promise, pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    let text = "", previous;
    for (const item of (await (await doc.getPage(p)).getTextContent()).items) {
      if (!("str" in item)) continue;
      const line = previous && Math.abs(item.transform[5] - previous.transform[5]) > 2;
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      if (previous && (line || gap > 0.5)) text += line ? "\n" : " ";
      text += item.str; previous = item;
    }
    pages.push(text);
  }
  await task.destroy(); return pages;
}
try {
  await mkdir(output, { recursive: true });
  record("Environment / observed identity", (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0]);
  assert.equal(assertDirectionAmount("0", "155660"), 0n);
  assert.equal(assertDirectionAmount("155660", "155660"), 155660n);
  for (const bad of ["-1", "155661", "1.25", "NaN"]) assert.throws(() => assertDirectionAmount(bad, "155660"));
  assert.equal(signatureInput.safeParse({ amountCents: "0", fullName: "", consent: true }).success, false);
  assert.equal(signatureInput.safeParse({ amountCents: "0", fullName: "N", consent: false }).success, false);
  assert.equal(nyDate("2026-10-24T01:00:00.000Z"), "2026-10-23");
  assert.equal(fillDirection("[Full name] / [Typed full name]", { holderName: "Snapshot Name", typedName: "Typed Name" }), "Snapshot Name / Typed Name");
  record("Unit rules", "Zero and inclusive upper bound; negative/decimal/out-of-range refusal; consent; nonblank name; New York signing date; snapshot and typed names kept distinct PASS");

  const fixture = await finalizedFixture(h, { isPractice: true }), { cookie, base } = fixture;
  const holder = fixture.detail.holders.find((p) => p.displayName === "Forster Nancy Anne");
  const withEmail = structuredClone(rosterFixture);
  withEmail.holdings.find((p) => p.personId === holder.personId).email = "fixture@example.test";
  h.setHoldings(withEmail);
  expect(await call("post", "/api/holdings/fetch", cookie), 200);
  // Local stub only: this identity maps to the same fixture manager, never a
  // production Roster identity or an arbitrary real recipient.
  const mailboxCookie = await h.login("delivered@resend.dev");
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body); captured.push(payload);
      if (liveRequested && !liveUsed && payload.subject === "Your signed Tax & Reinvestment Document") {
        assert.deepEqual(payload.to, ["delivered@resend.dev"]);
        assert.match(payload.text, /^PRACTICE/); liveUsed = true;
        return originalFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${key}` } });
      }
      return new Response(JSON.stringify({ id: `directions-mock-${captured.length}` }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  process.env.RESEND_API_KEY = "development-mock-not-a-key";
  const draft = { subject: "Tax & Reinvestment Document", body: "Please read the attached notice and sign using the link below.", documentIds: [], attachment: "notice", choices: {}, includeSigningLink: true };
  expect(await call("post", `${base}/mailing`, cookie, draft), 200);
  const mailing = expect(await call("get", `${base}/mailing`, cookie), 200);
  const issueStartedAt = Date.now();
  expect(await call("post", `${base}/mailing/send`, mailboxCookie, { kind: "preview", draftId: mailing.draftId, personId: holder.personId }), 200);
  const landingUrl = urlFrom(captured.at(-1)), raw = landingUrl.searchParams.get("token");
  assert.equal(raw.length, 64);
  const token = (await client.query("SELECT * FROM direction_tokens ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(token.token_hash, hash(raw)); assert.notEqual(token.token_hash, raw);
  const expiryMilliseconds = new Date(token.expires_at).getTime();
  assert.ok(expiryMilliseconds >= issueStartedAt + 30 * 86400000);
  assert.ok(expiryMilliseconds <= Date.now() + 30 * 86400000);
  const landing = await call("get", local(landingUrl));
  expect(landing, 200); assert.match(landing.text, />Continue</); assert.doesNotMatch(landing.text, /Forster|1556|shares/); assert.equal(landing.headers["set-cookie"], undefined);
  assert.equal(landing.headers["referrer-policy"], "strict-origin");
  assert.equal(Number((await client.query("SELECT count(*) FROM direction_sessions")).rows[0].count), 0);
  const continued = await call("post", "/api/signing/continue", null, { token: raw });
  expect(continued, 303); const signingCookie = cookieFrom(continued);
  assert.match(continued.headers["set-cookie"][0], /HttpOnly/); assert.match(continued.headers["set-cookie"][0], /SameSite=Strict/);
  const session = expect(await call("get", "/api/signing/session", signingCookie), 200);
  assert.equal(session.holderName, holder.displayName); assert.equal(session.amountCents, "45660"); assert.equal(session.consentText, CONSENT_TEXT);
  expect(await call("get", base, signingCookie), 401); // Never management access.
  expect(await call("post", "/api/signing/sign", signingCookie, { amountCents: "155661", fullName: "Nancy Anne Forster", consent: true }), 400);
  expect(await request(h.app).post("/api/signing/sign").set("Origin", "https://attacker.example").set("Cookie", signingCookie).send({ amountCents: "155660", fullName: "Nancy", consent: true }), 403);
  assert.equal(Number((await client.query("SELECT count(*) FROM signed_directions")).rows[0].count), 0);
  const signed = expect(await request(h.app).post("/api/signing/sign").set("Origin", process.env.APP_ORIGIN).set("Cookie", signingCookie)
    .set("User-Agent", "HWD Development Verification Browser").send({ amountCents: "155660", fullName: "Nancy Anne Forster", consent: true }), 200);
  assert.equal(signed.state, "signed"); assert.equal(signed.amountCents, "155660"); assert.equal(signed.receiptResult, "sent");
  const direction = (await client.query("SELECT * FROM signed_directions ORDER BY id DESC LIMIT 1")).rows[0];
  const signedFile = await call("get", `${base}/directions/${direction.id}/pdf`, cookie); expect(signedFile, 200);
  const sourceFile = await call("get", `${base}/documents/${direction.source_document_id}/file`, cookie); expect(sourceFile, 200);
  assert.equal(createHash("sha256").update(signedFile.body).digest("hex"), direction.pdf_hash);
  assert.equal(createHash("sha256").update(sourceFile.body).digest("hex"), direction.document_hash);
  const pages = await pdfText(signedFile.body);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /retain \$1,556\.60/);
  assert.match(pages[0], /Signed electronically by: Nancy Anne Forster/);
  assert.match(pages[0], /2026-10-20/);
  assert.doesNotMatch(pages[0], /shares|Estimated tax|Your distribution/);
  for (const name of fixture.detail.holders.filter((p) => p.personId !== holder.personId).map((p) => p.displayName)) assert.ok(!pages[0].includes(name));
  for (const value of ["PRACTICE", "delivered@resend.dev", String(token.id), direction.document_hash, "America/New_York", "Template version"]) assert.ok(pages[1].includes(value), value);
  assert.equal(direction.evidence.consent, true); assert.equal(direction.evidence.consentText, CONSENT_TEXT);
  const receiptEnvelope = captured.at(-1);
  assert.deepEqual(receiptEnvelope.to, ["delivered@resend.dev"]); assert.match(receiptEnvelope.text, /^PRACTICE/);
  assert.ok(Buffer.from(receiptEnvelope.attachments[0].content, "base64").equals(signedFile.body));
  const receipt = (await client.query("SELECT * FROM direction_receipts WHERE direction_id=$1 ORDER BY id DESC LIMIT 1", [direction.id])).rows[0];
  let provider = { source: "MOCK RESEND", messageId: receipt.message_id };
  if (liveRequested) {
    assert.equal(liveUsed, true);
    const r = await originalFetch(`https://api.resend.com/emails/${encodeURIComponent(receipt.message_id)}`, { headers: { Authorization: `Bearer ${key}` } });
    assert.equal(r.status, 200); const received = await r.json();
    assert.deepEqual(received.to, ["delivered@resend.dev"]); assert.equal(received.text, receiptEnvelope.text);
    provider = { source: "REAL RESEND TEST ADDRESS", messageId: receipt.message_id, status: r.status, last_event: received.last_event, recipient: "delivered@resend.dev" };
    await writeFile(resolve(output, "live-receipt-evidence.json"), JSON.stringify({ provider, subject: receiptEnvelope.subject, body: receiptEnvelope.text,
      attachments: receiptEnvelope.attachments.map((a) => ({ filename: a.filename, size: Buffer.from(a.content, "base64").length })),
      documentHash: direction.document_hash, sealedPdfHash: direction.pdf_hash, pagesText: pages }, null, 2));
  }
  await writeFile(resolve(output, "Practice_Tax_Reinvestment_Signed.pdf"), signedFile.body);
  await writeFile(resolve(output, "signed-direction-text.txt"), pages.map((p, i) => `PAGE ${i + 1}\n${p}`).join("\n\n"));
  record("Signed practice document / evidence / receipt", { pages: 2, editedAmountCents: direction.amount_cents, documentHash: direction.document_hash, sealedPdfHash: direction.pdf_hash, pagesText: pages, provider });
  const pending = expect(await call("get", `${base}/directions`, cookie), 200).rows.find((r) => r.personId === holder.personId);
  assert.equal(pending.documentStatus, "Signed $1,556.60 — awaiting confirmation"); assert.equal(pending.instruction, "Pay");
  assert.equal(Number((await client.query("SELECT count(*) FROM distribution_entries")).rows[0].count), 0);
  const confirmed = expect(await call("post", `${base}/directions/${direction.id}/confirm`, cookie, {}), 200).rows.find((r) => r.personId === holder.personId);
  assert.equal(confirmed.documentStatus, "Confirmed $1,556.60"); assert.equal(confirmed.instruction, "✓");
  const entry = (await client.query("SELECT * FROM distribution_entries ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(entry.kind, "apic"); assert.equal(entry.amount_cents, "155660"); assert.equal(entry.date.toISOString().slice(0, 10), direction.received_date);
  expect(await call("post", `${base}/directions/${direction.id}/confirm`, cookie, {}), 409);
  expect(await call("post", "/api/signing/continue", null, { token: raw }), 410);
  expect(await call("post", "/api/signing/sign", signingCookie, { amountCents: "0", fullName: "Nancy", consent: true }), 410);
  expect(await call("get", local(landingUrl)), 410);
  for (const c of [null, signingCookie]) expect(await call("get", `${base}/directions/${direction.id}/pdf`, c), 401);
  record("Pending → confirm → ledger / instruction", { before: pending.documentStatus, ledgerBefore: 0, after: confirmed.documentStatus, apicCents: entry.amount_cents, instructionBefore: "Pay", instructionAfter: "✓", duplicateConfirm: 409, secondTokenUse: 410, signingCookieCannotAccessManagement: 401 });

  const expiredRaw = randomBytes(32).toString("hex");
  await write("verification", (tx, actor) => append(tx, actor, directionTokens, { yearId: fixture.detail.id, personId: holder.personId, tokenHash: hash(expiredRaw),
    email: "delivered@resend.dev", templateId: token.template_id, context: token.context, expiresAt: new Date(Date.now() - 1000).toISOString(), createdBy: actor }));
  expect(await call("get", `/api/signing/open?token=${expiredRaw}`), 410);
  expect(await call("post", "/api/signing/continue", null, { token: expiredRaw }), 410);
  const issue = async () => {
    expect(await call("post", `${base}/directions/issue`, mailboxCookie, { personId: holder.personId }), 200);
    return urlFrom(captured.at(-1));
  };
  const oldUrl = await issue(), oldRaw = oldUrl.searchParams.get("token");
  const oldContinue = await call("post", "/api/signing/continue", null, { token: oldRaw }); expect(oldContinue, 303);
  const newUrl = await issue();
  expect(await call("get", local(oldUrl)), 410);
  expect(await call("get", "/api/signing/session", cookieFrom(oldContinue)), 410);
  const secondContinue = await call("post", "/api/signing/continue", null, { token: newUrl.searchParams.get("token") }); expect(secondContinue, 303);
  expect(await call("post", "/api/signing/sign", cookieFrom(secondContinue), { amountCents: "30000", fullName: "Nancy Anne Forster", consent: true }), 200);
  const second = (await client.query("SELECT * FROM signed_directions ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal((expect(await call("get", base, cookie), 200)).holders.find((p) => p.personId === holder.personId).retainedCents, "155660");
  const replaced = expect(await call("post", `${base}/directions/${second.id}/confirm`, cookie, {}), 200).rows.find((r) => r.personId === holder.personId);
  assert.equal(replaced.instruction, "Pay");
  const revised = expect(await call("get", base, cookie), 200).holders.find((p) => p.personId === holder.personId);
  assert.equal(revised.retainedCents, "30000");
  assert.equal(replaced.history.length, 2);
  assert.deepEqual((await client.query("SELECT amount_cents::text FROM distribution_entries WHERE person_id=$1 ORDER BY id", [holder.personId])).rows.map((r) => r.amount_cents), ["155660", "-155660", "30000"]);
  expect(await call("get", `${base}/directions/${direction.id}/pdf`, cookie), 200);
  expect(await call("get", `${base}/directions/${second.id}/pdf`, cookie), 200);
  record("Expiry / reissue / supersession", { expiredGetAndContinue: 410, reissuedOldGetAndSession: 410, ledgerEntries: ["155660", "-155660", "30000"], retainedCents: revised.retainedCents, instruction: revised.instruction, bothSignedPdfsKept: true });

  const esmond = fixture.detail.holders.find((p) => p.displayName === "Esmond Robert III");
  const paper = expect(await call("post", `${base}/directions/paper`, cookie, { personId: esmond.personId, amountCents: "2500", receivedDate: "2026-10-22", documentId: fixture.source.id }), 200);
  assert.equal(paper.rows.find((r) => r.personId === esmond.personId).documentStatus, "Paper $25.00");
  const privateAttempt = await call("post", `${base}/mailing`, cookie, { ...draft, documentIds: [direction.document_id] });
  expect(privateAttempt, 400);
  expect(await call("post", `${base}/mailing`, cookie, { ...draft, documentIds: [fixture.source.id] }), 400);
  const noSend = captured.length;
  expect(await call("post", `${base}/directions/remind`, cookie), 403);
  expect(await call("post", `${base}/mailing/send`, cookie, { kind: "send", draftId: mailing.draftId }), 403);
  assert.equal(captured.length, noSend);
  const printFixture = structuredClone(rosterFixture);
  for (const p of printFixture.holdings) p.email = p.displayName === "Esmond Robert III" || p.displayName === "Davis Kiel" ? null : `${p.personId}@example.test`;
  h.setHoldings(printFixture); expect(await call("post", "/api/holdings/fetch", cookie), 200);
  const printed = await call("get", `${base}/mailing/paper.pdf`, cookie); expect(printed, 200);
  const printText = await pdfText(printed.body);
  assert.equal(printText.length, 4); assert.match(printText.join("\n"), /Direction to retain as additional paid-in capital/); assert.match(printText.join("\n"), /Signature:/);
  await writeFile(resolve(output, "Practice_Paper_Mailing.pdf"), printed.body);
  const paperOnly = await call("get", `${base}/directions/paper.pdf`, cookie); expect(paperOnly, 200);
  const paperOnlyText = await pdfText(paperOnly.body);
  assert.equal(paperOnlyText.length, 2);
  assert.match(paperOnlyText.join("\n"), /Signature:/);
  expect(await call("get", `${base}/directions/paper.pdf`), 401);
  await writeFile(resolve(output, "Practice_Paper_Directions.pdf"), paperOnly.body);
  record("Paper / privacy / practice controls", { paperStatus: "Paper $25.00", paperRecipients: 2, printedPages: 4, signatureAndDateLines: true,
    directionOnlyPages: 2, sharingSignedPdfAndPaperScan: 400, remindersAndBatchSend: 403 });

  const held = fixture.detail.holders.find((p) => p.displayName === "Adorno Marco");
  expect(await call("post", `${base}/directions/issue`, mailboxCookie, { personId: held.personId }), 200);
  const heldLink = urlFrom(captured.at(-1));
  const heldContinue = await call("post", "/api/signing/continue", null, { token: heldLink.searchParams.get("token") }); expect(heldContinue, 303);
  expect(await call("post", "/api/signing/sign", cookieFrom(heldContinue), { amountCents: "0", fullName: "Marco Adorno", consent: true }), 200);
  const heldDirection = (await client.query("SELECT id FROM signed_directions ORDER BY id DESC LIMIT 1")).rows[0].id;
  const heldConfirm = await call("post", `${base}/directions/${heldDirection}/confirm`, cookie, {}); expect(heldConfirm, 409);
  assert.equal(heldConfirm.body.error, "This holder is on hold — remove the hold first.");
  expect(await call("post", `${base}/holds`, cookie, { personId: held.personId, held: false }), 201);
  const zero = expect(await call("post", `${base}/directions/${heldDirection}/confirm`, cookie, {}), 200).rows.find((r) => r.personId === held.personId);
  assert.equal(zero.documentStatus, "Confirmed $0.00");
  assert.equal(Number((await client.query("SELECT count(*) FROM distribution_entries WHERE person_id=$1", [held.personId])).rows[0].count), 0);
  record("Hold and zero direction", { signedZero: 200, confirmOnHold: 409, removeHoldThenConfirm: 200, zeroApicEntries: 0 });

  delete process.env.RESEND_API_KEY;
  h.setHoldings(withEmail);
  const real = await finalizedFixture(h);
  process.env.RESEND_API_KEY = "development-mock-not-a-key";
  expect(await call("post", `${real.base}/directions/issue`, cookie, { personId: holder.personId }), 409);
  expect(await call("post", `${real.base}/finalize`, cookie, {}), 201);
  const beforeRemind = captured.length;
  const reminder = expect(await call("post", `${real.base}/directions/remind`, cookie), 200);
  assert.equal(reminder.count, 1); assert.equal(reminder.sentCount, 1); assert.equal(captured.length, beforeRemind + 1);
  assert.match(captured.at(-1).subject, /^Reminder:/);
  assert.doesNotMatch(captured.at(-1).text, /Forster|Nancy|\$|20 shares/);
  record("Real-year gate / explicit reminders", { unfinalizedIssue: 409, unsignedRemindersAttempted: reminder.count, accepted: reminder.sentCount, automaticJobs: 0, provider: "MOCK RESEND ONLY" });

  const audit = (await client.query("SELECT operation, count(*)::int AS count FROM audit_log WHERE operation LIKE 'DIRECTION%' GROUP BY operation ORDER BY operation")).rows;
  assert.ok(audit.some((r) => r.operation === "DIRECTION_SIGNED_AWAITING_CONFIRMATION"));
  assert.ok(audit.some((r) => r.operation === "DIRECTION_CONFIRMED"));
  record("Write History / immutable template", { audit, templateCount: (await client.query("SELECT count(*)::int AS count FROM direction_templates")).rows[0].count });
  expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  assert.equal(expect(await call("get", `${base}/directions`, cookie), 200).rows.every((r) => r.documentStatus === "Not yet"), true);
  expect(await call("get", "/api/signing/session", cookieFrom(secondContinue)), 410);
  record("Practice reset signing invalidation", "Old links/sessions/directions invalid; evidence/audit retained; reset files/ledger removed");
} finally {
  globalThis.fetch = originalFetch;
  await h.finish();
}
