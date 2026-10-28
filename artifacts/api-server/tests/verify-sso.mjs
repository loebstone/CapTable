/**
 * DEVELOPMENT ONLY: real Express/Postgres, transaction-local tables, mocked
 * Roster tickets and email. No existing sessions/access rows are changed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { stage2Harness } from "./stage2-harness.mjs";
const h = await stage2Harness();
const { client, call, expect, record, app } = h;
const realFetch = globalThis.fetch;
const frontend = new URL("../../hwd-distributions/src/", import.meta.url);
const gateSource = await readFile(new URL("App.tsx", frontend), "utf8");
const signInSource = await readFile(new URL("pages/sign-in.tsx", frontend), "utf8");
const reauthSource = await readFile(new URL("components/reauthenticate.tsx", frontend), "utf8");
assert.match(gateSource, /window\.location\.replace\(rosterEntry\(\)\)/);
assert.match(gateSource, /session\.isLoading \|\| anonymous\) return null/);
assert.match(gateSource, /path="\/sign-in"><SignIn \/><\/Route>/);
assert.match(signInSource, /Sign in to HWD Cap Table/);
assert.match(reauthSource, /For this step we need to confirm it's you — we'll email you a fresh link\./);
assert.match(reauthSource, />Confirm it's me<\/a>/);
assert.doesNotMatch(reauthSource, /through the Roster/);
record("Seamless hand-off display contract", "Protected pages redirect without intermediate screen; direct sign-in and freshness wording are neutral");
const { hash, randomToken, signedCookie, assertFresh } = await import("../src/lib/auth.ts");
const { returnPath, entryUrl } = await import("../src/lib/sso.ts");
let rosterMode = "normal", redeemCalls = 0;
const tickets = new Map();
function ticket(id, overrides = {}) {
  tickets.set(id, { personId: "test-bootstrap", displayName: "Test Bootstrap", email: "bootstrap@example.test",
    goes_by: "Test", rosterAdmin: false, role: null, authenticated_at: new Date().toISOString(), ...overrides });
  return id;
}
globalThis.fetch = async (url, options) => {
  if (!String(url).endsWith("/api/service/sso-redeem")) return realFetch(url, options);
  redeemCalls++;
  assert.equal(options.redirect, "error"); assert.ok(options.signal);
  assert.equal(options.headers.Authorization, `Bearer ${process.env.DISTRIBUTIONS_SERVICE_KEY}`);
  if (rosterMode === "unreachable") throw new Error("simulated outage");
  if (rosterMode === "redirect") throw new TypeError("redirect forbidden");
  const id = JSON.parse(options.body).ticket;
  const identity = tickets.get(id); tickets.delete(id); // single use, Roster-owned
  return identity ? new Response(JSON.stringify(identity), { status: 200 }) : new Response(null, { status: 401 });
};
let ipIndex = 1;
const callback = (id, path = "/", ip) => request(app).get("/auth/sso").query({ ticket: id, to: path }).set("X-Forwarded-For", ip ?? `192.0.2.${ipIndex++}`);
const cookieOf = (r) => r.headers["set-cookie"].map((x) => x.split(";")[0]).join("; ");
const count = async (table) => (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
async function fixtureSession(minutes, legacy = false, overrides = {}) {
  const token = randomToken(), created = new Date(Date.now() - minutes * 60000).toISOString();
  await client.query(`INSERT INTO hwd_sessions(token_hash,person_id,email,display_name,created_at,expires_at,authenticated_at,sign_in_method)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
    hash(token), overrides.personId ?? "test-bootstrap", "bootstrap@example.test", "Test Bootstrap", created,
    new Date(Date.now() + 3600000).toISOString(), legacy ? null : created, legacy ? null : "roster",
  ]);
  return `hwd_distributions_session=${signedCookie(token)}`;
}
try {
  await h.seedAccess();
  const before = await client.query("SELECT row_to_json(s) AS row FROM hwd_sessions s ORDER BY id");
  ticket("valid"); const signed = await callback("valid", "/years?view=practice");
  expect(signed, 303); assert.equal(signed.headers.location, "/years?view=practice");
  const cookie = cookieOf(signed);
  const session = (await client.query("SELECT * FROM hwd_sessions ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(session.sign_in_method, "roster"); assert.equal(new Date(session.authenticated_at).toISOString(), session.authenticated_at.toISOString());
  expect(await call("get", "/api/auth/session", cookie), 200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE operation='Signed in via Roster'")).rows[0].n, 1);
  assert.match(signed.headers["set-cookie"][0], /HttpOnly/); assert.match(signed.headers["set-cookie"][0], /SameSite=Lax/);
  record("Valid ticket + active local access", { status: 303, redirect: signed.headers.location, method: session.sign_in_method, authenticatedAtStored: true, audited: true });

  ticket("outsider", { personId: "not-local", rosterAdmin: true, role: "admin" });
  const noAccess = await callback("outsider"); expect(noAccess, 403);
  assert.match(noAccess.text.replaceAll("&#39;", "'"), /You're not on the Cap Table access list\. Ask Peter\./);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE operation='Roster sign-in refused: not on access list'")).rows[0].n, 1);
  record("Roster admin without local access", "403 exact refusal; audited; Roster role does not confer access");
  for (const id of ["invalid", "expired", "valid"]) { expect(await callback(id), 401); }
  record("Invalid, expired and replayed tickets", "401; no new session cookie; restart page");
  const callsBefore = redeemCalls;
  for (const value of ["https://evil.test", "//evil.test", "/\\evil", "/%2f%2fevil", "/%255cevil", "/%0aevil", " /", "/%bad"]) {
    expect(await callback(ticket(`unsafe-${ipIndex}`), value), 400);
  }
  assert.equal(redeemCalls, callsBefore);
  for (const value of ["/", "/years/12", "/years?view=practice"]) assert.equal(returnPath(value), value);
  record("Return paths", "8 unsafe/encoded/control paths rejected before redemption; normal local paths preserved");
  rosterMode = "unreachable"; expect(await callback("outage"), 503);
  rosterMode = "redirect"; expect(await callback("redirect"), 503);
  rosterMode = "normal";
  record("Unreachable / redirect", "Both fail closed 503; 10s AbortSignal, redirect:error asserted");

  const old = await fixtureSession(12 * 60 + 1);
  const staleEntry = await call("get", "/api/auth/session", old);
  expect(staleEntry, 403); assert.equal(staleEntry.body.code, "reauthenticate");
  const recentLegacy = await fixtureSession(5, true);
  expect(await call("get", "/api/auth/session", recentLegacy), 200);
  expect(await call("get", "/api/auth/session", await fixtureSession(721, true)), 403);
  const staleAction = await fixtureSession(16);
  expect(await call("get", "/api/auth/session", staleAction), 200);
  const sensitive = ["/payments", "/reversals", "/holds", "/reset-practice", "/directions/123/confirm",
    "/directions/paper", "/directions/issue", "/directions/resend", "/directions/remind", "/mailing/send"];
  const auditsBefore = await count("audit_log"), entriesBefore = await count("distribution_entries");
  for (const route of sensitive) {
    const result = await call("post", `/api/years/999999${route}`, staleAction, {});
    expect(result, 403); assert.equal(result.body.code, "reauthenticate", route);
  }
  assert.equal(await count("audit_log"), auditsBefore); assert.equal(await count("distribution_entries"), entriesBefore);
  const now = Date.now();
  assert.doesNotThrow(() => assertFresh(new Date(now - 900000).toISOString(), 15, now));
  assert.throws(() => assertFresh(new Date(now - 900001).toISOString(), 15, now));
  assert.doesNotThrow(() => assertFresh(new Date(now - 43200000).toISOString(), 720, now));
  record("Freshness and legacy fallback", { entry: "12h+1m -> 403 reauthenticate", sensitiveActions: sensitive.length,
    action: "16m -> 403 reauthenticate before mutation", legacy: "5m accepted / 721m reauthenticate", boundaries: "exact threshold accepted, +1ms refused" });
  expect(await call("post", "/api/auth/logout", old, {}), 200);
  record("Stale session logout", "Allowed; explicit logout revokes only that test session");

  // Local email back door: no bootstrap, no role. Known active identity works
  // without any Roster request, and redemption records its own verify time.
  const allBefore = await count("magic_links");
  const noLocal = await call("post", "/api/auth/link", null, { email: "other@example.test" });
  expect(noLocal, 200); assert.equal(await count("magic_links"), allBefore);
  const magic = await h.login(); expect(await call("get", "/api/auth/session", magic), 200);
  const magicSession = (await client.query("SELECT sign_in_method,authenticated_at FROM hwd_sessions ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(magicSession.sign_in_method, "magic-link"); assert.ok(magicSession.authenticated_at);
  record("Back door active-members only", "Nonmember -> neutral 200/no link; active member -> magic-link session with verify timestamp");
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Roster down"); };
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(await call("post", "/api/auth/link", null, { email: "bootstrap@example.test" }), 200);
  globalThis.fetch = savedFetch;
  record("Back door during outage", "Previously verified local email mapping permits active member's link; no Roster call");
  const revokedCookie = await fixtureSession(1, false, { personId: "not-local" });
  expect(await call("get", "/api/auth/session", revokedCookie), 403);
  record("Active local membership on every session", "Signed session for nonmember -> 403");
  const url = entryUrl({} , "/years/42", true);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("app"), "captable"); assert.equal(parsed.searchParams.get("fresh"), "1");
  assert.equal(parsed.searchParams.get("origin"), process.env.APP_ORIGIN);
  record("Exact STUB entry URL", url);
  const prior = (await client.query("SELECT row_to_json(s) AS row FROM hwd_sessions s ORDER BY id")).rows.slice(0, before.rows.length);
  assert.deepEqual(prior, before.rows);
  for (let i = 0; i < 21; i++) expect(await callback("invalid", "/", "198.51.100.222"), i < 20 ? 401 : 429);
  record("SSO rate limit", "20 failures allowed per real-address bucket / 15m; 21st -> 429");
} finally {
  globalThis.fetch = realFetch;
  await h.finish();
}
