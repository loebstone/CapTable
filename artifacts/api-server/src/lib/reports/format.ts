export const ISSUER = "Horace W. Davis Realty Corp.";
export const LEGACY_TAX_CAVEAT = "This is an estimate at the highest rates the Corporation plans on. Your own return may differ, and the Corporation does not give tax advice.";
export const TAX_CAVEAT = "These are estimates at the rates shown. Your own tax depends on your filing status, your income and your state's brackets; California, for example, taxes gains at its ordinary-income rates, and the federal net investment income tax applies only above an income threshold. Your return may differ.";
export function html(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
export function dollars(cents: string | bigint | null) {
  if (cents === null) return "Not recorded";
  const amount = BigInt(cents), abs = amount < 0n ? -amount : amount;
  const whole = String(abs / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0n ? "−" : ""}$${whole}.${String(abs % 100n).padStart(2, "0")}`;
}
export function percent(rate: string | null) {
  if (rate === null) return "Missing";
  const units = BigInt(rate.replace(".", ""));
  return `${units / 100n}.${String(units % 100n).padStart(2, "0")}%`;
}
export function dateLabel(date: string | null) { return date === null ? "Not recorded" : date; }
