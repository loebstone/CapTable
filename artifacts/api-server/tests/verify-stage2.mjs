import assert from "node:assert/strict";
import { rosterFixture } from "./roster-fixture.ts";
import { stage2Harness } from "./stage2-harness.mjs";

const h = await stage2Harness();
const { client, call, login, expect, record, results } = h;
const year = 2026;
const stateRates = { CA: "0.1330", CO: "0.0440", CT: "0.0699", FL: "0.0000", GA: "0.0539", HI: "0.0725", MA: "0.0500", ME: "0.0715", MO: "0.0470", VA: "0.0575", WY: "0.0000", NONE: "0.0000" };
const rateInput = {
  taxYear: year, federalRate: "0.1500", federalSourceNote: "STUB acceptance-test federal source (not tax advice)",
  states: Object.entries(stateRates).map(([stateCode, rate]) => ({ stateCode, rate, sourceNote: `STUB acceptance-test ${stateCode} source` })),
  note: "STUB acceptance-test rates only",
};
const absolute = (value) => value < 0n ? -value : value;
const pdfDocument = (label) => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 50 700 Td (${label}) Tj ET`)} >>\nstream\nBT /F1 12 Tf 50 700 Td (${label}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
};

try {
  const identity = (await client.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address")).rows[0];
  results.push({ check: "Observed database identity", environment: "development; NODE_ENV=test in verification process only", observed: identity });
  assert.equal((await client.query("SELECT count(*)::int AS n FROM access_entries")).rows[0].n, 0, "Verification requires an uninitialized development access list");
  const cookie = await login();
  const fetched = expect(await call("post", "/api/holdings/fetch", cookie), 200);
  assert.equal(fetched.holdings.length, 47);
  const snapshot = expect(await call("post", "/api/snapshots", cookie, { fetchId: fetched.id, note: "STUB Stage 2 acceptance fixture; 47 holders / 400 shares" }), 201);
  expect(await call("post", "/api/rates", cookie, rateInput), 201);
  let detail = expect(await call("post", "/api/years", cookie, { calendarYear: year, snapshotId: snapshot.id, note: "STUB development acceptance year" }), 201);
  const id = detail.id, base = `/api/years/${id}`;
  assert.equal(detail.holders.length, 47);

  const short = structuredClone(rosterFixture);
  const cRow = short.holdings.find((r) => r.shareClass === "C");
  cRow.shares = "1.0000"; // Ashley 2.0000 -> 1.0000, exactly one share short.
  short.classes.find((c) => c.shareClass === "C").totalShares = "99.0000";
  short.grandTotal = "399.0000";
  h.setHoldings(short);
  const badFetch = expect(await call("post", "/api/holdings/fetch", cookie), 200);
  const badSnapshot = expect(await call("post", "/api/snapshots", cookie, { fetchId: badFetch.id, note: "STUB Class C short by 1.0000 verification" }), 201);
  const refused = expect(await call("post", "/api/years", cookie, { calendarYear: year + 1, snapshotId: badSnapshot.id, note: "Must be refused" }), 409);
  assert.match(refused.error, /Class C.*short.*1\.0000/);
  record("1. Exact snapshot totals", { validSnapshotRows: 47, classTotals: snapshot.classes, grandTotal: snapshot.grandTotal, openedYear: year, invalidHTTP: 409, refusal: refused.error });
  const missingRates = expect(await call("post", "/api/years", cookie, { calendarYear: year + 1, snapshotId: snapshot.id, note: "Missing rate table must block opening" }), 409);
  assert.match(missingRates.error, /No rate table exists.*2027/);
  record("Missing year rates", missingRates.error);
  h.setHoldings(rosterFixture);

  // Real private file upload/attachment/download; no fake storage adapter.
  const pdf = pdfDocument("STUB Stage 2 test source - gross 110000 dollars, direct cost zero.");
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "STUB-stage2-verification-source.pdf", contentType: "application/pdf", size: pdf.length }), 201);
  const put = await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdf });
  assert.ok(put.ok, `Storage PUT failed: ${put.status}`);
  const document = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  const downloaded = await call("get", document.downloadUrl, cookie);
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.body, pdf);
  assert.match(downloaded.headers["cache-control"], /no-store/);
  const { yearDocumentStore } = await import("../src/lib/year-document-store.ts");
  const { ObjectStorageService } = await import("../src/lib/objectStorage.ts");
  const storage = new ObjectStorageService();
  const stagingPath = storage.normalizeObjectEntityPath(slot.uploadURL);
  await assert.rejects(storage.getObjectEntityFile(stagingPath), { name: "ObjectNotFoundError" });
  const sealedPath = (await client.query("SELECT object_path FROM year_documents WHERE id=$1", [document.id])).rows[0].object_path;
  const sealed = await yearDocumentStore.getFile(sealedPath);
  const unsigned = await fetch(sealed.publicUrl(), { redirect: "error" });
  assert.ok([401, 403].includes(unsigned.status), `Unsigned sealed-object fetch returned ${unsigned.status}`);
  record("N2. Sealed object not publicly readable", { authenticatedAppDownload: 200, unsignedStorageFetch: unsigned.status, objectExists: true, urlNotPrinted: true, stagingRemovedAfterSeal: true });
  const overwrite = await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfDocument("Changed staging bytes must not change sealed attachment.") });
  assert.ok(overwrite.ok);
  assert.deepEqual((await call("get", document.downloadUrl, cookie)).body, pdf);
  // The deliberately reused signed PUT can recreate staging, never the sealed file.
  await (await storage.getObjectEntityFile(stagingPath)).delete({ ignoreNotFound: true });
  expect(await call("get", document.downloadUrl), 401);
  record("Real private source-document storage", { filename: document.filename, uploadedAt: document.uploadedAt, bytes: pdf.length, directPUT: put.status, authenticatedDownload: 200, anonymousDownload: 401, stagingOverwriteCannotAlterAttachment: true, storageSource: "REAL APP STORAGE (Roster remains STUB)" });
  const figures = { grossCents: "11000000", grossDocumentId: document.id, costs: [{ label: "Zero-cost test line", amountCents: "0", documentId: document.id }], note: "STUB net profit $110,000.00 with one zero-cost line" };
  const missingDoc = await call("post", `${base}/figures`, cookie, { ...figures, grossDocumentId: 2147483647 });
  expect(missingDoc, 400);
  detail = expect(await call("post", `${base}/figures`, cookie, figures), 201);
  const unconfirmed = expect(await call("post", `${base}/finalize`, cookie, { note: "Unconfirmed residences must block" }), 409);
  assert.match(unconfirmed.error, /unconfirmed/);
  const residences = expect(await call("get", "/api/residences", cookie), 200);
  for (const residence of residences) {
    expect(await call("post", "/api/residences", cookie, {
      personId: residence.personId, stateCode: residence.displayName === "Gaston Natalie Davis" ? "GA" : residence.stateCode,
      confirmed: true, note: "STUB acceptance test: Natalie GA; all residences confirmed",
    }), 201);
  }
  detail = expect(await call("get", base, cookie), 200);
  assert.equal(detail.calculation.netProfitCents, "11000000");
  assert.equal(detail.calculation.highestState, "CA");
  assert.equal(detail.calculation.combinedRate, "0.2830");
  assert.equal(detail.calculation.poolCents, "3113000");
  assert.equal(detail.calculation.proposedPerShareCents, "7783");
  record("2. Worked proposed per-share calculation", { ...detail.calculation, exactUnroundedPerShareCents: "7782.5", roundedHalfAwayFromZeroCents: "7783", UI: "WorkedTable renders each returned arithmetic row; signed-in UI not browser-verified" });
  detail = expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20", note: "STUB declared equal to rounded proposed per-share" }), 201);
  // User-corrected acceptance targets: exact formula values from the declared
  // $77.83; the original two hand-spreadsheet approximations were superseded.
  const expectedSurpluses = { "Forster Nancy Anne": 45600n, "Pieropan Nancy": 30700n, "Davis Kiel": 27700n, "Esmond Robert III": 86787n, "Holmes Brette Kameny": 58528n };
  const comparisons = Object.entries(expectedSurpluses).map(([name, expectedCents]) => {
    const holder = detail.holders.find((r) => r.displayName === name);
    const actual = BigInt(holder.surplusCents);
    const toleranceCents = ["Esmond Robert III", "Holmes Brette Kameny"].includes(name) ? 5n : 100n;
    return { holder: name, expectedCents: expectedCents.toString(), observedCents: actual.toString(), differenceCents: (actual - expectedCents).toString(), toleranceCents: toleranceCents.toString(), withinTolerance: absolute(actual - expectedCents) <= toleranceCents, nominalCents: holder.nominalCents, shareOfGainCents: holder.shareOfGainCents, estimatedTaxCents: holder.estimatedTaxCents, stateRate: holder.stateRate };
  });
  const ca = detail.holders.filter((r) => r.stateCode === "CA");
  assert.ok(ca.every((r) => absolute(BigInt(r.surplusCents)) <= 100n));
  const held = detail.holders.filter((r) => r.status === "held").map((r) => r.displayName).sort();
  assert.deepEqual(held, ["Adorno Marco", "Kneisel Geoffrey"]);
  const discrepancies = comparisons.filter((r) => !r.withinTolerance);
  record("3. Per-holder surplus and unsettled holds", { ca: ca.map((r) => ({ holder: r.displayName, surplusCents: r.surplusCents })), requestedExamples: comparisons, automaticallyHeld: held, explanation: "User-corrected targets: Esmond $867.87 and Holmes $585.28, each ±$0.05; other original targets remain ±$1." }, discrepancies.length ? "FAIL: surplus outside accepted tolerance" : "PASS");

  expect(await call("post", "/api/rates", cookie, { ...rateInput, states: rateInput.states.filter((r) => r.stateCode !== "GA"), note: "STUB omit GA as required by acceptance test" }), 201);
  const blocked = expect(await call("post", `${base}/finalize`, cookie, { note: "Must name Natalie and missing GA rate" }), 409);
  assert.match(blocked.error, /Gaston Natalie Davis.*GA/);
  expect(await call("post", "/api/rates", cookie, { ...rateInput, note: "STUB restore GA before finalization" }), 201);
  detail = expect(await call("post", `${base}/finalize`, cookie, { note: "STUB finalization with all confirmed and all rates present" }), 201);
  assert.equal(detail.status, "finalized");
  const originalCalculation = structuredClone(detail.calculation);
  const rejectedEdit = expect(await call("post", `${base}/figures`, cookie, { ...figures, grossCents: "1", note: "Must not modify finalized figure" }), 409);
  const blankCorrection = await call("post", `${base}/corrections`, cookie, { kind: "note", note: "   " });
  expect(blankCorrection, 400);
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "note", note: "STUB correction: explanatory note added without altering original inputs" }), 201);
  assert.equal(detail.status, "corrected"); assert.deepEqual(detail.calculation, originalCalculation);
  record("4. Finalization blockers, locking and correction", { missingGAHTTP: 409, missingGAError: blocked.error, restoredFinalizationHTTP: 201, finalizedGrossEditHTTP: 409, editError: rejectedEdit.error, blankCorrectionHTTP: 400, notedCorrectionHTTP: 201, status: detail.status, originalCalculationUnchanged: true });
  expect(await call("post", "/api/rates", cookie, { ...rateInput, federalRate: "0.0000", note: "STUB later rate revision must not change finalized year" }), 201);
  const natalie = detail.holders.find((r) => r.displayName === "Gaston Natalie Davis");
  expect(await call("post", "/api/residences", cookie, { personId: natalie.personId, stateCode: "NONE", confirmed: true, note: "STUB later residence must not change finalized year" }), 201);
  h.setHoldings(short);
  expect(await call("post", "/api/holdings/fetch", cookie), 200);
  detail = expect(await call("get", base, cookie), 200);
  assert.deepEqual(detail.calculation, originalCalculation);
  assert.equal(detail.holders.find((r) => r.personId === natalie.personId).stateCode, "GA");
  record("Frozen inputs", "Later rate, residence and Roster revisions leave finalized calculation and Natalie GA unchanged");

  const nominal = detail.holders.reduce((s, r) => s + BigInt(r.nominalCents), 0n);
  const pool = 7783n * 400n;
  assert.equal(detail.calculation.sumNominalCents, nominal.toString());
  assert.equal(detail.calculation.declaredPoolCents, pool.toString());
  assert.equal(detail.calculation.residualCents, (nominal - pool).toString());
  assert.ok(absolute(nominal - pool) <= BigInt(detail.holders.length)); // per-holder rounding bound <= 0.5 cent each
  record("5. Nominal reconciliation", { sumNominalCents: nominal.toString(), declaredPerShareTimes400Cents: pool.toString(), residualCents: (nominal - pool).toString() });

  const holder = detail.holders.find((r) => r.displayName === "Forster Nancy Anne");
  assert.deepEqual([holder.shareOfGainCents, holder.nominalCents, holder.estimatedTaxCents, holder.surplusCents], ["550000", "155660", "110000", "45660"]);
  const entryCount = (await client.query("SELECT count(*)::int AS n FROM distribution_entries")).rows[0].n;
  for (const name of ["Adorno Marco", "Kneisel Geoffrey"]) {
    const onHold = detail.holders.find((r) => r.displayName === name);
    assert.equal(onHold.instruction, "Hold"); assert.equal(onHold.isOnHold, true);
    for (const kind of ["cash", "apic"]) {
      const denied = expect(await call("post", `${base}/payments`, cookie, { personId: onHold.personId, kind, amountCents: "100", date: "2026-10-20", method: "STUB test" }), 409);
      assert.equal(denied.error, "This holder is on hold — remove the hold first.");
    }
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM distribution_entries")).rows[0].n, entryCount);
  record("Hold payment guard and display figures", { ForsterCents: ["550000", "155660", "110000", "45660"], defaultHold: ["Adorno Marco", "Kneisel Geoffrey"], cashAndApicOnHoldHTTP: 409, rejectedEntriesWritten: 0 });
  const payment = { personId: holder.personId, kind: "cash", amountCents: (BigInt(holder.nominalCents) + 1n).toString(), date: "2026-10-20", method: "STUB paper check 101", note: "STUB test paid entry" };
  const overpaid = expect(await call("post", `${base}/payments`, cookie, payment), 409);
  detail = expect(await call("post", `${base}/payments`, cookie, { ...payment, amountCents: "100000" }), 201);
  const cashEntry = detail.payments.find((e) => e.personId === holder.personId && e.kind === "cash");
  const apicAmount = BigInt(holder.nominalCents) - 100000n;
  detail = expect(await call("post", `${base}/payments`, cookie, { personId: holder.personId, kind: "apic", amountCents: apicAmount.toString(), date: "2026-10-19", note: "STUB direction letter received on the recorded date" }), 201);
  assert.equal(detail.holders.find((r) => r.personId === holder.personId).instruction, "✓");
  assert.equal(detail.holders.find((r) => r.personId === holder.personId).status, "complete");
  assert.equal(detail.holders.find((r) => r.personId === holder.personId).remainingCents, "0");
  expect(await call("post", `${base}/reversals`, cookie, { entryId: cashEntry.id, date: "2026-10-20", note: " " }), 400);
  detail = expect(await call("post", `${base}/reversals`, cookie, { entryId: cashEntry.id, date: "2026-10-20", note: "STUB reverse mistaken cash entry" }), 201);
  const reopened = detail.holders.find((r) => r.personId === holder.personId);
  assert.equal(reopened.status, "open"); assert.equal(reopened.remainingCents, "100000");
  expect(await call("post", `${base}/reversals`, cookie, { entryId: cashEntry.id, date: "2026-10-20", note: "Duplicate reversal must fail" }), 409);
  record("6. Paid/APIC cap, completion and reversal", { overpaymentHTTP: 409, error: overpaid.error, nominalCents: holder.nominalCents, cashCents: "100000", retainedCents: apicAmount.toString(), combinedStatus: "complete", reversalCents: "-100000", blankReversalHTTP: 400, duplicateReversalHTTP: 409, afterReversal: { status: reopened.status, remainingCents: reopened.remainingCents }, totals: detail.totals });

  const marco = detail.holders.find((r) => r.displayName === "Adorno Marco");
  expect(await call("post", `${base}/holds`, cookie, { personId: marco.personId, held: false, note: " " }), 400);
  detail = expect(await call("post", `${base}/holds`, cookie, { personId: marco.personId, held: false, note: "STUB manual release with note" }), 201);
  assert.equal(detail.holders.find((r) => r.personId === marco.personId).status, "open");
  assert.equal(detail.holders.find((r) => r.personId === marco.personId).instruction, "Pay");
  assert.equal(detail.holders.find((r) => r.personId === marco.personId).isOnHold, false);
  detail = expect(await call("post", `${base}/holds`, cookie, { personId: marco.personId, held: true, note: "STUB restore hold with note" }), 201);
  assert.equal(detail.holders.find((r) => r.personId === marco.personId).status, "held");
  record("Manual held status", "Required note enforced; explicit release/re-hold appended and reflected in history");
  // Monetary correction is a signed delta, not a replacement of frozen inputs.
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "grossAdjustment", amountCents: "100", documentId: document.id, note: "STUB add one dollar of gross via explicit correction" }), 201);
  assert.equal(detail.calculation.grossCents, "11000100"); assert.deepEqual(detail.originalCalculation, originalCalculation);
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "grossAdjustment", amountCents: "-100", documentId: document.id, note: "STUB offset prior correction with another appended entry" }), 201);
  assert.deepEqual(detail.calculation, originalCalculation);
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "costAdjustment", amountCents: "100", documentId: document.id, note: "STUB add one dollar cost via correction" }), 201);
  assert.equal(detail.calculation.costTotalCents, "100");
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "costAdjustment", amountCents: "-100", documentId: document.id, note: "STUB offset cost correction with a negative adjustment" }), 201);
  assert.deepEqual(detail.calculation, originalCalculation);
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "declaredPerShareAdjustment", amountCents: "1", declarationDate: "2026-10-20", note: "STUB one-cent per-share declaration adjustment" }), 201);
  assert.equal(detail.declaredPerShareCents, "7784");
  detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "declaredPerShareAdjustment", amountCents: "-1", declarationDate: "2026-10-20", note: "STUB offset declaration adjustment" }), 201);
  assert.deepEqual(detail.calculation, originalCalculation);
  expect(await call("post", `${base}/corrections`, cookie, { kind: "declaredPerShareAdjustment", amountCents: "-7783", declarationDate: "2026-10-20", note: "STUB must reject lowering nominal below retained APIC" }), 409);
  record("Signed financial corrections", "Gross +100/-100, cost +100/-100 and per-share +1/-1 cent adjustments append; frozen original remains identical; correction below retained amount rejected (409)");

  expect(await call("post", "/api/access", cookie, { email: "other@example.test", note: "STUB access-gate probe" }), 201);
  const other = await login("other@example.test");
  expect(await call("post", "/api/access/remove", cookie, { personId: "test-other", note: "STUB revoke access before probing every new route" }), 201);
  const privateRoutes = [["get", "/api/years"], ["post", "/api/years"], ["get", base], ...["figures", "declaration", "finalize", "corrections", "payments", "reversals", "holds", "documents/uploads", "documents"].map((s) => ["post", `${base}/${s}`]), ["get", document.downloadUrl]];
  for (const [method, path] of privateRoutes) expect(await call(method, path, other, {}), 403);
  record("All new routes enforce server-side access", `${privateRoutes.length} year/ledger/document routes rejected an existing session after local access removal (403), before body validation`);

  const tables = ["distribution_years", "year_uploads", "year_documents", "year_figures", "year_costs", "year_declarations", "year_finalizations", "year_corrections", "distribution_entries", "distribution_holds"];
  const auditEvidence = [];
  for (const table of tables) {
    const rows = (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    const audited = (await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity=$1", [table])).rows[0].n;
    assert.equal(audited, rows, `Every insert into ${table} must be audited`);
    auditEvidence.push({ entity: table, rows, auditRows: audited });
  }
  record("Append-only audit coverage", auditEvidence);
  assert.equal((await client.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "read committed");
  record("Rollback harness integrity", "Outer transaction remains active; route transactions mapped to savepoints");
  if (discrepancies.length) process.exitCode = 1; // Report specification mismatch, never falsify arithmetic.
} finally {
  await h.finish();
}
