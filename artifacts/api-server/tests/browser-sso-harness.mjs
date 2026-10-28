/**
 * Loopback-only development browser harness. Real API + built frontend;
 * rollback-local tables and stub Roster. No external requests or emails.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { stage2Harness } from "./stage2-harness.mjs";
import { createWebApp } from "../../hwd-distributions/server.mjs";
const h = await stage2Harness();
await h.seedAccess();
process.env.APP_ORIGIN = "http://127.0.0.1:8099";
process.env.ROSTER_BASE_URL = "http://127.0.0.1:8099/roster";
const originalFetch = globalThis.fetch;
const tickets = new Map();
globalThis.fetch = async (url, options) => {
  if (String(url) !== "http://127.0.0.1:8099/roster/api/service/sso-redeem") throw new Error("Browser harness blocks outside network");
  const id = JSON.parse(options.body).ticket;
  const identity = tickets.get(id); tickets.delete(id);
  return identity ? new Response(JSON.stringify(identity), { status: 200 }) : new Response(null, { status: 401 });
};
const test = express();
test.get("/roster/sign-in", (req, res) => {
  const id = randomUUID();
  tickets.set(id, { personId: "test-bootstrap", displayName: "Test Bootstrap", email: "bootstrap@example.test",
    goes_by: null, rosterAdmin: false, role: null, authenticated_at: new Date().toISOString() });
  res.redirect(303, `/auth/sso?${new URLSearchParams({ ticket: id, to: req.query.to ?? "/" })}`);
});
test.get("/roster/sign-out", (_req, res) => res.type("text").send("Farm sign-out reached (STUB)"));
test.get("/__sso-test/stale", async (req, res) => {
  // New synthetic sessions only; never update a pre-existing session.
  const { randomToken, hash, signedCookie, COOKIE_NAME } = await import("../src/lib/auth.ts");
  const token = randomToken(), minutes = req.query.entry ? 721 : 16;
  const time = new Date(Date.now() - minutes * 60000).toISOString();
  await h.client.query(`INSERT INTO hwd_sessions(token_hash,person_id,email,display_name,created_at,authenticated_at,expires_at,sign_in_method)
    VALUES($1,'test-bootstrap','bootstrap@example.test','Test Bootstrap',$2,$2,$3,'roster')`,
  [hash(token), time, new Date(Date.now() + 3600000).toISOString()]);
  res.cookie(COOKIE_NAME, signedCookie(token), { httpOnly: true, sameSite: "lax", path: "/" });
  res.redirect(303, "/years");
});
test.get("/__sso-test/money", (_req, res) => res.type("html").send(`<!doctype html><html><body>
  <button id="blocked">Attempt protected action</button><div id="result"></div>
  <script>document.querySelector('#blocked').onclick=async()=>{const r=await fetch('/api/years/999/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});document.querySelector('#result').textContent=r.status+' '+await r.text()}</script>
  </body></html>`));
test.get("/__security-test/open-link", (_req, res) => {
  const link = h.getLoggedLink();
  if (!link) { res.sendStatus(404); return; }
  res.redirect(303, link);
});
test.use(h.app);
test.use(createWebApp());
const server = test.listen(8099, "127.0.0.1", () => console.log("SSO browser harness READY http://127.0.0.1:8099; STUB ONLY"));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  globalThis.fetch = originalFetch;
  await h.finish();
  process.exit(0);
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
