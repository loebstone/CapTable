// Exact cents handling. Never touches floating point.

/** "123456" | "-50" -> "$1,234.56" | "−$0.50" */
export function fmtCents(v: string | null | undefined, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  if (!/^-?\d+$/.test(v)) return v;
  let n = BigInt(v);
  const neg = n < 0n;
  if (neg) n = -n;
  const dollars = (n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (n % 100n).toString().padStart(2, "0");
  const sign = neg ? "\u2212" : opts.signed && n > 0n ? "+" : "";
  return `${sign}$${dollars}.${cents}`;
}

/** Parse "1,234.5" -> "123450". Returns null when not a valid amount. */
export function parseDollars(input: string, allowNegative = false): string | null {
  const s = input.replace(/[$,\s]/g, "");
  const re = allowNegative ? /^(-?)(\d{1,13})(?:\.(\d{0,2}))?$/ : /^()(\d{1,13})(?:\.(\d{0,2}))?$/;
  const m = s.match(re);
  if (!m) return null;
  const cents = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  if (cents === 0n && m[1]) return "0";
  return (m[1] ? -cents : cents).toString();
}

/** "123450" -> "1234.50" for prefilling inputs */
export function centsToInput(v: string | null | undefined): string {
  if (!v || !/^-?\d+$/.test(v)) return "";
  let n = BigInt(v);
  const neg = n < 0n;
  if (neg) n = -n;
  return `${neg ? "-" : ""}${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export function sumCents(xs: (string | null | undefined)[]): string {
  return xs.reduce<bigint>((a, x) => a + (x && /^-?\d+$/.test(x) ? BigInt(x) : 0n), 0n).toString();
}

export function isNeg(v: string | null | undefined) {
  return !!v && v.startsWith("-");
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
