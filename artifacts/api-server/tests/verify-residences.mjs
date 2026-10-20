// DEVELOPMENT ONLY: temporary-table transaction, local Roster STUB, no email.
import assert from "node:assert/strict";
import request from "supertest";
import { stage2Harness } from "./stage2-harness.mjs";
import { rosterFixture } from "./roster-fixture.ts";

const h = await stage2Harness();
const { call, expect, client, record } = h;
const count = async (table) => Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
try {
  record("Observed identity", { environment: "development", ...(await client.query("SELECT current_database(),inet_server_addr()::text AS server_address")).rows[0] });
  const cookie = await h.login();
  const fixture = structuredClone(rosterFixture);
  fixture.holdings[0].addressState = null;
  assert.equal(fixture.holdings.length, 47);
  assert.equal(fixture.holdings.filter((r) => r.addressState === null).length, 2);
  h.setHoldings(fixture);
  expect(await call("post", "/api/holdings/fetch", cookie), 200);
  let rows = expect(await call("get", "/api/residences", cookie), 200);
  const eligible = rows.filter((r) => r.stateCode !== null);
  const missing = rows.filter((r) => r.stateCode === null);
  const input = { revisionIds: eligible.map((r) => r.id) };
  expect(await call("post", "/api/residences/confirm-all", null, input), 401);
  assert.equal((await request(h.app).post("/api/residences/confirm-all").set("Cookie", cookie).set("Origin", "https://foreign.example").send(input)).status, 403);

  const before = await count("audit_log"), originalRows = await count("tax_residences");
  expect(await call("post", "/api/residences/confirm-all", cookie, { revisionIds: input.revisionIds.slice(1) }), 409);
  assert.equal(await count("audit_log"), before);
  // Inject an error after earlier rows were appended to prove whole-batch rollback.
  await client.query(`CREATE FUNCTION pg_temp.fail_residence_batch() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.person_id = TG_ARGV[0] AND NEW.confirmed THEN RAISE EXCEPTION 'TEST ONLY forced rollback'; END IF; RETURN NEW; END $body$`);
  const last = eligible.at(-1).personId.replace(/'/g, "''");
  await client.query(`CREATE TRIGGER fail_residence_batch BEFORE INSERT ON tax_residences FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_residence_batch('${last}')`);
  expect(await call("post", "/api/residences/confirm-all", cookie, input), 500);
  assert.equal(await count("tax_residences"), originalRows);
  assert.equal(await count("audit_log"), before);
  await client.query("DROP TRIGGER fail_residence_batch ON tax_residences");

  const result = expect(await call("post", "/api/residences/confirm-all", cookie, input), 200);
  assert.equal(result.confirmedCount, 45);
  assert.deepEqual(result.skipped, missing.map(({ personId, displayName }) => ({ personId, displayName })));
  assert.equal(result.stateCounts.reduce((n, r) => n + r.count, 0), 45);
  assert.equal(await count("audit_log") - before, 46);
  assert.equal(await count("tax_residences") - originalRows, 45);
  const audits = (await client.query("SELECT actor,occurred_at,operation FROM audit_log ORDER BY id DESC LIMIT 46")).rows;
  const operations = audits.map((r) => JSON.parse(r.operation));
  assert.equal(operations.filter((r) => r.action === "RESIDENCE_CONFIRMED").length, 45);
  assert.equal(operations.filter((r) => r.action === "RESIDENCES_CONFIRMED").length, 1);
  assert.ok(audits.every((r) => r.actor === "test-bootstrap" && r.occurred_at));
  assert.ok(operations.filter((r) => r.action === "RESIDENCE_CONFIRMED").every((r) => r.stateCode && r.confirmedAt));
  rows = expect(await call("get", "/api/residences", cookie), 200);
  assert.equal(rows.filter((r) => r.confirmed).length, 45);
  assert.ok(rows.slice(0, 2).every((r) => !r.confirmed && !r.stateCode));
  assert.ok(rows.slice(2).every((r) => r.confirmed && r.confirmedBy === "test-bootstrap" && Date.parse(r.confirmedAt) === Date.parse(result.confirmedAt)));
  record("Confirm all", { total: 47, confirmed: 45, skipped: result.skipped.map((r) => r.displayName), stateCounts: result.stateCounts, auditEntries: 46, originalRevisionsRetained: true, unconfirmedFirst: true });
  record("Atomicity and access", "Forced mid-batch failure rolled back all residence/audit writes; stale preview 409 without writes; anonymous 401; cross-origin 403");

  const target = eligible[0];
  const proposal = expect(await call("post", "/api/residences", cookie, { personId: target.personId, stateCode: target.stateCode, confirmed: false, note: "" }), 201);
  const single = expect(await call("post", "/api/residences", cookie, { personId: target.personId, expectedRevisionId: proposal.id, stateCode: target.stateCode, confirmed: true, note: "" }), 201);
  assert.equal(single.note, ""); assert.equal(single.confirmed, true);
  expect(await call("post", "/api/residences", cookie, { personId: target.personId, expectedRevisionId: proposal.id, stateCode: target.stateCode, confirmed: true }), 409);
  const omitted = expect(await call("post", "/api/residences", cookie, { personId: target.personId, stateCode: target.stateCode, confirmed: true }), 201);
  assert.equal(omitted.note, "");
  record("Single confirmation", "Empty and omitted notes both succeed with 201; stale single-row confirmation returns 409");
  const auditBeforeNoop = await count("audit_log");
  assert.equal(expect(await call("post", "/api/residences/confirm-all", cookie, { revisionIds: [] }), 200).confirmedCount, 0);
  assert.equal(await count("audit_log"), auditBeforeNoop);
} catch (error) {
  process.exitCode = 1; h.results.push({ check: "Residence acceptance", result: "FAIL", error: error.message, stack: error.stack });
} finally { await h.finish(); }
