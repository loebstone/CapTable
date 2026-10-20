import { format, parseISO } from "date-fns";

export function errStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export function isAuthError(err: unknown) {
  const s = errStatus(err);
  return s === 401 || s === 403;
}

export function errMessage(err: unknown): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.message === "string") return d.message;
    if (typeof d.error === "string") return d.error;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function fmtDate(v: string | null | undefined, withTime = false) {
  if (!v) return "—";
  try {
    return format(parseISO(v), withTime ? "d MMM yyyy, HH:mm" : "d MMM yyyy");
  } catch {
    return v;
  }
}

export const RATE_RE = /^(0\.\d{4}|1\.0000)$/;
export const STATE_RE = /^(NONE|[A-Z]{2})$/;

export function ratePct(rate: string) {
  if (!RATE_RE.test(rate)) return null;
  const units = BigInt(rate.replace(".", ""));
  return `${units / 100n}.${String(units % 100n).padStart(2, "0")}%`;
}
