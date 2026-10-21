import assert from "node:assert/strict";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { parseRateCsv } from "../src/lib/rate-csv.ts";

const h = await stage2Harness();
const { call, expect, record, results, client } = h;
try {
  const identity = (await client.query("SELECT current_database(),inet_server_addr()")).rows[0];
  results.push({ check: "Observed identity", environment: "DEVELOPMENT; isolated temporary test tables", identity });
  const fixture = await finalizedFixture(h);
  const cookie = await h.login();
  const sourceRates = expect(await call("get", "/api/rates", cookie), 200).find((r) => r.taxYear === 2026);
  const rates = expect(await call("post", "/api/rates", cookie, {
    taxYear: 2030, federalRate: sourceRates.federalRate,
    states: sourceRates.states.map(({ stateCode, rate }) => ({ stateCode, rate })),
  }), 201);
  assert.equal(rates.note, ""); assert.equal(rates.federalSourceNote, "");
  assert.ok(rates.states.every((s) => s.sourceNote === ""));
  expect(await call("post", "/api/rates/copy", cookie, { fromYear: 2030, toYear: 2031 }), 201);
  const csv = parseRateCsv("STUB-empty-sources.csv", "code,rate,source_note\nFEDERAL,0.1500,\nGA,4.99%,\nNONE,0,\n");
  assert.ok(csv.every((r) => r.sourceNote === "")); assert.equal(csv[1].rate, "0.0499");
  const prior = expect(await call("get", "/api/snapshots", cookie), 200)[0];
  const snapshot = expect(await call("post", "/api/snapshots", cookie, { fetchId: prior.fetchId }), 201);
  assert.equal(snapshot.note, "");
  let year = expect(await call("post", "/api/years", cookie, { calendarYear: 2030, snapshotId: snapshot.id, isPractice: true }), 201);
  const base = `/api/years/${year.id}`;
  year = expect(await call("post", `${base}/figures`, cookie, { grossCents: "11000000", costs: [{ amountCents: "0" }] }), 201);
  assert.equal(year.figures.note, ""); assert.equal(year.figures.costs[0].label, "Direct cost");
  const blocked = expect(await call("post", `${base}/finalize`, cookie, { note: "" }), 409);
  assert.match(blocked.error, /Declared per-share amount and declaration date are missing/);
  expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20" }), 201);
  year = expect(await call("post", `${base}/finalize`, cookie, { note: "" }), 201);
  assert.equal(year.status, "finalized");
  const finalNote = (await client.query("SELECT note FROM year_finalizations WHERE year_id=$1", [year.id])).rows[0].note;
  assert.equal(finalNote, "");
  // Also exercise omission, not merely empty-string notes, on a real year.
  const real = expect(await call("post", `/api/years/${fixture.detail.id}/finalize`, cookie, {}), 201);
  assert.equal(real.status, "finalized");
  const holder = year.holders.find((r) => r.displayName === "Forster Nancy Anne");
  year = expect(await call("post", `${base}/holds`, cookie, { personId: holder.personId, held: true, note: "" }), 201);
  assert.equal(year.holders.find((r) => r.personId === holder.personId).isOnHold, true);
  year = expect(await call("post", `${base}/holds`, cookie, { personId: holder.personId, held: false }), 201);
  assert.equal(year.holders.find((r) => r.personId === holder.personId).isOnHold, false);
  year = expect(await call("post", `${base}/payments`, cookie, { personId: holder.personId, kind: "cash", amountCents: "10000", date: "2026-10-20" }), 201);
  const cash = year.payments.find((p) => p.personId === holder.personId);
  assert.equal(cash.method, null); assert.equal(cash.note, "");
  year = expect(await call("post", `${base}/reversals`, cookie, { entryId: cash.id, date: "2026-10-20", note: "" }), 201);
  assert.equal(year.payments.find((p) => p.reversesEntryId === cash.id).note, "");
  year = expect(await call("post", `${base}/corrections`, cookie, { kind: "note" }), 201);
  assert.equal(year.status, "corrected");
  expect(await call("post", "/api/residences", cookie, { personId: holder.personId, stateCode: holder.stateCode, confirmed: true }), 201);
  const other = expect(await call("post", "/api/access", cookie, { email: "other@example.test" }), 201);
  assert.equal(other.note, "");
  const removed = expect(await call("post", "/api/access/remove", cookie, { personId: other.personId }), 201);
  assert.equal(removed.note, ""); assert.ok(removed.removedAt);
  expect(await call("post", "/api/access/remove", cookie, { personId: "test-bootstrap" }), 409);
  expect(await call("post", `${base}/reset-practice`, cookie, {}), 400);
  expect(await call("post", `${base}/reset-practice`, cookie, { confirmation: "reset" }), 400);
  record("Optional free-text sweep", {
    blankOrOmittedNotesHTTP: 201,
    fields: ["snapshot", "open year", "figures", "declaration", "practice/real finalization", "correction", "hold", "remove hold", "reversal", "residence", "add access", "remove access", "rate save", "rate copy", "federal/state source notes"],
    cashWithoutMethodHTTP: 201, unnamedCostLabel: "Direct cost",
    csvBlankSourcesAccepted: true, predeclarationFinalizeHTTP: 409,
    predeclarationReason: blocked.error, resetStillRequiresExactWord: true,
    lastAccessRemovalStillRefused: true,
    auditRows: (await client.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n,
  });
} catch (error) {
  record("Optional free-text sweep", { message: error.message, stack: error.stack }, "FAIL");
  process.exitCode = 1;
} finally {
  await h.finish();
}
