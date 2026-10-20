/**
 * DEVELOPMENT ONLY. Actual API/Drizzle/SQL, temporary tables with rollback;
 * local Roster STUB, no email, no production connection.
 */
import assert from "node:assert/strict";
import request from "supertest";
import { stage2Harness } from "./stage2-harness.mjs";

const h = await stage2Harness();
const { call, client, expect, record } = h;
try {
  record("Environment / observed identity", { environment: "development", ...(await client.query("SELECT current_database() AS database, inet_server_addr() AS server_address")).rows[0] });
  const cookie = await h.login(), taxYear = 2040;
  const csv = 'code,rate,source_note\nFEDERAL,0.1500,"planning rate"\nCA,0.1330,"top rate"\nGA,4.99%,"HB 463"\nNONE,0,"non-US"\n';
  const input = { taxYear, filename: "acceptance-rates.csv", csv };
  const counts = async () => (await client.query("SELECT (SELECT count(*)::int FROM rate_imports) AS imports, (SELECT count(*)::int FROM rate_code_revisions) AS revisions, (SELECT count(*)::int FROM rate_tables) AS manual_tables, (SELECT count(*)::int FROM state_rates) AS manual_states, (SELECT count(*)::int FROM audit_log) AS audits")).rows[0];
  const preview = async (data = input) => expect(await call("post", "/api/rates/csv/preview", cookie, data), 200);
  const confirm = async (data, p) => expect(await call("post", "/api/rates/csv/confirm", cookie, { ...data, previewToken: p.previewToken }), 200);
  const current = async () => expect(await call("get", "/api/rates", cookie), 200).find((t) => t.taxYear === taxYear);
  const initial = await counts(), p = await preview();
  assert.deepEqual(await counts(), initial);
  assert.equal(p.rows.find((r) => r.code === "GA").rate, "0.0499");
  assert.equal(p.changedCount, 4); assert.ok(p.rows.every((r) => r.currentRate === null && r.status === "new"));
  record("Preview only", { GA: p.rows.find((r) => r.code === "GA").rate, newRows: 4, writes: 0, rows: p.rows });
  const result = await confirm(input, p), after = await counts();
  assert.equal(result.changedCount, 4);
  assert.deepEqual(after, { imports: initial.imports + 1, revisions: initial.revisions + 4, manual_tables: initial.manual_tables, manual_states: initial.manual_states, audits: initial.audits + 5 });
  const revisions = (await client.query("SELECT code,rate,source_note FROM rate_code_revisions ORDER BY id")).rows;
  assert.deepEqual(revisions.map((r) => [r.code, r.rate]), [["FEDERAL", "0.1500"], ["CA", "0.1330"], ["GA", "0.0499"], ["NONE", "0.0000"]]);
  const audit = (await client.query("SELECT operation FROM audit_log WHERE entity='rate_imports'")).rows[0].operation;
  assert.match(audit, /acceptance-rates\.csv/); assert.match(audit, /"changed":4/);
  record("Confirm exact revisions and audit", { revisions, auditDelta: 5, codeAuditRows: 4, importAuditRows: 1, importAuditNamesFileAndCounts: true });

  const second = await preview();
  assert.equal(second.unchangedCount, 4);
  const noop = await confirm(input, second);
  assert.equal(noop.changedCount, 0); assert.equal(noop.importId, null);
  assert.deepEqual(await counts(), after);
  record("Second identical import", { unchanged: 4, changed: 0, databaseWrites: 0, auditWrites: 0 });
  const bad = { ...input, csv: csv.replace("CA,0.1330", "XX,0.1330") };
  const invalid = expect(await call("post", "/api/rates/csv/preview", cookie, bad), 400);
  assert.match(invalid.error, /Line 3.*bad code "XX"/);
  expect(await call("post", "/api/rates/csv/confirm", cookie, { ...bad, previewToken: p.previewToken }), 400);
  assert.deepEqual(await counts(), after);
  record("Bad code before writes", { status: 400, message: invalid.error, databaseWrites: 0 });
  for (const [label, body, status] of [
    ["missing header", "GA,0.0499,note", 400],
    ["duplicate", "code,rate,source_note\nGA,0.1,note\nGA,0.2,note", 400],
    ["unparseable", "code,rate,source_note\nGA,not-a-rate,note", 400],
    ["outside range", "code,rate,source_note\nGA,101%,note", 400],
    ["negative", "code,rate,source_note\nGA,-0.1,note", 400],
    ["NONE nonzero", "code,rate,source_note\nNONE,0.01,note", 400],
    ["malformed quoting", 'code,rate,source_note\nGA,0.1,"unterminated', 400],
    ["UTF-8 exceeds 64 KB", `code,rate,source_note\nGA,0.1,"${"é".repeat(33000)}"`, 413],
  ]) {
    const error = expect(await call("post", "/api/rates/csv/preview", cookie, { ...input, csv: body }), status);
    assert.deepEqual(await counts(), after);
    record(`Reject ${label}`, { status, error: error.error, writes: 0 });
  }
  const exported = await call("get", `/api/rates/${taxYear}/csv`, cookie);
  assert.equal(exported.status, 200); assert.match(exported.headers["content-disposition"], /HWD_Rates_2040\.csv/);
  const roundtripInput = { ...input, filename: "roundtrip.csv", csv: exported.text };
  const rt = await preview(roundtripInput);
  assert.equal(rt.unchangedCount, 4);
  await confirm(roundtripInput, rt);
  assert.deepEqual(await counts(), after);
  record("Export round-trip", { exportedRows: 4, matchingRatesAndNotes: true, unchanged: 4, writesOnReimport: 0 });
  const copied = expect(await call("post", "/api/rates/copy", cookie, { fromYear: taxYear, toYear: 2041, note: "STUB copy imported year" }), 201);
  assert.equal(copied.federalRate, "0.1500"); assert.equal(copied.states.find((r) => r.stateCode === "GA").rate, "0.0499");
  const { currentYearRates } = await import("../src/lib/distribution-years.ts");
  const { db } = await import("@workspace/db");
  const distributionRates = await currentYearRates(db, taxYear);
  assert.equal(distributionRates.states.find((r) => r.stateCode === "GA").rate, "0.0499");
  record("Imports visible to distributions and prior-year copy", { federal: distributionRates.federalRate, GA: "0.0499", copyMatches: true });

  const update = { ...input, csv: 'code,rate,source_note\nFEDERAL,0.1500,"planning rate"\nGA,5.39%,"updated, reviewed\nwith source"\n' };
  const beforeUpdate = await counts(), up = await preview(update);
  assert.equal(up.changedCount, 1); assert.equal(up.unchangedCount, 1);
  await confirm(update, up);
  const afterUpdate = await counts();
  assert.equal(afterUpdate.revisions - beforeUpdate.revisions, 1); assert.equal(afterUpdate.audits - beforeUpdate.audits, 2);
  let table = await current();
  assert.equal(table.states.find((r) => r.stateCode === "GA").rate, "0.0539");
  assert.equal(table.states.find((r) => r.stateCode === "GA").sourceNote, "updated, reviewed\nwith source");
  assert.equal(table.states.find((r) => r.stateCode === "CA").rate, "0.1330");
  assert.equal(table.states.find((r) => r.stateCode === "NONE").rate, "0.0000");
  const quotedExport = await call("get", `/api/rates/${taxYear}/csv`, cookie);
  assert.equal((await preview({ ...input, csv: quotedExport.text })).unchangedCount, 4);
  record("Changed-only, omitted codes, quoted commas/newlines", { revisions: 1, audits: 2, unchangedSkipped: 1, omittedCAandNONEPreserved: true, quotedNoteRoundTrips: true });
  const stale = await preview(input);
  const alter = { ...input, csv: "code,rate,source_note\nGA,0.06,new source\n" };
  await confirm(alter, await preview(alter));
  const beforeStale = await counts();
  const conflict = expect(await call("post", "/api/rates/csv/confirm", cookie, { ...input, previewToken: stale.previewToken }), 409);
  assert.match(conflict.error, /changed after the preview/);
  assert.deepEqual(await counts(), beforeStale);
  record("Stale preview rejected", { status: 409, writes: 0 });

  // Prove all rows/audits roll back if a later insert fails mid-import.
  await client.query("CREATE FUNCTION pg_temp.reject_csv_ga() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code = 'GA' THEN RAISE EXCEPTION 'test-only forced failure'; END IF; RETURN NEW; END $$");
  await client.query("CREATE TRIGGER reject_csv_ga BEFORE INSERT ON pg_temp.rate_code_revisions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_csv_ga()");
  const atomic = { ...input, csv: "code,rate,source_note\nFEDERAL,0.16,test update\nGA,0.07,test update\n" };
  const atomicPreview = await preview(atomic), beforeAtomic = await counts();
  expect(await call("post", "/api/rates/csv/confirm", cookie, { ...atomic, previewToken: atomicPreview.previewToken }), 500);
  assert.deepEqual(await counts(), beforeAtomic);
  assert.equal((await current()).federalRate, "0.1500");
  await client.query("DROP TRIGGER reject_csv_ga ON pg_temp.rate_code_revisions");
  record("Atomic rollback on late insert failure", { source: "test-only temporary trigger", status: 500, partialRevisions: 0, partialAudits: 0 });

  table = await current();
  const corrected = expect(await call("post", "/api/rates", cookie, { taxYear, federalRate: "0.17", federalSourceNote: "manual source", states: table.states, note: "Existing manual editor full revision" }), 400);
  // Existing editor still requires the original four-decimal format.
  assert.ok(corrected.error);
  expect(await call("post", "/api/rates", cookie, { taxYear, federalRate: "0.1700", federalSourceNote: "manual source", states: table.states, note: "Existing manual editor full revision" }), 201);
  assert.equal((await current()).federalRate, "0.1700");
  record("Existing manual save preserved", { originalValidation: 400, fullRevision: 201, effectiveFederal: "0.1700" });

  expect(await call("get", `/api/rates/${taxYear}/csv`), 401);
  expect(await call("post", "/api/rates/csv/preview", null, input), 401);
  expect(await call("post", "/api/rates/csv/confirm", null, { ...input, previewToken: p.previewToken }), 401);
  const foreign = await request(h.app).post("/api/rates/csv/preview").set("Origin", "https://foreign.example").set("Cookie", cookie).send(input);
  assert.equal(foreign.status, 403);
  expect(await call("post", "/api/access", cookie, { email: "other@example.test", note: "STUB access gate probe" }), 201);
  const other = await h.login("other@example.test");
  expect(await call("post", "/api/access/remove", other, { personId: "test-bootstrap", note: "STUB revoke original tester" }), 201);
  for (const [method, path, data] of [
    ["post", "/api/rates/csv/preview", input],
    ["post", "/api/rates/csv/confirm", { ...input, previewToken: p.previewToken }],
    ["get", `/api/rates/${taxYear}/csv`, undefined],
  ]) expect(await call(method, path, cookie, data), 403);
  record("Server access and same-origin gates", { anonymous: 401, removedAccess: 403, foreignOrigin: 403, routes: 3 });
} finally { await h.finish(); }
