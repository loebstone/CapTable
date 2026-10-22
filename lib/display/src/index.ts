/**
 * Presentation only: preserve every significant digit of a decimal share
 * string. Never parse, round, group, or alter the stored/transmitted value.
 */
export function formatShares(value: string): string {
  const point = value.indexOf(".");
  if (point === -1) return value;
  const fraction = value.slice(point + 1).replace(/0+$/, "");
  return fraction ? `${value.slice(0, point)}.${fraction}` : value.slice(0, point);
}
