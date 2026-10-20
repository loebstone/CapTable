export const ISSUER = "Horace W. Davis Realty Corp.";
export const TAX_CAVEAT = "This is an estimate at the highest rates the Corporation plans on. Your own return may differ, and the Corporation does not give tax advice.";
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
