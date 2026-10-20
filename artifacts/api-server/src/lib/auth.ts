import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Request } from "express";
import { db, sessions, sessionRevocations } from "@workspace/db";
import { eq } from "drizzle-orm";
import { HttpError } from "./errors";
import { signInCheck } from "./roster";
import { assertAccess } from "./access";
import { publicOrigin } from "./origin";
export { publicOrigin } from "./origin";

export const COOKIE_NAME = "hwd_distributions_session";
export type Identity = { personId: string; displayName: string; email: string; sessionId: number };
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
    if (!token) throw new HttpError(401, "Sign in to HWD Distributions");
    const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, hash(token))).limit(1);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) throw new HttpError(401, "Session has expired; sign in again");
    const [revoked] = await db.select().from(sessionRevocations).where(eq(sessionRevocations.sessionId, session.id)).limit(1);
    if (revoked) throw new HttpError(401, "Session has ended");
    // No authorization cache: Roster and the local list are checked on EVERY protected request.
    const person = await signInCheck(session.email);
    if (person.personId !== session.personId) throw new HttpError(403, "Roster identity has changed; sign in again");
    await assertAccess(person.personId);
    req.identity = { ...person, email: session.email, sessionId: session.id };
    next();
  } catch (error) { next(error); }
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
