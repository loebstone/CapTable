import { Router, type IRouter } from "express";
import { publicOrigin } from "../lib/origin";
import { authLimit } from "../lib/auth-limits";
import { hash } from "../lib/auth";
import { continueSigning, DIRECTION_COOKIE, findSigningToken, signDocument, signingSessionView, tokenMessage } from "../lib/direction-signing";
import { tokenState } from "../lib/direction-links";
import { escapeHtml } from "../lib/direction-rules";
import { db } from "@workspace/db";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.get("/signing/open", async (req, res): Promise<void> => {
  authLimit(`direction-open:${req.ip}`, 30, "Too many attempts; please wait a minute.");
  try {
    const token = await findSigningToken(req.query.token), state = await tokenState(db, token);
    if (state !== "ready") { res.status(410).type("text/plain").send(tokenMessage(state)); return; }
    // As on the magic-link landing page: no-referrer makes Chromium send
    // Origin:null for native form POSTs. strict-origin preserves the CSRF
    // Origin while never forwarding the token-bearing path/query.
    res.setHeader("Referrer-Policy", "strict-origin");
    // GET returns no shareholder data and never consumes a token. No scripts,
    // external resources, analytics, automatic POSTs or redirect scanners.
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Continue</title><style>body{margin:0;padding:30vh 24px;background:#f8f5ef;text-align:center}button{padding:16px 28px;background:#172b31;color:#fff;border:0;border-radius:5px;font:18px system-ui;cursor:pointer}</style></head><body><form method="post" action="${escapeHtml(publicOrigin(req))}/api/signing/continue"><input type="hidden" name="token" value="${escapeHtml(String(req.query.token))}"><button type="submit">Continue</button></form></body></html>`);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 410) throw error;
    res.status(410).type("text/plain").send("This signing link is no longer valid.");
  }
});
router.post("/signing/continue", async (req, res): Promise<void> => {
  authLimit(`direction-continue-ip:${req.ip}`, 30, "Too many attempts; please wait a minute.");
  authLimit(`direction-continue-token:${hash(String(req.body?.token ?? ""))}`, 10, "Too many attempts; please wait a minute.");
  const secret = await continueSigning(req.body?.token, req.ip ?? "", req.get("user-agent") ?? "");
  res.cookie(DIRECTION_COOKIE, secret, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/signing", maxAge: 30 * 60000 });
  res.redirect(303, `${publicOrigin(req)}/sign-direction`);
});
router.get("/signing/session", async (req, res): Promise<void> => {
  res.json(await signingSessionView(req.cookies?.[DIRECTION_COOKIE]));
});
router.post("/signing/sign", async (req, res): Promise<void> => {
  authLimit(`direction-sign-ip:${req.ip}`, 20, "Too many attempts; please wait a minute.");
  authLimit(`direction-sign-session:${hash(String(req.cookies?.[DIRECTION_COOKIE] ?? ""))}`, 10, "Too many attempts; please wait a minute.");
  res.json(await signDocument(req.cookies?.[DIRECTION_COOKIE], req.body, req.ip ?? "", req.get("user-agent") ?? ""));
});
export default router;
