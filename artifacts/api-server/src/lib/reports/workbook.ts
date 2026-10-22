import ExcelJS from "exceljs";
import { formatShares } from "@workspace/display";
import type { ReportContext } from "./context";
import { ISSUER } from "./format";
import { HttpError } from "../errors";

const currency = '"$"#,##0.00;[Red]-"$"#,##0.00';
function decimal(units: bigint, places: number) {
  const scale = 10n ** BigInt(places), abs = units < 0n ? -units : units;
  return `${units < 0n ? "-" : ""}${abs / scale}.${String(abs % scale).padStart(places, "0")}`;
}
function numeric(units: bigint, places: number) {
  // Excel numeric cells are IEEE-754. Convert ONLY at this output boundary,
  // after all financial arithmetic is finished in integer cents. Refuse loss.
  if (String(units < 0n ? -units : units).length > 15) throw new HttpError(409, "A value exceeds Excel's 15-digit numeric precision; no rounded or misleading workbook was produced");
  const exact = decimal(units, places), value = Number(exact);
  if (!Number.isFinite(value) || value.toFixed(places) !== exact) throw new HttpError(409, "A value cannot be represented accurately as a numeric Excel cell");
  return value;
}
function money(cents: string | null) { return cents === null ? null : numeric(BigInt(cents), 2); }
function shares(value: string) { return numeric(BigInt(value.replace(".", "")), 4); }
function excelDate(date: string) { return new Date(`${date}T00:00:00Z`); }
function styleSheet(sheet: ExcelJS.Worksheet, widths: number[], currencyColumns: number[], shareColumn?: number) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column, index) => { column.width = widths[index] ?? 20; });
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF203238" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (let row = 2; row <= sheet.rowCount; row++) {
    const r = sheet.getRow(row);
    r.alignment = { vertical: "top", wrapText: true };
    r.font = { name: "Calibri", size: 11 };
    if (row % 2 === 0) r.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F2EC" } }; });
    for (const column of currencyColumns) r.getCell(column).numFmt = currency;
    if (shareColumn) {
      const cell = r.getCell(shareColumn);
      const fraction = formatShares(String(cell.value)).split(".")[1];
      cell.numFmt = fraction ? `0.${"0".repeat(fraction.length)}` : "0";
    }
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: widths.length } };
}
export async function ledgerWorkbook(context: ReportContext) {
  const year = context.year, book = new ExcelJS.Workbook();
  book.creator = ISSUER; book.title = `${year.calendarYear} paid-and-retained ledger`;
  book.created = new Date(context.generatedAt);
  const ledger = book.addWorksheet("Ledger");
  ledger.addRow(["Shareholder", "Class", "Shares", "Entry type", "Amount", "Date", "Method / letter received date", "Note", "Ledger category", "Entry ID", "Reverses entry ID", "Person ID"]);
  for (const entry of year.payments) {
    const holder = year.holders.find((h) => h.personId === entry.personId)!;
    const original = entry.reversesEntryId === null ? null : year.payments.find((e) => e.id === entry.reversesEntryId);
    ledger.addRow([
      holder.displayName, holder.shareClass, shares(holder.shares),
      entry.reversesEntryId !== null ? "reversal" : entry.kind === "cash" ? "cash" : "APIC",
      money(entry.amountCents), excelDate(entry.date),
      entry.kind === "cash" ? entry.method ?? "" : excelDate(original?.date ?? entry.date),
      entry.note, entry.kind === "cash" ? "cash" : "APIC",
      entry.id, entry.reversesEntryId, entry.personId,
    ]);
  }
  styleSheet(ledger, [29, 9, 12, 14, 17, 15, 30, 48, 17, 12, 18, 24], [5], 3);
  ledger.eachRow((row, index) => {
    if (index > 1) {
      row.getCell(6).numFmt = "yyyy-mm-dd";
      if (row.getCell(7).value instanceof Date) row.getCell(7).numFmt = "yyyy-mm-dd";
    }
  });
  const summary = book.addWorksheet("Shareholder summary");
  summary.addRow(["Holder", "Class", "Shares", "Distribution", "Paid", "APIC retained", "Remaining", "Instruction", "Person ID", "State", "Allocated profit", "Estimated tax", "Surplus/Deficit"]);
  for (const holder of year.holders) summary.addRow([
    holder.displayName, holder.shareClass, shares(holder.shares), money(holder.nominalCents),
    money(holder.paidCents), money(holder.retainedCents), money(holder.remainingCents), holder.instruction, holder.personId,
    holder.stateCode, money(holder.shareOfGainCents), money(holder.estimatedTaxCents), money(holder.surplusCents),
  ]);
  styleSheet(summary, [30, 9, 12, 18, 18, 18, 18, 15, 24, 10, 20, 20, 20], [4, 5, 6, 7, 11, 12, 13], 3);
  const total = summary.addRow([
    "TOTAL", "", null, money(year.declaredPerShareCents === null ? null : year.totals.nominalCents),
    money(year.totals.paidCents), money(year.totals.retainedCents),
    money(year.declaredPerShareCents === null ? null : year.totals.remainingCents), "", "", "",
    ...(["shareOfGainCents", "estimatedTaxCents", "surplusCents"] as const).map((key) =>
      money(year.holders.some((h) => h[key] === null) ? null : year.holders.reduce((sum, h) => sum + BigInt(h[key]!), 0n).toString())),
  ]);
  total.font = { name: "Calibri", bold: true };
  total.eachCell((cell) => { cell.border = { top: { style: "double", color: { argb: "FF884D40" } } }; });
  for (const column of [4, 5, 6, 7, 11, 12, 13]) total.getCell(column).numFmt = currency;
  const info = book.addWorksheet("Report information");
  [
    ["Field", "Value"], ["Issued by", ISSUER], ["Distribution year", year.calendarYear],
    ["Year status", year.status], ["Generated at (UTC)", context.generatedAt],
    ["ENVIRONMENT", context.environment], ["Observed current_database()", context.databaseName],
    ["Observed inet_server_addr()", context.serverAddress ?? "SQL NULL"],
    ["Fixed snapshot", year.snapshotId], ["Snapshot asOf", context.snapshotAsOf],
    ["Rounding residual (cents)", year.calculation?.residualCents ?? "Not recorded"],
    ["Instructions", `on hold: ${year.totals.heldCount}, paid in full: ${year.totals.completeCount}, to pay: ${year.totals.openCount}`],
    ["Date meaning", "Cash date is payment date. APIC letter date is the date the direction letter was received. Reversal date is when the reversal was recorded; its APIC letter date remains the original received date."],
    ["Amounts", "Numeric dollars, currency formatted. Calculations use integer cents; conversion occurs only when writing Excel numeric cells. Negative entries reverse linked prior entries."],
    ["Record basis", year.status === "draft" ? "Open year: not finalized. Missing declared amounts are blank, not zero." : "Finalized snapshot, rates and residences, plus any explicit noted corrections."],
  ].forEach((row) => info.addRow(row));
  styleSheet(info, [34, 110], []);
  if (year.isPractice) {
    for (const sheet of book.worksheets) {
      sheet.insertRow(1, ["PRACTICE"]);
      sheet.mergeCells(1, 1, 1, sheet.columnCount);
      const banner = sheet.getRow(1);
      banner.height = 28;
      banner.getCell(1).font = { bold: true, size: 16, color: { argb: "FF9A2323" } };
      banner.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE7C7" } };
      sheet.views = [{ state: "frozen", ySplit: 2 }];
      sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
