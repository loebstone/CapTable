import { z } from "zod/v4";
import { HttpError } from "./errors";
import type { StoredHoldings } from "@workspace/db";

const shareClass = z.enum(["A", "B", "C", "D"]);
const decimal = z.string().regex(/^\d{1,6}\.\d{4}$/);
const holdingSchema = z.object({
  personId: z.string().min(1), displayName: z.string().min(1), shareClass,
  shares: decimal, isUnsettled: z.boolean(), note: z.string().nullable(),
  addressState: z.string().nullable(),
});
const holdingsSchema = z.object({
  holdings: z.array(holdingSchema),
  classes: z.array(z.object({
    shareClass, totalShares: decimal, holderCount: z.number().int().nonnegative(),
  })).length(4),
  grandTotal: decimal,
  asOf: z.string().min(1),
});
const identitySchema = z.object({
  allowed: z.boolean(), personId: z.string().nullish(), displayName: z.string().nullish(),
});

export function shareUnits(value: string): bigint {
  if (!/^\d{1,6}\.\d{4}$/.test(value)) throw new HttpError(502, "Roster shares must be four-decimal strings");
  return BigInt(value.replace(".", ""));
}

export function validateHoldings(value: unknown): StoredHoldings {
  const result = holdingsSchema.safeParse(value);
  if (!result.success) throw new HttpError(502, "Roster holdings response does not match the holdings contract");
  const data = result.data;
  const seen = new Set<string>();
  for (const row of data.holdings) {
    const key = `${row.personId}:${row.shareClass}`;
    if (seen.has(key)) throw new HttpError(502, "Roster contains a duplicate person/Class row");
    seen.add(key);
  }
  if (new Set(data.classes.map((c) => c.shareClass)).size !== 4) throw new HttpError(502, "Roster must provide four distinct Class totals");
  let grandTotal = 0n;
  for (const cls of data.classes) {
    const rows = data.holdings.filter((r) => r.shareClass === cls.shareClass);
    const total = rows.reduce((sum, r) => sum + shareUnits(r.shares), 0n);
    if (total !== shareUnits(cls.totalShares)) throw new HttpError(502, `Roster Class ${cls.shareClass} share total does not match its rows`);
    // Headcounts are displayed as reported, never a warning or blocking condition.
    grandTotal += total;
  }
  if (grandTotal !== shareUnits(data.grandTotal)) throw new HttpError(502, "Roster grand total does not match Class totals");
  return data;
}

async function rosterRequest(path: string, body?: object): Promise<unknown> {
  const base = process.env.ROSTER_BASE_URL;
  if (!base) throw new HttpError(503, "ROSTER_BASE_URL is unset. Configure the development Roster URL; no holdings are invented.");
  const key = process.env.DISTRIBUTIONS_SERVICE_KEY;
  if (!key) throw new HttpError(503, "DISTRIBUTIONS_SERVICE_KEY is unset");
  let response: globalThis.Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/service/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
  } catch {
    throw new HttpError(503, "Roster is unreachable; no substitute data was used");
  }
  if (!response.ok) throw new HttpError(502, `Roster request failed (${response.status})`);
  try { return await response.json(); } catch { throw new HttpError(502, "Roster returned invalid JSON"); }
}

export async function signInCheck(email: string) {
  const parsed = identitySchema.safeParse(await rosterRequest("sign-in-check", { email }));
  if (!parsed.success) throw new HttpError(502, "Roster sign-in-check response is invalid");
  if (!parsed.data.allowed || !parsed.data.personId || !parsed.data.displayName) {
    throw new HttpError(403, "Sign-in is not permitted by the Roster");
  }
  return { personId: parsed.data.personId, displayName: parsed.data.displayName };
}

export async function fetchRosterHoldings() {
  return validateHoldings(await rosterRequest("holdings"));
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
export function proposedState(addressState: string | null): string | null {
  if (!addressState?.trim()) return null;
  const code = addressState.trim().toUpperCase();
  return US_STATES.has(code) ? code : "NONE";
}
