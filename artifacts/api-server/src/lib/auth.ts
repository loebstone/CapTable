import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Request } from "express";
import { db, sessions, sessionRevocations } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HttpError } from "./errors";
import { assertAccess } from "./access";
import { publicOrigin } from "./origin";
export { publicOrigin } from "./origin";

export const COOKIE_NAME = "hwd_distributions_session";
export type Identity = { personId: string; displayName: string; email: string; sessionId: number; authenticatedAt: string };
declare global {
  namespace Express { interface Request { identity?: Identity } }
}
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function randomToken() { return randomBytes(32).toString("hex"); }
function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new HttpError(503, "SESSION_SECRET is unset");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function signedCookie(token: string) { return `${token}.${signature(token)}`; }
function validCookie(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [token, sig, extra] = value.split(".");
  if (!token || !sig || extra || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(sig)) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(signature(token))) ? token : null;
}
export const requireAccess: RequestHandler = async (req, _res, next) => {
  try {
    const token = validCookie(req.cookies?.[COOKIE_NAME]);
    if (!token) throw new HttpError(401, "Sign in to HWD Cap Table");
    const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, hash(token))).limit(1);
    if (!session) throw new HttpError(401, "Session has expired; sign in again");
    const [revoked] = await db.select().from(sessionRevocations).where(eq(sessionRevocations.sessionId, session.id)).limit(1);
    if (revoked) throw new HttpError(401, "Session has ended");
    // The Roster establishes identity at sign-in; local active access is the
    // authorization authority on EVERY request, including during a Roster outage.
    await assertAccess(session.personId);
    req.identity = { personId: session.personId, displayName: session.displayName, email: session.email, sessionId: session.id,
      authenticatedAt: session.authenticatedAt ?? session.createdAt };
    // Logout must remain possible even when authentication is stale.
    if (req.path !== "/auth/logout") {
      assertFresh(req.identity.authenticatedAt, 12 * 60);
      if (new Date(session.expiresAt).getTime() <= Date.now()) throw new HttpError(403, "Please sign in again through the Roster to continue.", "reauthenticate");
    }
    next();
  } catch (error) { next(error); }
};
export function assertFresh(authenticatedAt: string, minutes: number, now = Date.now()) {
  const time = Date.parse(authenticatedAt);
  if (!Number.isFinite(time) || time > now + 60000 || now - time > minutes * 60000)
    throw new HttpError(403, minutes === 15
      ? "Please verify your identity again through the Roster before this action. Nothing has been submitted."
      : "Please sign in again through the Roster to continue.", "reauthenticate");
}
export const requireFreshAction: RequestHandler = (req, _res, next) => {
  try { assertFresh(currentIdentity(req).authenticatedAt, 15); next(); } catch (error) { next(error); }
};
export function currentIdentity(req: Request): Identity {
  if (!req.identity) throw new HttpError(401, "Sign in required");
  return req.identity;
}
export const sameOrigin: RequestHandler = (req, _res, next) => {
  try {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    const expected = publicOrigin(req);
    const origin = req.get("origin"), site = req.get("sec-fetch-site");
    if (!origin && site !== "same-origin") throw new HttpError(403, "Write requests require same-origin browser headers");
    if (origin && origin !== expected) throw new HttpError(403, "Cross-origin writes are not allowed");
    if (site === "cross-site") throw new HttpError(403, "Cross-site writes are not allowed");
    next();
  } catch (error) { next(error); }
};
