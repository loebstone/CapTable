/**
 * DEVELOPMENT ONLY: local Roster STUB, real API/PostgreSQL/private storage and
 * Chromium/Excel exports. Temporary DB records rollback. Only practice files
 * are hard deleted, through the same guarded reset as the UI.
 */
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";

const h = await stage2Harness();
const { call, expect, client, record, results } = h;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
async function watermarked(bytes, expectedSource, expectedText = []) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    for (let page = 1; page <= pdf.numPages; page++) {
      const text = (await (await pdf.getPage(page)).getTextContent()).items.filter((x) => "str" in x).map((x) => x.str).join(" ").replace(/\s+/g, " ");
      assert.ok(text.includes("PRACTICE — NOT A STATEMENT"), `Missing text-layer watermark on page ${page}`);
      for (const expected of expectedText) assert.ok(text.includes(expected), `Practice PDF missing ${expected}: ${text}`);
      if (expectedSource) assert.ok(text.split(expectedSource).length - 1 >= 2, "Gross and cost must both show the practice source label");
    }
    return pdf.numPages;
  } finally { await task.destroy(); }
}
async function upload(base, cookie, attach = true) {
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "STUB-practice-source.png", size: png.length, contentType: "image/png" }), 201);
  assert.equal((await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).status, 200);
  return attach ? expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201) : slot;
}
try {
  const identity = (await client.query("SELECT current_database(), inet_server_addr()::text")).rows[0];
  results.push({ check: "Observed identity", environment: "development; NODE_ENV=test only in this process", identity });
  const fixture = await finalizedFixture(h, { isPractice: true });
  const { cookie, base } = fixture;
  const practiceId = fixture.detail.id, snapshotId = fixture.detail.snapshotId;
  assert.equal(fixture.detail.isPractice, true);
  // Preserve multiple revisions, not just the latest, until an explicit reset.
  const noDocuments = { grossCents: "11000000", costs: [{ label: "Zero-cost line", amountCents: "0" }], note: "STUB practice figures without source documents" };
  const withoutSource = expect(await call("post", `${base}/figures`, cookie, noDocuments), 201);
  assert.equal(withoutSource.figures.grossDocumentId, null);
  assert.equal(withoutSource.figures.costs[0].documentId, null);
  expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20", note: "STUB second declaration revision" }), 201);
  const detail = await fixture.finalizeWithLedger();
  const holder = detail.holders.find((x) => x.displayName === "Forster Nancy Anne");
  expect(await call("post", `${base}/holds`, cookie, { personId: holder.personId, held: true, note: "STUB explicit practice hold" }), 201);
  await upload(base, cookie, false); // Uploaded but unsealed staging object.
  const { yearDocumentStore } = await import("../src/lib/year-document-store.ts");
  const paths = (await client.query("SELECT object_path FROM year_documents WHERE year_id=$1 UNION SELECT object_path FROM year_uploads WHERE year_id=$1", [practiceId])).rows;
  const existingFiles = [];
  for (const { object_path } of paths) {
    try { existingFiles.push(await yearDocumentStore.getFile(object_path)); } catch (e) { if (e.name !== "ObjectNotFoundError") throw e; }
  }
  assert.equal(existingFiles.length, 2);
  const real = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, snapshotId, note: "STUB real year alongside practice" }), 201);
  const extra = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId, note: "STUB another practice in same calendar year" }), 201);
  expect(await call("post", "/api/years", cookie, { calendarYear: 2026, snapshotId, note: "STUB real duplicate refused" }), 409);
  const realBase = `/api/years/${real.id}`, realDocument = await upload(realBase, cookie);
  const auditCount = async () => Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n);
  const beforeRejectedFigures = await auditCount();
  const missingSourceMessage = "Every figure must reference an uploaded source document attached to this year";
  for (const body of [
    noDocuments,
    { ...noDocuments, isPractice: true, grossDocumentId: null },
    { ...noDocuments, grossDocumentId: realDocument.id },
    { ...noDocuments, costs: [{ ...noDocuments.costs[0], documentId: realDocument.id }] },
  ]) {
    const refused = await call("post", `${realBase}/figures`, cookie, body);
    expect(refused, 400); assert.equal(refused.body.error, missingSourceMessage);
  }
  assert.equal(await auditCount(), beforeRejectedFigures);
  const explicitNull = expect(await call("post", `/api/years/${extra.id}/figures`, cookie, { ...noDocuments, grossDocumentId: null, costs: [{ ...noDocuments.costs[0], documentId: null }] }), 201);
  assert.equal(explicitNull.documents.length, 0);
  assert.equal(explicitNull.figures.grossDocumentId, null); assert.equal(explicitNull.figures.costs[0].documentId, null);
  const invalidReference = await call("post", `/api/years/${extra.id}/figures`, cookie, { ...noDocuments, grossDocumentId: realDocument.id });
  expect(invalidReference, 400); assert.equal(invalidReference.body.error, missingSourceMessage);
  record("Optional practice sources / required real sources", { practiceOmitted: 201, practiceExplicitNull: 201, practiceGrossAndCostReferences: null, realMissingGrossOrCost: 400, spoofedPracticeFlag: 400, existingMessagePreserved: true, rejectedRealWrites: 0, providedCrossYearReference: 400 });
  expect(await call("post", `${realBase}/figures`, cookie, { grossCents: "11000000", grossDocumentId: realDocument.id, costs: [{ label: "Zero", amountCents: "0", documentId: realDocument.id }], note: "STUB real figures must survive" }), 201);
  expect(await call("post", `${realBase}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20", note: "STUB real declaration" }), 201);
  const practiceHolder = fixture.detail.holders.find((x) => x.displayName === "Forster Nancy Anne");
  const realStatement = expect(await call("get", `${realBase}/reports/statement/${practiceHolder.personId}.pdf?isPractice=true`, cookie), 409);
  assert.equal(realStatement.error, "Shareholder statements require a finalized year");
  expect(await call("get", `${realBase}/reports/statements.zip`, cookie), 409);
  expect(await call("get", `${realBase}/reports/ledger.xlsx`, cookie), 409);
  const draftEntry = { personId: practiceHolder.personId, kind: "cash", amountCents: "100", date: "2026-10-20", method: "STUB draft payment" };
  expect(await call("post", `${realBase}/payments`, cookie, { ...draftEntry, isPractice: true }), 409);
  record("Real draft guards", { statementHTTP: 409, existingStatementMessage: realStatement.error, zipHTTP: 409, ledgerHTTP: 409, spoofedPracticePaymentHTTP: 409 });
  const realFinal = expect(await call("post", `${realBase}/finalize`, cookie, { note: "STUB real finalization" }), 201);
  const realFile = await yearDocumentStore.getFile((await client.query("SELECT object_path FROM year_documents WHERE id=$1", [realDocument.id])).rows[0].object_path);
  const realList = expect(await call("get", "/api/years", cookie), 200);
  const practiceList = expect(await call("get", "/api/practice-years", cookie), 200);
  assert.deepEqual(realList.map((y) => y.id), [real.id]);
  assert.equal(practiceList.length, 2);
  assert.ok(practiceList.every((y) => y.isPractice));
  assert.ok(!realList.some((y) => y.isPractice || y.id === practiceId || y.id === extra.id));
  record("Creation and isolation", { sameCalendarYear: 2026, realYears: realList.length, practiceYears: practiceList.length, sharedSnapshot: snapshotId, duplicateReal: 409 });
  // Use a dedicated fresh year: the earlier practice fixture already contains
  // source-validation figures even though it has no declaration.
  const earlyYear = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId, note: "STUB genuinely empty preview year" }), 201);
  assert.equal(earlyYear.figures, null); assert.equal(earlyYear.declaredPerShareCents, null);
  const earlyBase = `/api/years/${earlyYear.id}`;
  const earlyStatementPath = `${earlyBase}/reports/statement/${practiceHolder.personId}.pdf`;
  const emptyStatement = await call("get", earlyStatementPath, cookie);
  expect(emptyStatement, 200);
  assert.equal(await watermarked(emptyStatement.body, null, ["not yet declared", "Estimated tax (proposed)", "Not recorded"]), 1);
  const emptyBoard = await call("get", `${earlyBase}/reports/board.pdf`, cookie);
  expect(emptyBoard, 200); assert.equal(await watermarked(emptyBoard.body), 1);
  const emptyLedger = await call("get", `${earlyBase}/reports/ledger.xlsx`, cookie);
  expect(emptyLedger, 200);
  const emptyBook = new ExcelJS.Workbook(); await emptyBook.xlsx.load(emptyLedger.body);
  for (const sheet of emptyBook.worksheets) assert.equal(sheet.getCell("A1").value, "PRACTICE");
  let emptyForsterFound = false;
  emptyBook.getWorksheet("Shareholder summary").eachRow((row) => {
    if (row.getCell(1).value === practiceHolder.displayName) {
      emptyForsterFound = true;
      for (const column of [4, 11, 12, 13]) assert.equal(row.getCell(column).value, null);
    }
  });
  assert.equal(emptyForsterFound, true);
  expect(await call("post", `${earlyBase}/payments`, cookie, draftEntry), 409);
  expect(await call("post", `${earlyBase}/figures`, cookie, noDocuments), 201);
  const undeclaredStatement = await call("get", earlyStatementPath, cookie);
  expect(undeclaredStatement, 200);
  assert.equal(await watermarked(undeclaredStatement.body, null, ["not yet declared", "Proposed amount per share", "$77.83", "$1,556.60", "Estimated tax (proposed)", "$1,100.00"]), 1);
  const earlyZip = await call("get", `${earlyBase}/reports/statements.zip`, cookie);
  expect(earlyZip, 200); assert.match(earlyZip.headers["content-disposition"], /_Practice_Statements_/);
  const earlyFiles = Object.values((await JSZip.loadAsync(earlyZip.body)).files).filter((f) => !f.dir);
  assert.equal(earlyFiles.length, 47);
  for (const file of earlyFiles) assert.equal(await watermarked(await file.async("nodebuffer"), null, ["not yet declared"]), 1);
  expect(await call("post", `${earlyBase}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20", note: "STUB draft practice declaration" }), 201);
  let early = expect(await call("post", `${earlyBase}/payments`, cookie, { ...draftEntry, amountCents: "10000" }), 201);
  const earlyCash = early.payments[0];
  early = expect(await call("post", `${earlyBase}/payments`, cookie, { ...draftEntry, kind: "apic", amountCents: "5000" }), 201);
  assert.equal(early.status, "draft"); assert.equal(early.finalizedAt, null);
  const afterEarlyEntries = await auditCount();
  expect(await call("post", `${earlyBase}/declaration`, cookie, { declaredPerShareCents: "1", declarationDate: "2026-10-20", note: "STUB cannot undercut recorded practice payments" }), 409);
  assert.equal(await auditCount(), afterEarlyEntries);
  const withEarlyPayments = await call("get", earlyStatementPath, cookie);
  expect(withEarlyPayments, 200); assert.equal(await watermarked(withEarlyPayments.body, null, ["$100.00", "$50.00"]), 1);
  expect(await call("post", `${earlyBase}/holds`, cookie, { personId: practiceHolder.personId, held: true, note: "STUB draft practice hold" }), 201);
  expect(await call("post", `${earlyBase}/payments`, cookie, draftEntry), 409);
  expect(await call("post", `${earlyBase}/reversals`, cookie, { entryId: earlyCash.id, date: "2026-10-20", note: "STUB reverse draft practice payment" }), 201);
  record("Practice exports and ledger before finalization", { freshStatementBoardAndWorkbookHTTP: 200, undeclaredStatementHTTP: 200, proposedPerShare: "$77.83", proposedDistribution: "$1,556.60", proposedEstimatedTax: "$1,100.00", undeclaredZipPdfs: earlyFiles.length, everyPdfOnePageAndWatermarked: true, xlsxBanners: emptyBook.worksheets.length, draftCashApicHoldAndReversalHTTP: 201, declarationBelowPaymentsHTTP: 409, realYearFlagSpoofRefused: true });
  // Same Class check and rate requirement as real years.
  await client.query("SAVEPOINT bad_snapshot");
  await client.query("UPDATE snapshot_rows SET shares=shares-1 WHERE id=(SELECT id FROM snapshot_rows WHERE snapshot_id=$1 AND share_class='C' LIMIT 1)", [snapshotId]);
  const bad = await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId, note: "STUB invalid Class C" });
  expect(bad, 409); assert.match(bad.body.error, /Class C.*1\.0000/);
  await client.query("ROLLBACK TO SAVEPOINT bad_snapshot"); await client.query("RELEASE SAVEPOINT bad_snapshot");
  expect(await call("post", "/api/years", cookie, { calendarYear: 2045, isPractice: true, snapshotId, note: "STUB missing rates" }), 409);
  // There is no conversion/update API; unknown flag fields on other writes never update the year.
  expect(await call("patch", base, cookie, { isPractice: false }), 404);
  expect(await call("patch", realBase, cookie, { isPractice: true }), 404);
  assert.equal(expect(await call("get", base, cookie), 200).isPractice, true);
  assert.equal(expect(await call("get", realBase, cookie), 200).isPractice, false);
  record("Original rules and immutable kind", "Practice Class C shortfall refused (409); missing rate table refused (409); both conversion attempts 404; flags unchanged");

  const statement = await call("get", `${base}/reports/statement/${holder.personId}.pdf`, cookie);
  expect(statement, 200); assert.match(statement.headers["content-disposition"], /_Practice_Statement_/);
  const statementPages = await watermarked(statement.body);
  const board = await call("get", `${base}/reports/board.pdf`, cookie);
  expect(board, 200); assert.match(board.headers["content-disposition"], /_Practice_Board_Summary_/);
  const boardPages = await watermarked(board.body, "none (practice)");
  const workbook = await call("get", `${base}/reports/ledger.xlsx`, cookie);
  expect(workbook, 200); assert.match(workbook.headers["content-disposition"], /_Practice_Ledger_/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(workbook.body);
  for (const sheet of book.worksheets) assert.equal(sheet.getCell("A1").value, "PRACTICE");
  const cashCell = book.getWorksheet("Ledger").getCell("E3");
  assert.equal(typeof cashCell.value, "number"); assert.match(cashCell.numFmt, /\$/);
  const zipResponse = await call("get", `${base}/reports/statements.zip`, cookie);
  expect(zipResponse, 200); assert.match(zipResponse.headers["content-disposition"], /_Practice_Statements_/);
  const zip = await JSZip.loadAsync(zipResponse.body);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  assert.equal(files.length, 47);
  for (const file of files) {
    assert.match(file.name, /_Practice_Statement_/);
    assert.equal(await watermarked(await file.async("nodebuffer")), 1);
  }
  record("PDF / ZIP / XLSX", { statementPages, boardPages, watermarkTextOnEveryPage: true, practiceFilenames: true, zipPdfs: files.length, xlsxFirstRowBanners: book.worksheets.length, numericCurrencyRetained: true });

  const auditBefore = Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n);
  expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "reset" }), 400);
  expect(await call("post", `${base}/reset-practice`, cookie, {}), 400);
  expect(await call("post", `${base}/reset-practice`, null, { confirmation: "RESET" }), 401);
  expect(await call("get", "/api/practice-years"), 401);
  const request = (await import("supertest")).default;
  assert.equal((await request(h.app).post(`${base}/reset-practice`).set("Cookie", cookie).set("Origin", "https://foreign.example").send({ confirmation: "RESET" })).status, 403);
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n), auditBefore);
  assert.equal(expect(await call("get", base, cookie), 200).status, "corrected");
  const fresh = expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  assert.equal(fresh.status, "draft"); assert.equal(fresh.figures, null); assert.equal(fresh.declaredPerShareCents, null);
  assert.equal(fresh.finalizedAt, null); assert.equal(fresh.calculation, null);
  assert.equal(fresh.snapshotId, snapshotId); assert.equal(fresh.isPractice, true);
  assert.equal(fresh.holders.length, 47); assert.equal(fresh.payments.length, 0); assert.equal(fresh.documents.length, 0);
  for (const table of ["year_uploads", "year_documents", "year_figures", "year_declarations", "year_finalizations", "year_corrections", "distribution_entries", "distribution_holds"]) {
    assert.equal(Number((await client.query(`SELECT count(*) AS n FROM ${table} WHERE year_id=$1`, [practiceId])).rows[0].n), 0, `${table} must be empty`);
  }
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM year_costs c JOIN year_figures f ON f.id=c.figures_id WHERE f.year_id=$1", [practiceId])).rows[0].n), 0);
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM snapshot_rows WHERE snapshot_id=$1", [snapshotId])).rows[0].n), 47);
  for (const file of existingFiles) assert.equal((await file.exists())[0], false);
  expect(await call("get", `${base}/documents/${fixture.source.id}/file`, cookie), 400);
  const resetStatement = await call("get", `${base}/reports/statement/${holder.personId}.pdf`, cookie);
  assert.equal(resetStatement.status, 200);
  assert.equal(await watermarked(resetStatement.body, null, ["not yet declared"]), 1);
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n), auditBefore + 1);
  const audit = (await client.query("SELECT actor, occurred_at, operation FROM audit_log ORDER BY id DESC LIMIT 1")).rows[0];
  const reset = JSON.parse(audit.operation);
  assert.equal(reset.action, "PRACTICE_RESET"); assert.equal(audit.actor, "test-bootstrap"); assert.ok(audit.occurred_at);
  assert.deepEqual(reset.removed, { figures: 2, costs: 2, documents: 1, uploadReservations: 2, ledgerEntries: 3, holds: 1, corrections: 1, finalizations: 1, declarations: 2, storedFiles: 2 });
  record("Practice reset", { state: "fresh draft", snapshotRowsRetained: 47, storedFilesConfirmedAbsent: existingFiles.length, oneAuditEntry: true, removed: reset.removed });
  const denied = await call("post", `${realBase}/reset-practice`, cookie, { confirmation: "RESET" });
  expect(denied, 403);
  const denial = JSON.parse((await client.query("SELECT operation FROM audit_log ORDER BY id DESC LIMIT 1")).rows[0].operation);
  assert.equal(denial.action, "PRACTICE_RESET_REFUSED");
  assert.deepEqual(expect(await call("get", realBase, cookie), 200), realFinal);
  assert.equal((await realFile.exists())[0], true);
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n), auditBefore + 2);
  record("Real reset refusal", { status: 403, auditAction: denial.action, realFinalizationFiguresAndFilesUnchanged: true });
  // Repeated resets are permitted and remain one audit per action.
  expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  record("Repeated empty reset", "200; same year, practice flag and snapshot retained");
} catch (error) {
  process.exitCode = 1;
  results.push({ check: "Practice acceptance", result: "FAIL", error: error.message, stack: error.stack });
} finally { await h.finish(); }
