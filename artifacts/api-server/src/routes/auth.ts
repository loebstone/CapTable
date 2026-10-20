import { Router, type IRouter } from "express";
import { db, magicLinks, linkConsumptions, sessions, sessionRevocations } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { RequestSignInBody, VerifySignInQueryParams, GetSessionResponse } from "@workspace/api-zod";
import { signInCheck } from "../lib/roster";
import { eligible, bootstrapOnVerifiedSignIn } from "../lib/access";
import { append, write } from "../lib/records";
import { hash, randomToken, requireAccess, currentIdentity, signedCookie, COOKIE_NAME, publicOrigin } from "../lib/auth";
import { HttpError } from "../lib/errors";
import { authLimit } from "../lib/auth-limits";
import { html } from "../lib/reports/format";

const router: IRouter = Router();

router.post("/auth/link", async (req, res): Promise<void> => {
  const data = RequestSignInBody.parse(req.body);
  const email = data.email.trim().toLowerCase();
  authLimit(`request-ip:${req.ip || "unknown"}`, 20);
  const person = await signInCheck(email);
  await eligible(person.personId);
  const key = process.env.RESEND_API_KEY;
  const production = process.env.NODE_ENV === "production";
  if (!key && production) throw new HttpError(503, "RESEND_API_KEY is required in production; email cannot be sent");
  if (key && !process.env.RESEND_FROM_EMAIL) throw new HttpError(503, "RESEND_FROM_EMAIL is unset; set a verified Resend sender address");
  if (!process.env.SESSION_SECRET) throw new HttpError(503, "SESSION_SECRET is unset");
  const token = randomToken();
  await write(person.personId, async (tx, actor) => {
    const [previous] = await tx.select().from(magicLinks).where(eq(magicLinks.email, email)).orderBy(desc(magicLinks.id)).limit(1);
    if (previous && Date.now() - new Date(previous.createdAt).getTime() < 1000) throw new HttpError(429, "Please wait before requesting another link");
    await append(tx, actor, magicLinks, {
      ...person, email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    });
  });
  const url = `${publicOrigin(req)}/api/auth/verify?token=${token}`;
  if (!key && !production) {
    // DEVELOPMENT ONLY, explicitly requested. Never return the URL to the browser.
    req.log.warn({ magicLink: url }, "DEVELOPMENT ONLY: RESEND_API_KEY unset; magic link logged, no email sent");
  } else {
    let sent: globalThis.Response;
    try {
      sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL, to: [email],
          subject: "Sign in to HWD Distributions",
          text: `Sign in to HWD Distributions:\n\n${url}\n\nThis single-use link expires in 15 minutes. If you did not request it, ignore this email.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { throw new HttpError(502, "Resend is unreachable; email was not confirmed sent"); }
    if (!sent.ok) throw new HttpError(502, "Resend could not send the sign-in email; check the sender and API key");
  }
  res.json({ message: !key && !production ? "Development only: sign-in link written to the server log; no email sent." : "Check your email for a sign-in link." });
});

router.get("/auth/verify", async (req, res): Promise<void> => {
  // no-referrer makes Chromium send Origin:null for native form POSTs.
  // strict-origin keeps Origin intact without disclosing the token-bearing URL.
  res.setHeader("Referrer-Policy", "strict-origin");
  const { token } = VerifySignInQueryParams.parse(req.query);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Invalid or expired sign-in link");
  // A GET (including an email preview/scanner) never consumes a token or creates a session.
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
    <title>Continue to HWD Cap Table</title><style>
    body{font:17px system-ui,sans-serif;background:#f8f5ef;color:#172b31;margin:0;padding:12vh 24px}
    main{max-width:440px;margin:auto}button{font:inherit;padding:14px 20px;background:#172b31;color:white;border:0;border-radius:6px;cursor:pointer}
    </style></head><body><main><h1>HWD Farm</h1><p>Continue to complete your sign-in. This single-use link expires 15 minutes after it was requested.</p>
    <form method="post" action="${html(publicOrigin(req))}/api/auth/verify">
    <input type="hidden" name="token" value="${token}"><button type="submit">Continue to HWD Cap Table</button>
    </form></main></body></html>`);
});

router.post("/auth/verify", async (req, res): Promise<void> => {
  authLimit(`redeem-ip:${req.ip || "unknown"}`, 10);
  const { token } = VerifySignInQueryParams.parse(req.body);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Invalid or expired sign-in link");
  authLimit(`redeem-token:${hash(token)}`, 10);
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash(token))).limit(1);
  if (!link || new Date(link.expiresAt).getTime() <= Date.now()) throw new HttpError(401, "Invalid or expired sign-in link");
  const [consumed] = await db.select().from(linkConsumptions).where(eq(linkConsumptions.linkId, link.id)).limit(1);
  if (consumed) throw new HttpError(401, "This sign-in link has already been used");
  const person = await signInCheck(link.email);
  if (person.personId !== link.personId) throw new HttpError(403, "Roster identity no longer matches this link");
  const sessionToken = randomToken();
  const cookie = signedCookie(sessionToken);
  await write(person.personId, async (tx, actor) => {
    const [used] = await tx.select().from(linkConsumptions).where(eq(linkConsumptions.linkId, link.id)).limit(1);
    if (used) throw new HttpError(401, "This sign-in link has already been used");
    await bootstrapOnVerifiedSignIn(tx, person);
    await append(tx, actor, linkConsumptions, { linkId: link.id });
    await append(tx, actor, sessions, {
      ...person, email: link.email, tokenHash: hash(sessionToken), expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
  });
  res.cookie(COOKIE_NAME, cookie, {
    httpOnly: true, secure: process.env.NODE_ENV === "production" || req.secure,
    sameSite: "lax", path: "/", maxAge: 12 * 3600000,
  });
  res.redirect(303, "/");
});

router.get("/auth/session", requireAccess, async (req, res): Promise<void> => {
  const [identity] = (await db.execute(sql`SELECT current_database() AS "databaseName", inet_server_addr()::text AS "serverAddress"`)).rows;
  res.json(GetSessionResponse.parse({
    ...currentIdentity(req),
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    ...identity,
  }));
});
router.post("/auth/logout", requireAccess, async (req, res): Promise<void> => {
  const person = currentIdentity(req);
  await write(person.personId, async (tx, actor) => {
    await append(tx, actor, sessionRevocations, { sessionId: person.sessionId });
  });
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ message: "Signed out" });
});

export default router;
