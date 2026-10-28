import type { Request } from "express";
import { z } from "zod/v4";
import { HttpError } from "./errors";
import { configuredOrigin } from "./origin";

// Repeated decoding rejects encoded network paths, backslashes and controls.
// The original path/query is preserved, not normalized into an external URL.
export function returnPath(value: unknown = "/"): string {
  if (typeof value !== "string" || value.length > 2048) throw new HttpError(400, "Invalid return path");
  let decoded = value;
  for (let n = 0; n < 5; n++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded))
      throw new HttpError(400, "Invalid return path");
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { throw new HttpError(400, "Invalid return path"); }
    if (next === decoded) return value;
    decoded = next;
  }
  throw new HttpError(400, "Invalid return path");
}
export function rosterBase() {
  if (!process.env.ROSTER_BASE_URL) throw new HttpError(503, "ROSTER_BASE_URL is unset; Roster sign-in is unavailable.");
  const base = new URL(process.env.ROSTER_BASE_URL);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new HttpError(503, "ROSTER_BASE_URL is not a valid Roster URL");
  return base;
}
export function entryUrl(req: Request, path: unknown = "/", fresh = false) {
  const origin = configuredOrigin();
  if (!origin) throw new HttpError(503, "APP_ORIGIN is required for Roster sign-in, including development; register this origin in the Roster.");
  const url = new URL("sign-in", `${rosterBase().href.replace(/\/$/, "")}/`);
  url.searchParams.set("app", "captable");
  url.searchParams.set("to", returnPath(path));
  url.searchParams.set("origin", origin);
  if (fresh) url.searchParams.set("fresh", "1");
  return url.href;
}
const ticketIdentity = z.object({
  personId: z.string().min(1), displayName: z.string().min(1),
  email: z.string().email(), goes_by: z.string().nullable().optional(),
  rosterAdmin: z.boolean(), role: z.string().nullable(),
  authenticated_at: z.string().datetime({ offset: true }),
});
export async function redeemTicket(ticket: unknown) {
  if (typeof ticket !== "string" || !ticket || ticket.length > 4096 || /[\u0000-\u0020\u007f]/.test(ticket))
    throw new HttpError(401, "This sign-in ticket is invalid or expired.");
  const key = process.env.DISTRIBUTIONS_SERVICE_KEY;
  if (!key) throw new HttpError(503, "DISTRIBUTIONS_SERVICE_KEY is unset");
  let response: globalThis.Response;
  try {
    response = await fetch(new URL("api/service/sso-redeem", `${rosterBase().href.replace(/\/$/, "")}/`), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  } catch { throw new HttpError(503, "The Roster is unavailable. Please try signing in again."); }
  if (response.status === 401) throw new HttpError(401, "This sign-in ticket is invalid, expired, or already used.");
  if (!response.ok) throw new HttpError(503, "The Roster could not verify this sign-in.");
  const result = ticketIdentity.safeParse(await response.json().catch(() => null));
  if (!result.success || Date.parse(result.data.authenticated_at) > Date.now() + 60000)
    throw new HttpError(502, "The Roster returned an invalid sign-in response.");
  return result.data;
}
