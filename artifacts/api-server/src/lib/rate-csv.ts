import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { HttpError } from "./errors";
import type { currentRates } from "./rate-data";

const CODES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI NONE FEDERAL").split(" "));
type Table = Awaited<ReturnType<typeof currentRates>>;
export type CsvRate = { line: number; code: string; rate: string; sourceNote: string };

function rateValue(raw: string): string {
  const value = raw.trim();
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(%)?$/.exec(value);
  if (!match || value.length > 100) throw new Error("unparseable rate; use a decimal fraction or a percentage with %");
  const [whole, fraction = ""] = match[2].split(".");
  let numerator = BigInt((whole || "0") + fraction);
  if (match[1] === "-") numerator = -numerator;
  const denominator = 10n ** BigInt(fraction.length) * (match[3] ? 100n : 1n);
  if (numerator < 0n || numerator > denominator) throw new Error("rate is outside 0–1 (0%–100%)");
  // Exact integer arithmetic, matching numeric(6,4) half-up storage precision.
  const scaled = (numerator * 10000n * 2n + denominator) / (denominator * 2n);
  return `${scaled / 10000n}.${(scaled % 10000n).toString().padStart(4, "0")}`;
}

export function parseRateCsv(filename: string, csv: string): CsvRate[] {
  if (!filename.trim() || filename.length > 180 || /[/\\\x00-\x1f\x7f]/.test(filename)) throw new HttpError(400, "Use a filename without paths or control characters");
  if (Buffer.byteLength(csv, "utf8") > 65536) throw new HttpError(413, "CSV file exceeds the 64 KB limit");
  let records: { record: string[]; info: { lines: number } }[];
  try {
    // csv-parse's sync declaration does not specialize its info:true return type.
    records = parse(csv, { bom: true, info: true, skip_empty_lines: true, relax_column_count: true }) as unknown as typeof records;
  } catch (error) {
    const e = error as { lines?: number; code?: string };
    throw new HttpError(400, `Line ${e.lines ?? 1}: malformed CSV (${e.code ?? "invalid quoting"})`);
  }
  const header = records.shift()?.record.map((h) => h.trim());
  if (!header || header.length !== 3 || new Set(header).size !== 3 || !["code", "rate", "source_note"].every((h) => header.includes(h))) {
    throw new HttpError(400, "Line 1: missing or invalid header; expected code,rate,source_note");
  }
  const errors: string[] = [], rows: CsvRate[] = [], seen = new Set<string>();
  for (const { record, info } of records) {
    const line = info.lines;
    if (record.length !== 3) { errors.push(`Line ${line}: expected exactly three columns`); continue; }
    const code = record[header.indexOf("code")].trim(), sourceNote = record[header.indexOf("source_note")];
    if (!CODES.has(code)) errors.push(`Line ${line}: bad code "${code}"; use FEDERAL, NONE, or a valid US state/territory code`);
    if (seen.has(code)) errors.push(`Line ${line}: duplicate code "${code}"`);
    seen.add(code);
    if (!sourceNote.trim()) errors.push(`Line ${line}: source_note is required, as in the rate editor`);
    try {
      const rate = rateValue(record[header.indexOf("rate")]);
      if (code === "NONE" && rate !== "0.0000") errors.push(`Line ${line}: NONE must have a zero rate`);
      rows.push({ line, code, rate, sourceNote });
    } catch (e) { errors.push(`Line ${line}: ${(e as Error).message}`); }
  }
  if (!records.length) errors.push("Line 2: CSV contains no rate rows");
  if (errors.length) throw new HttpError(400, errors.join("\n"));
  return rows;
}

export function previewRows(rows: CsvRate[], current: Table) {
  const previous = new Map(current?.states.map((r) => [r.stateCode, { rate: r.rate, sourceNote: r.sourceNote }]) ?? []);
  if (current) previous.set("FEDERAL", { rate: current.federalRate, sourceNote: current.federalSourceNote });
  if (!current && !rows.some((r) => r.code === "FEDERAL")) throw new HttpError(400, "FEDERAL is required when importing a new tax year");
  return rows.map((row) => {
    const old = previous.get(row.code);
    const status: "new" | "changed" | "unchanged" = !old ? "new" : old.rate === row.rate && old.sourceNote === row.sourceNote ? "unchanged" : "changed";
    return { ...row, currentRate: old?.rate ?? null, status };
  });
}

function digest(input: unknown) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
function sign(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new HttpError(503, "SESSION_SECRET is required");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
export function previewToken(actor: string, input: unknown, table: Table) {
  const payload = Buffer.from(JSON.stringify({ actor, input: digest(input), table: digest(table), expires: Date.now() + 15 * 60_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function verifyPreview(token: string, actor: string, input: unknown, table: Table) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new HttpError(400, "Preview this CSV before confirming");
  const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HttpError(400, "Invalid CSV preview confirmation");
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new HttpError(400, "Invalid CSV preview confirmation"); }
  if (data.actor !== actor || data.input !== digest(input)) throw new HttpError(400, "CSV or tax year changed; preview it again");
  if (data.expires < Date.now()) throw new HttpError(409, "CSV preview expired; preview it again");
  if (data.table !== digest(table)) throw new HttpError(409, "This year's rates changed after the preview; preview again before confirming");
}
export function ratesCsv(table: NonNullable<Table>) {
  return stringify([
    ["code", "rate", "source_note"],
    ["FEDERAL", table.federalRate, table.federalSourceNote],
    ...table.states.map((s) => [s.stateCode, s.rate, s.sourceNote]),
  ], { record_delimiter: "\r\n" });
}
