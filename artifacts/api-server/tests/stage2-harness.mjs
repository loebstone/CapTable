/**
 * DEVELOPMENT ONLY. Real Express/Drizzle/PostgreSQL and private App Storage;
 * only the external Roster is a local HTTP STUB. No environment changes persist.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import request from "supertest";
import pino from "pino";
import { rosterFixture } from "./roster-fixture.ts";
import { isolateTables } from "./isolate-tables.mjs";

export async function stage2Harness() {
  if (process.env.NODE_ENV === "production") throw new Error("Verification is forbidden in production");
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.DISTRIBUTIONS_SERVICE_KEY = randomBytes(32).toString("hex");
  process.env.BOOTSTRAP_PERSON_ID = "test-bootstrap";
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  process.env.APP_ORIGIN = "http://hwd-verification.test";
  let holdings = structuredClone(rosterFixture);
  let calls = 0;
  const stub = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${process.env.DISTRIBUTIONS_SERVICE_KEY}`) return res.writeHead(401).end();
    res.setHeader("Content-Type", "application/json"); calls++;
    if (req.method === "POST" && req.url === "/api/service/sign-in-check") {
      let raw = ""; for await (const part of req) raw += part;
      const { email } = JSON.parse(raw);
      const identity = { "bootstrap@example.test": ["test-bootstrap", "Test Bootstrap"], "other@example.test": ["test-other", "Test Other"] }[email];
      res.end(JSON.stringify(identity ? { allowed: true, personId: identity[0], displayName: identity[1] } : { allowed: false }));
    } else if (req.method === "GET" && req.url === "/api/service/holdings") res.end(JSON.stringify(holdings));
    else res.writeHead(404).end("{}");
  });
  stub.listen(0, "127.0.0.1"); await once(stub, "listening");
  process.env.ROSTER_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  const { pool } = await import("@workspace/db");
  const { logger } = await import("../src/lib/logger.ts");
  const { default: app } = await import("../src/app.ts");
  const client = await pool.connect();
  const originalConnect = pool.connect, originalQuery = pool.query;
  const stream = logger[pino.symbols.streamSym], originalStreamWrite = stream.write;
  let loggedLink;
  stream.write = function (line, ...args) {
    try {
      const event = JSON.parse(line.toString());
      if (event.magicLink) { loggedLink = event.magicLink; return true; }
      if (event.req || event.res) return true;
    } catch {}
    return originalStreamWrite.call(this, line, ...args);
  };
  await client.query("BEGIN");
  await isolateTables(client);
  let index = 0;
  const savepoints = [];
  const adapter = {
    query: async (...args) => {
      const text = (typeof args[0] === "string" ? args[0] : args[0].text).toLowerCase().trim();
      // The outer rollback transaction otherwise holds the application's global
      // write lock for the whole browser run and blocks real development users.
      if (text.includes("pg_advisory_xact_lock")) return client.query("SELECT pg_advisory_xact_lock($1)", [-process.pid]);
      // Includes Drizzle's BEGIN ISOLATION LEVEL ... READ ONLY.
      if (text.startsWith("begin")) {
        const name = `stage2_${++index}`; savepoints.push(name);
        return client.query(`SAVEPOINT ${name}`);
      }
      if (text === "commit") return client.query(`RELEASE SAVEPOINT ${savepoints.pop()}`);
      if (text === "rollback") {
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
  const call = async (method, path, cookie, data) => {
    let req = request(app)[method](path);
    req = req.set("Origin", process.env.APP_ORIGIN);
    if (cookie) req = req.set("Cookie", cookie);
    if (data !== undefined) req = req.send(data);
    if (path.endsWith("/file") || /\.(pdf|zip|xlsx)$/.test(path)) req = req.buffer(true).parse((res, done) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    return req;
  };
  const record = (check, evidence, result = "PASS") => results.push({ check, result, source: "LOCAL ROSTER STUB / DEVELOPMENT DB", evidence });
  const expect = (response, status) => { assert.equal(response.status, status, `${response.status}: ${JSON.stringify(response.body)}`); return response.body; };
  async function login(email = "bootstrap@example.test") {
    loggedLink = undefined;
    expect(await call("post", "/api/auth/link", null, { email }), 200);
    assert.ok(loggedLink);
    const url = new URL(loggedLink);
    const landing = await call("get", url.pathname + url.search);
    expect(landing, 200);
    assert.equal(landing.headers["set-cookie"], undefined);
    assert.match(landing.text, /Continue to HWD Cap Table/);
    const response = await call("post", url.pathname, null, { token: url.searchParams.get("token") });
    expect(response, 303);
    return response.headers["set-cookie"].map((s) => s.split(";")[0]).join("; ");
  }
  const finish = async () => {
    await client.query("ROLLBACK");
    pool.connect = originalConnect; pool.query = originalQuery;
    client.release(); stream.write = originalStreamWrite;
    await new Promise((resolve) => stub.close(resolve));
    const persisted = (await pool.query("SELECT (SELECT count(*) FROM access_entries)::int AS access, (SELECT count(*) FROM distribution_years)::int AS years, (SELECT count(*) FROM distribution_entries)::int AS payments, (SELECT count(*) FROM audit_log)::int AS audit")).rows[0];
    results.push({ check: "Cleanup and transport", result: "PASS", evidence: { databaseAction: "ROLLBACK of temporary test tables; persistent records unchanged", persisted, roster: "LOCAL STUB ONLY", stubCalls: calls, realRosterCalls: 0, storage: "Real private App Storage; real-year test files retained; only guarded practice resets remove files" } });
    await pool.end();
    console.log(JSON.stringify(results, null, 2));
  };
  return { app, client, call, login, expect, record, results, finish, getLoggedLink: () => loggedLink, setHoldings: (value) => { holdings = structuredClone(value); } };
}
