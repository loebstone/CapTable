/**
 * DEVELOPMENT-ONLY integration verification against a local Roster STUB.
 * All database writes are wrapped in one outer transaction and ROLLED BACK.
 * No app fixture seed or persisted environment-variable edits.
 * Run: pnpm --filter @workspace/api-server run verify:stage1
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import request from "supertest";
import pino from "pino";
import { rosterFixture } from "./roster-fixture.ts";
import { isolateTables } from "./isolate-tables.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Verification is forbidden in production");
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.DISTRIBUTIONS_SERVICE_KEY = randomBytes(32).toString("hex");
process.env.BOOTSTRAP_PERSON_ID = "test-bootstrap";
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
process.env.APP_ORIGIN = "http://hwd-verification.test";

let currentHoldings = structuredClone(rosterFixture);
const rosterCalls = [];
let allowBootstrap = true;
const stub = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.DISTRIBUTIONS_SERVICE_KEY}`) {
    res.writeHead(401).end(); return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.method === "POST" && req.url === "/api/service/sign-in-check") {
    let body = ""; for await (const part of req) body += part;
    const { email } = JSON.parse(body);
    rosterCalls.push({ endpoint: "sign-in-check", email });
    const identity = {
      "bootstrap@example.test": ["test-bootstrap", "Test Bootstrap"],
      "other@example.test": ["test-other", "Test Other"],
    }[email];
    res.end(JSON.stringify(identity && (email !== "bootstrap@example.test" || allowBootstrap)
      ? { allowed: true, personId: identity[0], displayName: identity[1] }
      : { allowed: false, personId: null, displayName: null }));
  } else if (req.method === "GET" && req.url === "/api/service/holdings") {
    rosterCalls.push({ endpoint: "holdings" });
    res.end(JSON.stringify(currentHoldings));
  } else { res.writeHead(404).end("{}"); }
});
stub.listen(0, "127.0.0.1");
await once(stub, "listening");
process.env.ROSTER_BASE_URL = `http://127.0.0.1:${stub.address().port}`;

const { db, pool, auditLog } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const { logger } = await import("../src/lib/logger.ts");
const { default: app } = await import("../src/app.ts");

// Capture the real development log output without exposing login tokens in reports.
const stream = logger[pino.symbols.streamSym];
const originalStreamWrite = stream.write;
let loggedLink;
stream.write = function (line, ...args) {
  try {
    const event = JSON.parse(line.toString());
    if (event.magicLink) { loggedLink = event.magicLink; return true; }
    if (event.req || event.res) return true; // keep verification evidence concise
  } catch {}
  return originalStreamWrite.call(this, line, ...args);
};

const client = await pool.connect();
const originalConnect = pool.connect;
const originalQuery = pool.query;
await client.query("BEGIN");
await isolateTables(client);
let savepointIndex = 0;
const savepoints = [];
const adapter = {
  query: async (...args) => {
    const text = typeof args[0] === "string" ? args[0] : args[0].text;
    if (text.toLowerCase().includes("pg_advisory_xact_lock")) return client.query("SELECT pg_advisory_xact_lock($1)", [-process.pid]);
    if (text.toLowerCase().trim().startsWith("begin")) {
      const name = `verification_${++savepointIndex}`; savepoints.push(name);
      return client.query(`SAVEPOINT ${name}`);
    }
    if (text.toLowerCase() === "commit") return client.query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
    if (text.toLowerCase() === "rollback") {
      const name = savepoints.pop();
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return client.query(`RELEASE SAVEPOINT ${name}`);
    }
    return client.query(...args);
  },
  release() {},
};
pool.connect = async () => adapter;
pool.query = (...args) => client.query(...args);

const results = [];
const record = (check, evidence) => results.push({ check, result: "PASS", source: "LOCAL ROSTER STUB / DEVELOPMENT DB, ROLLED BACK", evidence });
const cookieHeader = (response) => response.headers["set-cookie"].map((value) => value.split(";")[0]).join("; ");
const call = async (method, path, cookie, data) => {
  let req = request(app)[method](path);
  req = req.set("Origin", process.env.APP_ORIGIN);
  if (cookie) req = req.set("Cookie", cookie);
  if (data !== undefined) req = req.send(data);
  return req;
};
const count = async (table) => Number((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const protectedRoutes = [
  ["get", "/api/auth/session"], ["post", "/api/auth/logout"],
  ["get", "/api/holdings"], ["post", "/api/holdings/fetch"],
  ["get", "/api/snapshots"], ["post", "/api/snapshots"],
  ["get", "/api/snapshots/1"], ["get", "/api/residences"], ["post", "/api/residences"],
  ["get", "/api/rates"], ["post", "/api/rates"], ["post", "/api/rates/copy"],
  ["get", "/api/access"], ["post", "/api/access"], ["post", "/api/access/remove"],
  ["get", "/api/audit"], ["get", "/api/unknown-private-path"],
];
async function login(email) {
  loggedLink = undefined;
  const link = await call("post", "/api/auth/link", null, { email });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.ok(link.body.message.startsWith("Development only:"));
  assert.ok(loggedLink, "Magic link must be written to server logging sink");
  const url = new URL(loggedLink);
  const before = await count("hwd_sessions");
  const landing = await call("get", url.pathname + url.search);
  assert.equal(landing.status, 200);
  assert.equal(landing.headers["set-cookie"], undefined);
  assert.equal(await count("hwd_sessions"), before);
  assert.match(landing.text, /Continue to HWD Cap Table/);
  const verified = await call("post", url.pathname, null, { token: url.searchParams.get("token") });
  assert.equal(verified.status, 303, JSON.stringify(verified.body));
  return { cookie: cookieHeader(verified), url };
}

try {
  const identity = (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0];
  results.push({ check: "Database identity", environment: "development", observed: identity });
  const startCounts = await client.query("SELECT (SELECT count(*) FROM access_entries)::int AS access, (SELECT count(*) FROM snapshots)::int AS snapshots");
  assert.equal(startCounts.rows[0].access, 0, "Run verification only against a fresh development foundation database");

  // Missing Roster configuration never falls back to test data.
  const stubUrl = process.env.ROSTER_BASE_URL;
  delete process.env.ROSTER_BASE_URL;
  const missing = await call("post", "/api/auth/link", null, { email: "bootstrap@example.test" });
  assert.equal(missing.status, 503); assert.match(missing.body.error, /ROSTER_BASE_URL is unset/);
  process.env.ROSTER_BASE_URL = stubUrl;
  record("Missing Roster configuration", "503 with explicit ROSTER_BASE_URL-unset message; no fallback");

  const refused = await call("post", "/api/auth/link", null, { email: "denied@example.test" });
  assert.equal(refused.status, 403);
  assert.equal(await count("magic_links"), 0);
  record("(a) Roster-disallowed email", "POST /api/auth/link -> 403; zero magic-link records");

  const otherFirst = await call("post", "/api/auth/link", null, { email: "other@example.test" });
  assert.equal(otherFirst.status, 403); assert.equal(await count("access_entries"), 0);
  const bootstrap = await login("bootstrap@example.test");
  assert.equal(await count("access_entries"), 1);
  assert.equal((await client.query("SELECT person_id FROM access_entries")).rows[0].person_id, "test-bootstrap");
  const replay = await call("post", bootstrap.url.pathname, null, { token: bootstrap.url.searchParams.get("token") });
  assert.equal(replay.status, 401);
  record("(c) Bootstrap identity restriction", "Other allowed identity -> 403 and zero access rows; verified bootstrap identity -> exactly one entry; link replay -> 401");

  // A Roster-allowed person can obtain a real session, then lose local access.
  const add = await call("post", "/api/access", bootstrap.cookie, { email: "other@example.test", note: "Verification: grant test access" });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const other = await login("other@example.test");
  const remove = await call("post", "/api/access/remove", bootstrap.cookie, { personId: "test-other", note: "Verification: remove test access" });
  assert.equal(remove.status, 201);
  const routeEvidence = [];
  for (const [method, path] of protectedRoutes) {
    const response = await call(method, path, other.cookie, {});
    assert.equal(response.status, 403, `${method} ${path}: ${response.status}`);
    routeEvidence.push(`${method.toUpperCase()} ${path} -> ${response.status}`);
  }
  const noLocal = await call("post", "/api/auth/link", null, { email: "other@example.test" });
  assert.equal(noLocal.status, 403);
  record("(b) Roster allowed but no active local access", { signIn: "403", protectedRoutes: routeEvidence });
  const last = await call("post", "/api/access/remove", bootstrap.cookie, { personId: "test-bootstrap", note: "Verification: last-person protection" });
  assert.equal(last.status, 409);
  record("Last-person protection", "POST /api/access/remove -> 409; last person remains active");
  allowBootstrap = false;
  const rosterRevoked = await call("get", "/api/holdings", bootstrap.cookie);
  assert.equal(rosterRevoked.status, 403);
  allowBootstrap = true;
  record("Roster rechecked on existing session", "Roster denies previously signed-in person; GET /api/holdings -> 403");

  const fetched = await call("post", "/api/holdings/fetch", bootstrap.cookie);
  assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
  assert.equal(fetched.body.holdings.length, 47);
  assert.deepEqual(fetched.body.holdings, rosterFixture.holdings);
  const snapshot = await call("post", "/api/snapshots", bootstrap.cookie, { fetchId: fetched.body.id, note: "Verification: exact 47-holder supplied fixture (STUB)" });
  assert.equal(snapshot.status, 201, JSON.stringify(snapshot.body));
  const detail = await call("get", `/api/snapshots/${snapshot.body.id}`, bootstrap.cookie);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.holdings, rosterFixture.holdings);
  assert.equal(detail.body.asOf, rosterFixture.asOf);
  const totals = (await client.query("SELECT share_class, sum(shares)::text AS total, count(*)::int AS holders FROM snapshot_rows WHERE snapshot_id=$1 GROUP BY share_class ORDER BY share_class", [snapshot.body.id])).rows;
  assert.deepEqual(totals.map((t) => ({ shareClass: t.share_class, totalShares: t.total, holderCount: t.holders })), rosterFixture.classes);
  assert.equal(snapshot.body.grandTotal, "400.0000");
  const edit = await call("patch", `/api/snapshots/${snapshot.body.id}`, bootstrap.cookie, { note: "Must not change" });
  const removeSnapshot = await call("delete", `/api/snapshots/${snapshot.body.id}`, bootstrap.cookie);
  assert.equal(edit.status, 404); assert.equal(removeSnapshot.status, 404);
  record("(d) Immutable snapshot", { snapshotId: snapshot.body.id, storedRows: detail.body.holdings.length, asOf: detail.body.asOf, totals, grandTotal: snapshot.body.grandTotal, patchStatus: edit.status, deleteStatus: removeSnapshot.status });

  const initialResidences = await call("get", "/api/residences", bootstrap.cookie);
  assert.equal(initialResidences.body.length, 47);
  const uk = initialResidences.body.find((r) => r.displayName === "Holmes Brette Kameny");
  const noState = initialResidences.body.find((r) => r.displayName === "Gaston Natalie Davis");
  assert.equal(uk.stateCode, "NONE"); assert.equal(uk.confirmed, false);
  assert.equal(noState.stateCode, null); assert.equal(noState.confirmed, false);
  record("UK and missing residence", "UK -> NONE/unconfirmed; null addressState -> null/unconfirmed (missing), not NONE");
  // Supplemental GA probe only: never alters the base 47-holder fixture.
  currentHoldings = structuredClone(rosterFixture);
  currentHoldings.holdings.push({ personId: "fixture-ga-probe", displayName: "Supplemental GA Probe", shareClass: "A", shares: "1.0000", isUnsettled: false, note: "Supplemental verification only", addressState: "GA" });
  currentHoldings.classes[0] = { shareClass: "A", totalShares: "101.0000", holderCount: 3 };
  currentHoldings.grandTotal = "401.0000";
  const gaFetch = await call("post", "/api/holdings/fetch", bootstrap.cookie);
  assert.equal(gaFetch.status, 200);
  const ga = (await call("get", "/api/residences", bootstrap.cookie)).body.find((r) => r.personId === "fixture-ga-probe");
  assert.equal(ga.stateCode, "GA"); assert.equal(ga.confirmed, false);
  assert.equal(ga.confirmedBy, null); assert.equal(ga.confirmedAt, null);
  record("(e) GA proposal", { fixture: "Supplemental GA probe, separate from mandated base fixture", stateCode: ga.stateCode, confirmed: ga.confirmed, confirmedBy: ga.confirmedBy, confirmedAt: ga.confirmedAt });
  const corrected = await call("post", "/api/residences", bootstrap.cookie, { personId: ga.personId, stateCode: "GA", confirmed: true, note: "Verification: confirm GA residence" });
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.confirmedBy, "test-bootstrap");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM tax_residences WHERE person_id=$1", [ga.personId])).rows[0].n, 2);
  currentHoldings = structuredClone(rosterFixture);
  await call("post", "/api/holdings/fetch", bootstrap.cookie);
  const detailAgain = await call("get", `/api/snapshots/${snapshot.body.id}`, bootstrap.cookie);
  assert.deepEqual(detailAgain.body, detail.body);
  record("Residence revisions and snapshot permanence", "Confirmation appends second residence row; later holdings fetch leaves original snapshot identical");

  // Test rates, not tax advice or app defaults.
  const rateInput = { taxYear: 2025, federalRate: "0.1500", federalSourceNote: "STUB verification federal source", states: [{ stateCode: "GA", rate: "0.0500", sourceNote: "STUB verification GA source" }, { stateCode: "NONE", rate: "0.0000", sourceNote: "STUB verification no-state source" }], note: "Verification test rates only" };
  const rate = await call("post", "/api/rates", bootstrap.cookie, rateInput);
  assert.equal(rate.status, 201, JSON.stringify(rate.body));
  const copy = await call("post", "/api/rates/copy", bootstrap.cookie, { fromYear: 2025, toYear: 2026, note: "Verification: exact prior-year copy" });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.notEqual(copy.body.id, rate.body.id);
  assert.equal(copy.body.taxYear, 2026);
  assert.equal(copy.body.federalRate, rate.body.federalRate);
  assert.equal(copy.body.federalSourceNote, rate.body.federalSourceNote);
  assert.deepEqual(copy.body.states, rate.body.states);
  record("(f) Prior-year copy", { fromYear: 2025, toYear: 2026, distinctIds: true, federalRate: copy.body.federalRate, federalSourceIdentical: true, stateRowsAndSourcesIdentical: true });
  const badNone = await call("post", "/api/rates", bootstrap.cookie, { ...rateInput, states: [{ stateCode: "NONE", rate: "0.0100", sourceNote: "Invalid test" }] });
  assert.equal(badNone.status, 400);
  record("NONE rate guard", "Nonzero NONE rate -> 400");

  const session = await call("get", "/api/auth/session", bootstrap.cookie);
  assert.equal(session.status, 200);
  assert.equal(session.body.environment, "development");
  assert.equal(session.body.databaseName, identity.database_name);
  const apiAudit = await call("get", "/api/audit", bootstrap.cookie);
  assert.equal(apiAudit.status, 200);
  const tables = ["access_entries", "magic_links", "link_consumptions", "hwd_sessions", "session_revocations", "holding_fetches", "snapshots", "snapshot_rows", "tax_residences", "rate_tables", "state_rates"];
  let totalWrites = 0;
  const auditEvidence = [];
  for (const table of tables) {
    const rows = await count(table);
    const auditRows = (await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity=$1", [table])).rows[0].n;
    assert.equal(auditRows, rows, `Every ${table} insert must be audited`);
    totalWrites += rows;
    auditEvidence.push({ entity: table, rows, auditRows });
  }
  assert.equal(await count("audit_log"), totalWrites);
  record("Every stored write audited", { totalWrites, auditRows: totalWrites, perEntity: auditEvidence });

  // Production fallback guard, still inside this test process and rollback.
  process.env.NODE_ENV = "production";
  process.env.APP_ORIGIN = "https://hwd-verification.test";
  await new Promise((resolve) => setTimeout(resolve, 1100));
  loggedLink = undefined;
  const productionMail = await call("post", "/api/auth/link", null, { email: "bootstrap@example.test" });
  assert.equal(productionMail.status, 503);
  assert.match(productionMail.body.error, /RESEND_API_KEY is required in production/);
  assert.equal(loggedLink, undefined);
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = "http://hwd-verification.test";
  record("Production mail fallback forbidden", "NODE_ENV=production + missing RESEND_API_KEY -> 503; no logged magic link");
  const logout = await call("post", "/api/auth/logout", bootstrap.cookie);
  assert.equal(logout.status, 200);
  assert.equal((await call("get", "/api/auth/session", bootstrap.cookie)).status, 401);
  record("Session logout", "Revocation appended; prior session -> 401");
  results.push({ check: "Roster transport", source: "LOCAL STUB ONLY", calls: rosterCalls.length, realRosterCalls: 0 });
} finally {
  process.env.NODE_ENV = "test";
  await client.query("ROLLBACK");
  pool.connect = originalConnect;
  pool.query = originalQuery;
  client.release();
  stream.write = originalStreamWrite;
  await new Promise((resolve) => stub.close(resolve));
  const persisted = (await pool.query("SELECT (SELECT count(*) FROM access_entries)::int AS access, (SELECT count(*) FROM snapshots)::int AS snapshots, (SELECT count(*) FROM audit_log)::int AS audit")).rows[0];
  results.push({ check: "Test-data cleanup", action: "ROLLBACK (no hard deletes)", persisted });
  await pool.end();
  console.log(JSON.stringify(results, null, 2));
}
