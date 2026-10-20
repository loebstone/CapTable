/**
 * DEVELOPMENT ONLY: actual headless Chromium PDFs, ZIP, XLSX and authorization.
 * Local Roster STUB; real PostgreSQL/App Storage. All DB records roll back.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";

const h = await stage2Harness();
const { client, call, expect, record, results } = h;
const caveat = "This is an estimate at the highest rates the Corporation plans on. Your own return may differ, and the Corporation does not give tax advice.";
const normalized = (text) => text.replace(/\s+/g, " ").trim();
async function inspectPdf(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const document = await task.promise;
  const pages = document.numPages;
  const texts = [];
  for (let i = 1; i <= pages; i++) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();
    // Chromium can split a ligature into adjacent text items ("di", "ff", "er").
    // Insert spaces only at visible gaps/line changes, not between every glyph.
    let text = "", previous;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const sameLine = previous && Math.abs(previous.transform[5] - item.transform[5]) < 1;
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      if (previous && (!sameLine || gap > 1)) text += " ";
      text += item.str;
      previous = item;
    }
    texts.push(text);
  }
  await task.destroy();
  return { pages, text: normalized(texts.join(" ")) };
}
const centsFromCell = (cell) => {
  assert.equal(typeof cell.value, "number", `Numeric money cell required at ${cell.address}`);
  assert.match(cell.numFmt, /\$/);
  return BigInt(Math.round(cell.value * 100)); // Readback assertion only, never business arithmetic.
};
const outputDir = resolve("../../generated-artifacts/stage3-verification");

try {
  const identity = (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0];
  results.push({ check: "Observed identity", environment: "development; NODE_ENV=test only in verification", observed: identity });
  assert.equal((await client.query("SELECT count(*)::int AS n FROM access_entries")).rows[0].n, 0, "Verification requires a fresh development access list");
  const fixture = await finalizedFixture(h);
  const { cookie, base, source } = fixture;
  const forsterBefore = fixture.detail.holders.find((p) => p.displayName === "Forster Nancy Anne");
  const draftStatement = await call("get", `${base}/reports/statement/${forsterBefore.personId}.pdf`, cookie);
  assert.equal(draftStatement.status, 409);
  const draftZip = await call("get", `${base}/reports/statements.zip`, cookie);
  assert.equal(draftZip.status, 409);
  const draftBoard = await call("get", `${base}/reports/board.pdf`, cookie);
  assert.equal(draftBoard.status, 200);
  assert.equal((await inspectPdf(draftBoard.body)).pages, 1);
  record("Open-year export rules", "Draft board PDF -> 200 / one page; draft individual statement and ZIP -> 409");

  const detail = await fixture.finalizeWithLedger();
  const forster = detail.holders.find((p) => p.displayName === "Forster Nancy Anne");
  const statementPath = `${base}/reports/statement/${encodeURIComponent(forster.personId)}.pdf`;
  const statement = await call("get", statementPath, cookie);
  assert.equal(statement.status, 200);
  assert.match(statement.headers["content-type"], /application\/pdf/);
  assert.match(statement.headers["content-disposition"], /HWD_Distribution_2026_Statement_Forster_Nancy_\d{4}-\d{2}-\d{2}\.pdf/);
  assert.match(statement.headers["cache-control"], /private.*no-store/);
  const statementPdf = await inspectPdf(statement.body);
  assert.equal(statementPdf.pages, 1);
  for (const required of ["Horace W. Davis Realty Corp.", "Forster Nancy Anne", "$1,556.60", "$1,100.00", "$825.00", "$275.00", "15.00%", "5.00%", "MA", "2026-10-19", "$556.60", "$1,000.00", caveat, "ENVIRONMENT development", identity.database_name, "SQL NULL"]) {
    assert.ok(statementPdf.text.includes(required), `Statement missing ${required}: ${statementPdf.text}`);
  }
  const otherNames = detail.holders.filter((p) => p.personId !== forster.personId).map((p) => p.displayName);
  assert.ok(otherNames.every((name) => !statementPdf.text.includes(name)));
  assert.ok(!statementPdf.text.includes("Internal privacy probe"));
  record("8a. Forster statement PDF", {
    pages: statementPdf.pages, nominalCents: forster.nominalCents,
    estimatedFederalCents: "82500", estimatedStateCents: "27500", estimatedTaxCents: forster.estimatedTaxCents,
    fullCaveatFound: true, otherShareholderNamesFound: 0, currentPaidCents: forster.paidCents,
    retainedCents: forster.retainedCents, remainingCents: forster.remainingCents,
    filenamePatternMatched: true, environmentAndObservedIdentityPrinted: true,
  });
  const board = await call("get", `${base}/reports/board.pdf`, cookie);
  assert.equal(board.status, 200);
  assert.match(board.headers["content-disposition"], /HWD_Distribution_2026_Board_Summary_\d{4}-\d{2}-\d{2}\.pdf/);
  const boardPdf = await inspectPdf(board.body);
  assert.equal(boardPdf.pages, 1, boardPdf.text);
  const namedRows = detail.holders.filter((p) => boardPdf.text.includes(p.displayName));
  assert.equal(namedRows.length, 47);
  // A full source filename can wrap at a hyphen; visual line breaks do not
  // change the filename. Match its characters without inserted line spacing.
  assert.ok(boardPdf.text.replace(/\s+/g, "").includes(source.filename));
  for (const text of ["$110,000.00", "$77.83", "2026-10-20", "28.30%", "$31,131.98", "$31,132.00", "0.02", "$556.60", "$30,575.38", "45 open / 2 held / 0 complete", "2 holders", "22 holders", "14 holders", "9 holders", "ENVIRONMENT development", identity.database_name]) {
    assert.ok(boardPdf.text.includes(text), `Board PDF missing ${text}: ${boardPdf.text}`);
  }
  assert.ok(/[−-]\s*\$0\.02/.test(boardPdf.text), "Board residual must be negative, not just 0.02");
  record("8b. Board summary PDF", { pages: boardPdf.pages, namedShareholderRows: namedRows.length, sourceDocumentFound: source.filename, residualCents: detail.calculation.residualCents, totals: detail.totals, classHeadcounts: [2, 22, 14, 9] });

  const workbookResponse = await call("get", `${base}/reports/ledger.xlsx`, cookie);
  assert.equal(workbookResponse.status, 200);
  assert.match(workbookResponse.headers["content-disposition"], /HWD_Distribution_2026_Ledger_\d{4}-\d{2}-\d{2}\.xlsx/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookResponse.body);
  const ledger = workbook.getWorksheet("Ledger"), summary = workbook.getWorksheet("Shareholder summary");
  const entries = (await client.query("SELECT * FROM distribution_entries WHERE year_id=$1 ORDER BY id", [detail.id])).rows;
  assert.equal(ledger.rowCount - 1, entries.length);
  for (const [i, entry] of entries.entries()) {
    const row = ledger.getRow(i + 2);
    const holder = detail.holders.find((p) => p.personId === entry.person_id);
    assert.equal(row.getCell(1).value, holder.displayName);
    assert.equal(row.getCell(2).value, holder.shareClass);
    assert.equal(row.getCell(3).value.toFixed(4), holder.shares);
    assert.equal(centsFromCell(row.getCell(5)).toString(), entry.amount_cents);
    assert.equal(row.getCell(6).value.toISOString().slice(0, 10), entry.date.toISOString?.().slice(0, 10) ?? entry.date);
    assert.equal(row.getCell(8).value, entry.note);
    assert.equal(row.getCell(10).value, entry.id);
    assert.equal(row.getCell(4).value, entry.reverses_entry_id ? "reversal" : entry.kind === "cash" ? "cash" : "APIC");
    if (entry.kind === "apic") assert.equal(row.getCell(7).value.toISOString().slice(0, 10), "2026-10-19");
  }
  assert.equal(summary.rowCount, 49); // Header + 47 holders + total.
  for (let i = 0; i < detail.holders.length; i++) {
    const holder = detail.holders[i], row = summary.getRow(i + 2);
    assert.equal(row.getCell(1).value, holder.displayName);
    for (const [column, key] of [[4, "nominalCents"], [5, "paidCents"], [6, "retainedCents"], [7, "remainingCents"]]) {
      assert.equal(centsFromCell(row.getCell(column)).toString(), holder[key]);
    }
    const paidDB = entries.filter((e) => e.person_id === holder.personId && e.kind === "cash").reduce((sum, e) => sum + BigInt(e.amount_cents), 0n);
    const retainedDB = entries.filter((e) => e.person_id === holder.personId && e.kind === "apic").reduce((sum, e) => sum + BigInt(e.amount_cents), 0n);
    assert.equal(centsFromCell(row.getCell(5)), paidDB);
    assert.equal(centsFromCell(row.getCell(6)), retainedDB);
    assert.equal(centsFromCell(row.getCell(7)), BigInt(holder.nominalCents) - paidDB - retainedDB);
    assert.equal(row.getCell(8).value, holder.status);
  }
  const total = summary.getRow(49);
  for (const [column, key] of [[4, "nominalCents"], [5, "paidCents"], [6, "retainedCents"], [7, "remainingCents"]]) assert.equal(centsFromCell(total.getCell(column)).toString(), detail.totals[key]);
  const metadata = workbook.getWorksheet("Report information");
  assert.equal(metadata.getCell("B6").value, "development");
  assert.equal(metadata.getCell("B7").value, identity.database_name);
  assert.equal(metadata.getCell("B8").value, "SQL NULL");
  record("8c. Reopened accountant XLSX", { ledgerEntryRows: entries.length, entryTypes: ["cash", "APIC", "reversal"], summaryHolderRows: 47, allEntryAmountsDatesNotesAndIdsMatchDatabase: true, allShareholderPaidAndRetainedSumsMatchDatabase: true, numericCurrencyCells: true, totals: detail.totals });

  const zipResponse = await call("get", `${base}/reports/statements.zip`, cookie);
  assert.equal(zipResponse.status, 200);
  const zip = await JSZip.loadAsync(zipResponse.body);
  const pdfFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.endsWith(".pdf"));
  assert.equal(pdfFiles.length, 47);
  const statementNames = new Set();
  for (const file of pdfFiles) {
    assert.match(file.name, /^HWD_Distribution_2026_Statement_[A-Za-z0-9-]+_[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = await inspectPdf(await file.async("nodebuffer"));
    assert.equal(pdf.pages, 1, `${file.name} must be one page`);
    const included = detail.holders.filter((holder) => pdf.text.includes(holder.displayName));
    assert.equal(included.length, 1, `${file.name} must mention exactly its own shareholder`);
    assert.ok(pdf.text.includes(caveat));
    statementNames.add(included[0].personId);
  }
  assert.equal(statementNames.size, 47);
  record("8d. ZIP of all statements", { pdfFiles: pdfFiles.length, distinctShareholders: statementNames.size, allOnePage: true, eachContainsOnlyItsOwnShareholderName: true, fullCaveatInEveryPdf: true });

  expect(await call("post", "/api/access", cookie, { email: "other@example.test", note: "STUB export access probe" }), 201);
  const removedCookie = await h.login("other@example.test");
  expect(await call("post", "/api/access/remove", cookie, { personId: "test-other", note: "STUB remove access before report probes" }), 201);
  const paths = [statementPath, `${base}/reports/statements.zip`, `${base}/reports/board.pdf`, `${base}/reports/ledger.xlsx`];
  for (const path of paths) {
    assert.equal((await call("get", path)).status, 401);
    assert.equal((await call("get", path, removedCookie)).status, 403);
  }
  record("8e. Every report route server-protected", { routes: 4, anonymousHTTP: 401, rosterAllowedButLocallyRemovedHTTP: 403, checks: 8 });
  const after = expect(await call("get", base, cookie), 200);
  assert.deepEqual(after, detail, "Report generation must never mutate the year, ledger or status");
  record("Read-only generation", "Year and payment record identical before/after PDF, ZIP and XLSX generation");

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "STUB_Forster_statement.pdf"), statement.body);
  await writeFile(resolve(outputDir, "STUB_board_summary.pdf"), board.body);
  await writeFile(resolve(outputDir, "STUB_ledger.xlsx"), workbookResponse.body);
  record("Inspection artifacts", "Small STUB-only PDFs/XLSX saved under ignored generated-artifacts/stage3-verification; never application data");
} finally {
  await h.finish();
}
