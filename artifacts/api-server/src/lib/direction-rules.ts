import { z } from "zod/v4";
import { HttpError } from "./errors";

export const CONSENT_TEXT = "I intend to sign this document electronically, and I agree to receive Corporation documents by email. I may request paper copies at any time.";
export const DIRECTION_VERSION = 1;
export const DIRECTION_TEXT = `HORACE W. DAVIS REALTY CORP.
TAX & REINVESTMENT DOCUMENT
Direction to retain as additional paid-in capital

I, [Full name], a shareholder of Horace W. Davis Realty Corp., direct the Corporation to retain $[amount] of the distribution declared by Horace W. Davis Realty Corp. on [board approval date] as additional paid-in capital.

Signed electronically by: [Typed full name]
Date: [date of signing]`;
export const signatureInput = z.object({
  amountCents: z.string().regex(/^\d{1,15}$/), fullName: z.string().trim().min(1).max(160).refine((s) => !/[\u0000-\u001f]/.test(s), "Full name must be one line"), consent: z.literal(true),
});
export const paperInput = z.object({
  personId: z.string().min(1), amountCents: z.string().regex(/^\d{1,15}$/),
  receivedDate: z.string(), documentId: z.number().int().positive().optional(), note: z.string().max(2000).optional(),
});
export function assertDirectionAmount(amount: string, maximum: string | null) {
  if (!/^\d{1,15}$/.test(amount) || maximum === null || BigInt(amount) > BigInt(maximum)) {
    throw new HttpError(400, "The amount must be between $0.00 and this holder's distribution, inclusive.");
  }
  return BigInt(amount);
}
export function dollars(cents: string | bigint) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
export function money(cents: string | bigint) {
  const [whole, fraction] = dollars(cents).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function nyDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
export function fillDirection(text: string, values: { holderName: string; amount: string; boardApprovalDate: string; typedName: string; date: string }) {
  const fields: Record<string, string> = { "Full name": values.holderName, amount: values.amount, "board approval date": values.boardApprovalDate, "Typed full name": values.typedName, "date of signing": values.date };
  return text.replace(/\[(Full name|amount|board approval date|Typed full name|date of signing)\]/g, (_m, key: string) => fields[key]);
}
export function directionPage(text: string, practice: boolean) {
  const [heading, body, signing] = text.split("\n\n");
  const lines = heading.split("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:Letter;margin:.65in}*{box-sizing:border-box}body{font:16px/1.65 Georgia,serif;color:#162c32}
  .sheet{width:100%;position:relative}h1{font:600 25px/1.3 Arial,sans-serif;margin:12px 0 5px}header{border-bottom:2px solid #a65f49;padding-bottom:20px;margin-bottom:45px}
  .issuer{font:12px Arial,sans-serif;letter-spacing:1px}p{white-space:pre-wrap;margin:35px 0}.sign{margin-top:65px}
  .watermark{position:fixed;top:43%;left:0;width:100%;text-align:center;transform:rotate(-32deg);font:30px Arial,sans-serif;color:rgba(140,60,40,.17)}
  </style></head><body><main class="sheet">${practice ? '<div class="watermark">PRACTICE — NOT A STATEMENT</div>' : ""}
  <header><div class="issuer">${escapeHtml(lines[0])}</div><h1>${escapeHtml(lines[1])}</h1><div>${escapeHtml(lines.slice(2).join("\n"))}</div></header>
  <p>${escapeHtml(body)}</p><p class="sign">${escapeHtml(signing)}</p></main></body></html>`;
}
export function evidencePage(rows: [string, string][], practice: boolean) {
  return directionPage(`HORACE W. DAVIS REALTY CORP.\nSignature evidence\nTax & Reinvestment Document\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n`, practice);
}
