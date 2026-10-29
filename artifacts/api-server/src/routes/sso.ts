import { Router, type IRouter } from "express";
import { db, auditLog, sessions } from "@workspace/db";
import { bootstrapOnVerifiedSignIn, eligible } from "../lib/access";
import { append, write } from "../lib/records";
import { COOKIE_NAME, hash, randomToken, signedCookie } from "../lib/auth";
import { authLimit } from "../lib/auth-limits";
import { entryUrl, returnPath, redeemTicket, rosterBase } from "../lib/sso";
import { HttpError } from "../lib/errors";
import { html } from "../lib/reports/format";

const router: IRouter = Router();
// Public navigation only: no ticket or identity is returned by these helpers.
router.get("/auth/roster", (req, res) => {
  res.redirect(303, entryUrl(req, req.query.to ?? "/", req.query.fresh === "1"));
});
router.get("/auth/farm-sign-out", (_req, res) => {
  res.redirect(303, new URL("sign-out", `${rosterBase().href.replace(/\/$/, "")}/`).href);
});
// Anonymous exception: the Roster ticket is the credential, never a management
// cookie. The local list/bootstrap guard is checked again inside the transaction.
router.get("/auth/sso", async (req, res): Promise<void> => {
  let path = "/";
  try {
    authLimit(`sso-ip:${req.ip || "unknown"}`, 20, "Too many sign-in attempts; please wait 15 minutes.", 15 * 60000);
    path = returnPath(req.query.to ?? "/");
    const person = await redeemTicket(req.query.ticket);
    try { await eligible(person.personId); }
    catch {
      await write(person.personId, async (tx) => {
        await tx.insert(auditLog).values({ actor: person.personId, entity: "authentication", operation: "Roster sign-in refused: not on access list", recordId: person.personId });
      });
      throw new HttpError(403, "You're not on the Cap Table access list. Ask Peter.");
    }
    const token = randomToken();
    const cookie = signedCookie(token);
    await write(person.personId, async (tx, actor) => {
      await bootstrapOnVerifiedSignIn(tx, person);
      await append(tx, actor, sessions, {
        personId: person.personId, displayName: person.displayName, email: person.email.trim().toLowerCase(),
        tokenHash: hash(token), authenticatedAt: person.authenticated_at, signInMethod: "roster",
        expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
      }, "Signed in via Roster");
    });
    res.cookie(COOKIE_NAME, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production" || req.secure, sameSite: "lax", path: "/", maxAge: 12 * 3600000 });
    res.redirect(303, path);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    let restart = "/api/auth/roster";
    try { restart = entryUrl(req, path, true); } catch { /* Configuration failures still show a plain refusal. */ }
    res.status(error.status).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HWD Cap Table sign-in</title></head><body><main><h1>HWD Cap Table</h1><p>${html(error.message)}</p><a role="button" href="${html(restart)}">Start again</a></main></body></html>`);
  }
});
export default router;
