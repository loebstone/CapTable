// DEVELOPMENT ONLY. Real API/DB/Chromium/private storage; Roster is the local
// Stage 1 fixture STUB. All database writes are transaction-local and rolled back.
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { readFile } from "node:fs/promises";

const h = await stage2Harness();
const { call, expect, client, record } = h;
async function pdfPages(response) {
  expect(response, 200);
  const task = getDocument({ data: new Uint8Array(response.body), useSystemFonts: true });
  const pdf = await task.promise, pages = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      let text = "", previous;
      for (const item of (await (await pdf.getPage(p)).getTextContent()).items) {
        if (!("str" in item)) continue;
        const sameLine = previous && Math.abs(previous.transform[5] - item.transform[5]) < 1;
        const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
        if (previous && (!sameLine || gap > 1)) text += " ";
        text += item.str;
        previous = item;
      }
      pages.push(text.replace(/\s+/g, " "));
    }
    return pages;
  } finally { await task.destroy(); }
}
try {
  record("Environment", { environment: "development; test process NODE_ENV=test", ...(await client.query("SELECT current_database(), inet_server_addr()::text")).rows[0] });
  const fixture = await finalizedFixture(h, { isPractice: true });
  const { cookie } = fixture;
  const year = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, snapshotId: fixture.detail.snapshotId }), 201);
  const base = `/api/years/${year.id}`;
  const figures = { grossCents: "12000000", costs: [{ label: "Forester fees", amountCents: "500000" }, { label: "Road work", amountCents: "1500000" }] };
  let detail = expect(await call("post", `${base}/figures`, cookie, figures), 201);
  assert.equal(detail.status, "draft");
  assert.equal(detail.figures.grossDocumentId, null);
  assert.deepEqual(detail.figures.costs.map((c) => c.documentId), [null, null]);
  const initialId = detail.figuresRevisionId;
  const refusal = await call("post", `${base}/finalize`, cookie, {});
  expect(refusal, 409);
  for (const expected of ["Source document missing for:", "Gross timber revenue", "Forester fees", "Road work", "declaration date are missing"]) assert.ok(refusal.body.error.includes(expected), refusal.body.error);
  record("Draft entry and complete Finalize refusal", { saved: 201, status: detail.status, grossCents: detail.figures.grossCents, costs: detail.figures.costs, refusal: refusal.body });
  const draftBoard = await call("get", `${base}/reports/board.pdf`, cookie);
  const draftPages = await pdfPages(draftBoard);
  assert.match(draftBoard.headers["content-disposition"], /_Draft_Board_Summary_/);
  for (const text of draftPages) {
    assert.ok(text.includes("DRAFT — PRELIMINARY"), text);
    assert.match(text, /Preliminary figures as of \d{4}-\d{2}-\d{2}\. Final figures will follow the Farm's tax filing\./);
    assert.ok(text.includes("no source document yet (draft)"));
  }
  record("Draft board PDF", { filename: draftBoard.headers["content-disposition"], pages: draftPages.length, watermarkAndHeaderOnEveryPage: true, noSourceLabel: true });
  const holder = detail.holders.find((r) => r.displayName === "Forster Nancy Anne");
  for (const path of [`statement/${holder.personId}.pdf`, `notice/${holder.personId}.pdf`, "statements.zip", "notices.zip", "ledger.xlsx"]) expect(await call("get", `${base}/reports/${path}`, cookie), 409);
  expect(await call("post", `${base}/payments`, cookie, { personId: holder.personId, kind: "cash", amountCents: "1", date: "2026-10-20" }), 409);
  const { issueSigningToken } = await import("../src/lib/direction-links.ts");
  const { mailingEnvelope } = await import("../src/lib/mailing-envelope.ts");
  const { write } = await import("../src/lib/records.ts");
  await assert.rejects(write("test-bootstrap", (tx) => issueSigningToken(tx, "test-bootstrap", year.id, holder.personId, "delivered@resend.dev", "http://hwd-verification.test")), /Finalize this year/);
  await assert.rejects(mailingEnvelope(year.id, { subject: "Uniform", body: "Uniform text", attachment: "none", choices: {}, documentIds: [] }, holder.personId, "delivered@resend.dev", "reply@example.test", true), /require a finalized year/);
  record("Real draft gates unchanged", { statement: 409, notice: 409, bothZips: 409, xlsx: 409, ledgerWrite: 409, signing: "refused", mailingEnvelope: "refused before send", emailsSent: 0 });

  // A new numeric revision and document-only revisions keep the old amounts.
  detail = expect(await call("post", `${base}/figures`, cookie, { ...figures, grossCents: "13000000" }), 201);
  const amountsBefore = [detail.figures.grossCents, ...detail.figures.costs.map((c) => c.amountCents)];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "STUB-draft-source.png", contentType: "image/png", size: png.length }), 201);
  assert.equal((await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).status, 200);
  const source = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  const path = `${base}/figures/documents`;
  expect(await call("post", path, cookie, { figuresId: initialId, target: "gross", documentId: source.id }), 409);
  expect(await call("post", path, cookie, { figuresId: detail.figuresRevisionId, target: "gross", documentId: fixture.source.id }), 400);
  const beforeAudit = Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n);
  for (const target of [{ target: "gross" }, { target: "cost", costIndex: 0 }, { target: "cost", costIndex: 1 }]) {
    detail = expect(await call("post", path, cookie, { figuresId: detail.figuresRevisionId, documentId: source.id, ...target }), 201);
    assert.deepEqual([detail.figures.grossCents, ...detail.figures.costs.map((c) => c.amountCents)], amountsBefore);
  }
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n) - beforeAudit, 9);
  assert.ok(!detail.blockers.some((b) => b.reason.includes("Source document missing")));
  const history = detail.history.filter((entry) => entry.figures);
  assert.equal(history.length, 5);
  assert.deepEqual(history.map((entry) => entry.figures.grossCents).sort(), ["12000000", "13000000", "13000000", "13000000", "13000000"]);
  assert.ok(history.every((entry) => entry.figures.costs.length === 2 && entry.createdAt && entry.createdByName === "Test Bootstrap"));
  record("Attach without amounts / append-only history", { source: source.filename, figuresRevisions: 5, originalGrossCents: "12000000", revisedGrossCents: "13000000", costCents: ["500000", "1500000"], newAudits: 9, amountsUnchangedByAttachments: true, staleRevision: 409, crossYearDocument: 400, savedByAndDatesPresent: true });
  detail = expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20" }), 201);
  assert.equal(detail.blockers.length, 0);
  detail = expect(await call("post", `${base}/finalize`, cookie, {}), 201);
  assert.equal(detail.status, "finalized");
  assert.ok(detail.finalizedAt);
  assert.equal(detail.calculation.netProfitCents, "11000000");
  expect(await call("post", path, cookie, { figuresId: detail.figuresRevisionId, target: "gross", documentId: source.id }), 409);
  const finalBoard = await call("get", `${base}/reports/board.pdf`, cookie);
  assert.doesNotMatch(finalBoard.headers["content-disposition"], /Draft/);
  for (const text of await pdfPages(finalBoard)) {
    assert.ok(!text.includes("DRAFT — PRELIMINARY"));
    assert.ok(!text.includes("Preliminary figures as of"));
    assert.ok(text.includes("Final"));
  }
  record("Final lock and board", { finalize: 201, status: detail.status, uiStatus: "Final", blockers: detail.blockers, netProfitCents: detail.calculation.netProfitCents, laterAttach: 409, finalBoard: 200, draftWatermarkRemoved: true, draftFilenameRemoved: true });

  const practice = expect(await call("post", `${fixture.base}/figures`, cookie, figures), 201);
  assert.ok(!practice.blockers.some((b) => b.reason.includes("Source document")));
  expect(await call("post", `${fixture.base}/finalize`, cookie, {}), 201);
  const practiceBoard = await call("get", `${fixture.base}/reports/board.pdf`, cookie);
  assert.match(practiceBoard.headers["content-disposition"], /Practice/);
  for (const text of await pdfPages(practiceBoard)) {
    assert.ok(text.includes("PRACTICE — NOT A STATEMENT"));
    assert.ok(!text.includes("DRAFT — PRELIMINARY"));
  }
  record("Practice exemption unchanged", { withoutSources: 201, finalize: 201, practiceWatermarkRetained: true, noDraftWatermark: true });
  expect(await call("post", path, null, {}), 401);
  expect(await call("post", path, cookie, {}).then((r) => r), 400);
  const ui = await readFile(new URL("../../hwd-distributions/src/pages/year-detail.tsx", import.meta.url), "utf8");
  const banner = await readFile(new URL("../../hwd-distributions/src/components/year-draft-banner.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes("no source document yet (draft)"));
  assert.ok(ui.includes("useLinkFigureDocument"));
  assert.ok(ui.includes("h.figures.costs.map"));
  assert.ok(banner.includes("Draft — preliminary figures for board guidance. Final figures will follow the Farm's tax filing."));
  record("UI wiring / access", { draftSourceLabel: true, sourceOnlyControl: true, fullRevisionHistory: true, shellBanner: true, anonymousAttachment: 401 });
} finally { await h.finish(); }
