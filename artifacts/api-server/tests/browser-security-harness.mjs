/**
 * DEVELOPMENT-ONLY, loopback-only browser test server. Production-built UI and
 * actual API, local Roster STUB, real private storage, temporary DB tables rolled
 * back on shutdown. Never use this harness as an application service.
 */
import express from "express";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { createWebApp } from "../../hwd-distributions/server.mjs";
import { rosterFixture } from "./roster-fixture.ts";

const h = await stage2Harness();
let signingFixture;
if (process.argv.includes("--mailings") || process.argv.includes("--directions")) {
  const holdings = structuredClone(rosterFixture);
  holdings.holdings.find((r) => r.displayName === "Forster Nancy Anne").email = "nancy@example.test";
  holdings.holdings.find((r) => r.displayName === "Esmond Robert III").email = "robert@example.test";
  h.setHoldings(holdings);
  const fixture = await finalizedFixture(h, { isPractice: true });
  if (process.argv.includes("--directions")) signingFixture = fixture;
} else if (process.argv.includes("--notes")) {
  const fixture = await finalizedFixture(h, { isPractice: true });
  const cookie = await h.login();
  const base = `/api/years/${fixture.detail.id}`;
  h.expect(await h.call("post", `${base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  h.expect(await h.call("post", `${base}/figures`, cookie, { grossCents: "11000000", costs: [{ amountCents: "0" }] }), 201);
} else if (!process.argv.includes("--backup")) {
  const fixture = await finalizedFixture(h);
  await fixture.finalizeWithLedger();
} else {
  await h.login(); // Access-only backup flow needs no extra stored fixture file.
}
if (process.argv.includes("--practice")) {
  const practice = await finalizedFixture(h, { isPractice: true });
  await practice.finalizeWithLedger();
}
process.env.APP_ORIGIN = "http://127.0.0.1:8099";
const test = express();
const writes = [];
const envelopes = [];
if (process.argv.includes("--mailings") || process.argv.includes("--directions")) {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      const payload = JSON.parse(options.body);
      envelopes.push({ to: payload.to, subject: payload.subject, body: payload.text,
        attachments: (payload.attachments ?? []).map((a) => ({ filename: a.filename, size: Buffer.from(a.content, "base64").length })) });
      return new Response(JSON.stringify({ id: `browser-mock-${envelopes.length}` }), { status: 200 });
    }
    return fetchOriginal(url, options);
  };
  test.use((req, res, next) => {
    if (req.method === "POST" && (req.path.endsWith("/mailing/send") || req.path.endsWith("/directions/issue") || req.path.endsWith("/directions/resend") || req.path === "/api/signing/sign")) {
      process.env.RESEND_API_KEY = "browser-test-not-a-real-key";
      res.once("finish", () => { delete process.env.RESEND_API_KEY; });
    }
    next();
  });
}
if (signingFixture) {
  process.env.RESEND_API_KEY = "browser-test-not-a-real-key";
  const { cookie, base, detail } = signingFixture;
  h.expect(await h.call("post", `${base}/mailing`, cookie, { subject: "Tax & Reinvestment Document", body: "Please review the attached notice and sign using the link below.",
    documentIds: [], attachment: "notice", choices: {}, includeSigningLink: true }), 200);
  const view = h.expect(await h.call("get", `${base}/mailing`, cookie), 200);
  h.expect(await h.call("post", `${base}/mailing/send`, cookie, { kind: "preview", draftId: view.draftId,
    personId: detail.holders.find((r) => r.displayName === "Forster Nancy Anne").personId }), 200);
  delete process.env.RESEND_API_KEY;
}
test.use((req, res, next) => {
  if (req.path.startsWith("/api/") && req.method === "POST") res.on("finish", () => {
    writes.push({ path: req.path, status: res.statusCode, originPresent: Boolean(req.get("origin")), originMatches: req.get("origin") === process.env.APP_ORIGIN });
  });
  next();
});
test.get("/__security-test/open-link", (_req, res) => {
  const link = h.getLoggedLink();
  if (!link) { res.sendStatus(404); return; }
  // Redirect internally; never print the link or return it as evidence.
  res.redirect(303, link);
});
test.get("/__security-test/open-signing-link", (_req, res) => {
  const envelope = [...envelopes].reverse().find((e) => e.body.includes("/api/signing/open?token="));
  const raw = envelope?.body.match(/https?:\/\/[^\s]+/)[0];
  if (!raw) { res.sendStatus(404); return; }
  const url = new URL(raw);
  res.redirect(303, url.pathname + url.search);
});
test.get("/__security-test/evidence", async (_req, res) => {
  const sessions = (await h.client.query("SELECT count(*)::int AS n FROM hwd_sessions")).rows[0].n;
  res.json({ source: "LOCAL ROSTER STUB / DEVELOPMENT TEMP TABLES", writes, sessions,
    envelopes: envelopes.map((e) => ({ ...e, body: e.body.replace(/token=[a-f0-9]{64}/g, "token=[REDACTED]") })) });
});
test.use(h.app);
test.use(createWebApp());
const server = test.listen(8099, "127.0.0.1", () => {
  process.stdout.write("SECURITY_BROWSER_READY (local stub; token values withheld)\n");
});
process.once("SIGTERM", async () => {
  server.close();
  if (signingFixture) h.expect(await h.call("post", `${signingFixture.base}/reset-practice`, signingFixture.cookie, { confirmation: "RESET" }), 200);
  await h.finish();
  process.exit(0);
});
