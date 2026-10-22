/**
 * DEVELOPMENT ONLY: local Roster STUB and rollback-isolated tables.
 * Exercises report routes; no production or persistent business-data writes.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { formatShares } from "@workspace/display";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { TAX_CAVEAT } from "../src/lib/reports/format.ts";

const output = resolve("../../generated-artifacts/report-notices");
const h = await stage2Harness();
const { call, expect, record } = h;
const normalized = (text) => text.replace(/\s+/g, " ").trim();
const forbidden = /\bdeclared\b|\bdeclaration\b|\(proposed\)/i;
async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    assert.equal(pdf.numPages, 1, "Report must be exactly one page");
    const content = await (await pdf.getPage(1)).getTextContent();
    let text = "", previous;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const sameLine = previous && Math.abs(previous.transform[5] - item.transform[5]) < 1;
      const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
      if (previous && !sameLine) text += "\n";
      else if (previous && gap > 1) text += " ";
      text += item.str; previous = item;
    }
    assert.match(text, /PRACTICE — NOT A STATEMENT/);
    assert.doesNotMatch(normalized(text), forbidden);
    return text;
  } finally { await task.destroy(); }
}
function binary(response, status = 200) {
  const error = response.headers["content-type"]?.includes("json")
    ? Buffer.isBuffer(response.body) ? response.body.toString() : JSON.stringify(response.body)
    : `${response.headers["content-type"]}; ${response.body?.length ?? 0} bytes`;
  assert.equal(response.status, status, error);
  return response.body;
}
let base, cookie;
try {
  for (const [input, expected] of [
    ["20.0000", "20"], ["12.5000", "12.5"], ["6.2500", "6.25"],
    ["0.0000", "0"], ["100", "100"], ["100.0000", "100"], ["400.0000", "400"],
    ["0.0001", "0.0001"], ["8.4000", "8.4"], ["12.3456789000", "12.3456789"],
    ["9007199254740993.0001", "9007199254740993.0001"],
  ]) assert.equal(formatShares(input), expected);
  const fixture = await finalizedFixture(h, { isPractice: true });
  cookie = fixture.cookie;
  base = `/api/years/${fixture.detail.id}`;
  const holder = fixture.detail.holders.find((row) => row.displayName === "Forster Nancy Anne");
  const noticePath = `${base}/reports/notice/${holder.personId}.pdf`;
  const statementPath = `${base}/reports/statement/${holder.personId}.pdf`;
  const notice = await call("get", noticePath, cookie);
  const statement = await call("get", statementPath, cookie);
  const board = await call("get", `${base}/reports/board.pdf`, cookie);
  const noticeText = await pdfText(binary(notice));
  const statementText = await pdfText(binary(statement));
  const boardText = await pdfText(binary(board));
  assert.equal(holder.shares, "20.0000");
  const fractional = fixture.detail.holders.find((row) => row.displayName === "Pieropan Nancy");
  assert.equal(fractional.shares, "8.4000");
  for (const text of [noticeText, statementText]) {
    assert.match(normalized(text), /Class C · 20 shares/);
    assert.match(normalized(text), /Your shares 20\b/);
    assert.match(normalized(text), /You hold 20 shares/);
    assert.doesNotMatch(text, /20\.0000/);
  }
  assert.match(normalized(boardText), /Forster Nancy Anne C MA 20\b/);
  assert.match(normalized(boardText), /Pieropan Nancy B WY 8\.4\b/);
  assert.match(normalized(boardText), /Class A: 100 shares/);
  const workbookResponse = await call("get", `${base}/reports/ledger.xlsx`, cookie);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(binary(workbookResponse));
  const summary = workbook.getWorksheet("Shareholder summary");
  const displayed = [];
  summary.eachRow((row) => {
    if (![holder.displayName, fractional.displayName].includes(row.getCell(1).value)) return;
    const cell = row.getCell(3);
    assert.equal(typeof cell.value, "number");
    const stored = row.getCell(1).value === holder.displayName ? holder.shares : fractional.shares;
    assert.equal(cell.value.toFixed(4), stored);
    assert.equal(cell.numFmt, stored === "20.0000" ? "0" : "0.0");
    displayed.push({ holder: row.getCell(1).value, value: cell.value, format: cell.numFmt, displayed: formatShares(String(cell.value)) });
  });
  assert.equal(displayed.length, 2);
  record("Shared share formatting", {
    formatterCases: 11, noticeAndStatement: ["Class C · 20 shares", "You hold 20 shares", "Your shares 20"],
    board: [{ holder: holder.displayName, shares: "20" }, { holder: fractional.displayName, shares: "8.4" }],
    classTotal: "100 shares", workbook: displayed,
    transmittedAndStoredStringsUnchanged: [holder.shares, fractional.shares],
  });
  assert.match(notice.headers["content-disposition"], /_Practice_Notice_Forster_Nancy_\d{4}-\d{2}-\d{2}\.pdf/);
  assert.match(statement.headers["content-disposition"], /_Practice_Statement_Forster_Nancy_/);
  for (const text of [noticeText, statementText]) {
    assert.ok(normalized(text).includes(TAX_CAVEAT));
    assert.ok(normalized(text).includes("Allocated profit (your share of the net profit)"));
    assert.ok(normalized(text).includes("Surplus/Deficit is your distribution less your estimated tax."));
    for (const amount of ["$77.83", "$1,556.60", "$5,500.00", "$1,100.00", "$456.60"]) assert.ok(text.includes(amount), amount);
    for (const other of fixture.detail.holders.filter((r) => r.personId !== holder.personId)) {
      assert.ok(!normalized(text).includes(other.displayName), `Leaked another holder's name: ${other.personId}`);
    }
  }
  assert.match(normalized(noticeText), /Amount eligible for Additional Paid-In Capital reinvestment \$456\.60/);
  assert.doesNotMatch(noticeText, /Paid and APIC retained|Instruction:|No cash payments|direction letter|Cash reversal/);
  assert.match(statementText, /Paid and APIC retained/);
  assert.match(statementText, /Instruction: Pay/);
  assert.match(normalized(boardText), /Distribution per share × 400/);
  assert.match(normalized(boardText), /Rounding residual \(sum minus per share × 400\) −\$0\.02/);
  const zipResponse = await call("get", `${base}/reports/notices.zip`, cookie);
  const zip = await JSZip.loadAsync(binary(zipResponse));
  const files = Object.values(zip.files).filter((file) => !file.dir);
  assert.equal(files.length, 47); assert.equal(new Set(files.map((file) => file.name)).size, 47);
  for (const file of files) {
    assert.match(file.name, /_Practice_Notice_.*\.pdf$/);
    const text = await pdfText(await file.async("nodebuffer"));
    assert.doesNotMatch(text, /Paid and APIC retained|Instruction:/);
  }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "STUB_Forster_notice.pdf"), notice.body);
  await writeFile(resolve(output, "STUB_Forster_statement.pdf"), statement.body);
  await writeFile(resolve(output, "STUB_board.pdf"), board.body);
  await writeFile(resolve(output, "STUB_all_notices.zip"), zipResponse.body);
  await writeFile(resolve(output, "notice.txt"), noticeText);
  await writeFile(resolve(output, "statement.txt"), statementText);
  await writeFile(resolve(output, "board.txt"), boardText);
  record("Practice notice / statement / board / all-notices ZIP", {
    environment: "development", source: "LOCAL ROSTER STUB; temporary rollback fixture",
    pagesEach: 1, zipFiles: files.length, zipEveryPdfOnePage: true,
    practiceWatermarksAndFilenames: true, forbiddenWordHits: 0, fullCaveatAndPrivacy: true,
    distribution: "$1,556.60", estimatedTax: "$1,100.00", surplus: "$456.60", apicEligible: "$456.60",
    reportTextDirectory: "generated-artifacts/report-notices",
  });
  // Append a lower per-share revision in this temporary practice fixture only,
  // to exercise the negative-surplus display without changing arithmetic.
  expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "5000", declarationDate: "2026-10-20" }), 201);
  const negative = await call("get", noticePath, cookie);
  const negativeText = await pdfText(binary(negative));
  assert.match(normalized(negativeText), /Surplus\/Deficit −\$100\.00/);
  assert.match(normalized(negativeText), /Amount eligible for Additional Paid-In Capital reinvestment \$0\.00/);
  await writeFile(resolve(output, "STUB_Forster_negative_notice.pdf"), negative.body);
  await writeFile(resolve(output, "negative-notice.txt"), negativeText);
  record("Negative surplus clamp", { holder: holder.displayName, distribution: "$1,000.00", estimatedTax: "$1,100.00", surplus: "−$100.00", apicEligible: "$0.00", pages: 1 });
  const empty = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId: fixture.detail.snapshotId }), 201);
  const emptyBase = `/api/years/${empty.id}`;
  const emptyText = await pdfText(binary(await call("get", `${emptyBase}/reports/notice/${holder.personId}.pdf`, cookie)));
  assert.match(emptyText, /not yet set/);
  assert.match(normalized(emptyText), /Amount eligible for Additional Paid-In Capital reinvestment Not recorded/);
  expect(await call("post", `${emptyBase}/figures`, cookie, { grossCents: "11000000", costs: [{ amountCents: "0" }] }), 201);
  const proposedText = await pdfText(binary(await call("get", `${emptyBase}/reports/notice/${holder.personId}.pdf`, cookie)));
  assert.match(proposedText, /not yet set/);
  assert.match(proposedText, /No distribution amount has been set/);
  assert.match(normalized(proposedText), /Amount eligible for Additional Paid-In Capital reinvestment \$456\.60/);
  record("Practice fallback", { noFiguresEligible: "Not recorded", noDistributionHero: "not yet set", proposedEligible: "$456.60", pagesEach: 1 });
  const real = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: false, snapshotId: fixture.detail.snapshotId }), 201);
  for (const path of [`/api/years/${real.id}/reports/notice/${holder.personId}.pdf`, `/api/years/${real.id}/reports/notices.zip`]) binary(await call("get", path, cookie), 409);
  for (const path of [noticePath, `${base}/reports/notices.zip`]) binary(await call("get", path), 401);
  expect(await call("post", "/api/access", cookie, { email: "other@example.test" }), 201);
  const otherCookie = await h.login("other@example.test");
  expect(await call("post", "/api/access/remove", cookie, { personId: "test-other" }), 201);
  for (const path of [noticePath, `${base}/reports/notices.zip`]) binary(await call("get", path, otherCookie), 403);
  record("Same report gates and access", { realDraftNoticeAndZipHTTP: 409, anonymousNoticeAndZipHTTP: 401, revokedNoticeAndZipHTTP: 403, practiceDraftHTTP: 200 });
} catch (error) {
  record("Report notice verification", { message: error.message, stack: error.stack }, "FAIL");
  process.exitCode = 1;
} finally {
  if (base && cookie) {
    try { expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200); }
    catch (error) { record("Practice-file cleanup", { message: error.message }, "FAIL"); process.exitCode = 1; }
  }
  await h.finish();
}
