/**
 * DEVELOPMENT ONLY. Real API/SQL/Chromium/private storage, local Roster STUB.
 * All database changes use transaction-local tables and roll back; no emails.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { reportContext } from "../src/lib/reports/context.ts";
import { statementHtml, statementNoticeHtml, boardHtml } from "../src/lib/reports/templates.ts";
import { TAX_CAVEAT } from "../src/lib/reports/format.ts";
import { withPdfBrowser, onePagePdf } from "../src/lib/reports/pdf.ts";

const h = await stage2Harness();
const { client, call, expect, record } = h;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalized = (s) => s.replace(/\s+/g, " ").trim();
async function textPdf(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise, texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let text = "", previous;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const sameLine = previous && Math.abs(previous.transform[5] - item.transform[5]) < 1;
        const gap = previous ? item.transform[4] - previous.transform[4] - previous.width : 0;
        if (previous && (!sameLine || gap > 1)) text += " ";
        text += item.str; previous = item;
      }
      texts.push(normalized(text));
    }
    return { pages: pdf.numPages, text: texts.join("\n") };
  } finally { await task.destroy(); }
}
// Captured from the pre-NIIT templates, with the fixed fixture, generation time
// and database label below. Permanent goldens must not depend on Git HEAD:
// they must still enforce the old bytes after this change has been committed.
const legacyGoldens = {
  statementHtml: "5279b77e1fc58762d9ec8ab5d0439e25c4873aab7386a46e1162343c8617e1b3",
  statementNoticeHtml: "9d7ff51a1cd2851be1e0939797190675a1846125a65ae2f017dbd449ce5b78ab",
  boardHtml: "041808eea8aaf7e11dd43fd80a92e88b4ddda86649955a3dbba857fd2eeffc46",
};
try {
  record("Environment / identity", { environment: "development", ...(await client.query("SELECT current_database() AS database, inet_server_addr() AS server_address")).rows[0] });
  const f = await finalizedFixture(h, { isPractice: true });
  const { cookie, base } = f;
  const originalRates = expect(await call("get", "/api/rates", cookie), 200)[0];
  const rates = { ...originalRates, niitRate: "0.0380", niitSourceNote: "STUB NIIT acceptance",
    states: originalRates.states.map((r) => r.stateCode === "CA" ? { ...r, rate: "0.0930" } : r) };
  expect(await call("post", "/api/rates", cookie, rates), 201);
  let detail = expect(await call("post", `${base}/figures`, cookie, {
    grossCents: "8680000", costs: [{ label: "Zero-cost line", amountCents: "0" }],
  }), 201);
  assert.equal(detail.calculation.proposedPerShareCents, "5273");
  assert.equal(detail.calculation.federalRate, "0.1500");
  assert.equal(detail.calculation.niitRate, "0.0380");
  assert.equal(detail.calculation.highestStateRate, "0.0930");
  assert.equal(detail.calculation.combinedRate, "0.2430");
  assert.equal(detail.calculation.niitIncludedInPool, false);
  assert.equal(detail.calculation.poolCents, "2109240");
  record("Exact board-policy pool formula", { ...detail.calculation, exactDollarsPerShare: "52.731", rounding: "half away from zero", formula: "$86,800 × (0.1500 + 0.0930) / 400" });
  detail = expect(await call("post", `${base}/declaration`, cookie, {
    declaredPerShareCents: "5273", declarationDate: "2026-10-20",
  }), 201);
  const ma = detail.holders.find((r) => r.displayName === "Forster Nancy Anne");
  assert.equal(ma.combinedRate, "0.2000");
  const ca = detail.holders.find((r) => r.displayName === "Davis Allan");
  assert.equal(ca.combinedRate, "0.2430");
  const list = expect(await call("get", "/api/residences", cookie), 200);
  assert.ok(list.every((r) => r.subjectToNiit === false));
  const before = list.find((r) => r.personId === ma.personId);
  const updated = expect(await call("post", "/api/residences", cookie, {
    personId: ma.personId, expectedRevisionId: before.id, stateCode: "MA",
    subjectToNiit: true, confirmed: true,
  }), 201);
  detail = expect(await call("get", base, cookie), 200);
  assert.equal(detail.holders.find((r) => r.personId === ma.personId).combinedRate, "0.2380");
  expect(await call("post", "/api/residences", cookie, { personId: ca.personId, stateCode: "CA", subjectToNiit: true, confirmed: true }), 201);
  detail = expect(await call("get", base, cookie), 200);
  assert.equal(detail.holders.find((r) => r.personId === ca.personId).combinedRate, "0.2810");
  assert.equal(detail.calculation.combinedRate, "0.2430", "NIIT must never enter a draft pool");
  assert.equal(detail.calculation.proposedPerShareCents, "5273");
  assert.equal((await client.query("SELECT subject_to_niit FROM tax_residences WHERE id=$1", [before.id])).rows[0].subject_to_niit, false);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='tax_residences' AND record_id=$1", [String(updated.id)])).rows[0].n, 1);
  record("Per-holder applicability / append-only audit", { defaults: "All 47 No", MassachusettsSubject: "0.2380", MassachusettsNotSubject: "0.2000", CaliforniaNotSubject: "0.2430", CaliforniaSubject: "0.2810", poolUnchanged: "0.2430", previousRevisionPreserved: true, auditRows: 1 });
  expect(await call("post", "/api/residences", cookie, { personId: ma.personId, stateCode: "MA", subjectToNiit: false, confirmed: true }), 201);
  // Omitted field preserves a prior No; confirm-all preserves No as well.
  let residence = expect(await call("post", "/api/residences", cookie, {
    personId: ma.personId, stateCode: "MA", confirmed: false,
  }), 201);
  assert.equal(residence.subjectToNiit, false);
  const confirmed = expect(await call("post", "/api/residences/confirm-all", cookie, { revisionIds: [residence.id] }), 200);
  assert.equal(confirmed.confirmedCount, 1);
  residence = expect(await call("get", "/api/residences", cookie), 200).find((r) => r.personId === ma.personId);
  assert.equal(residence.subjectToNiit, false); assert.equal(residence.confirmed, true);
  record("Confirm all includes applicability", { confirmed: 1, subjectToNiit: false, noteRequired: false });
  const copied = expect(await call("post", "/api/rates/copy", cookie, { fromYear: 2026, toYear: 2027 }), 201);
  assert.equal(copied.niitRate, "0.0380");
  const fresh = expect(await call("post", "/api/rates", cookie, { taxYear: 2028, federalRate: "0.1500", states: [] }), 201);
  assert.equal(fresh.niitRate, "0.0380");
  // An existing nullable baseline gains an effective default without mutating it.
  await client.query("INSERT INTO rate_tables (tax_year,federal_rate,federal_source_note,created_by,note) VALUES (2029,'0.1500','','test-bootstrap','legacy draft')");
  assert.equal(expect(await call("get", "/api/rates", cookie), 200).find((r) => r.taxYear === 2029).niitRate, "0.0380");
  assert.equal((await client.query("SELECT niit_rate FROM rate_tables WHERE tax_year=2029")).rows[0].niit_rate, null);
  record("Rate defaults / copy / existing revisions", { created: fresh.niitRate, copied: copied.niitRate, legacyEffectiveDefault: "0.0380", oldRevisionNotUpdated: true });
  const csvInput = { taxYear: 2027, filename: "NIIT.csv", csv: "code,rate,source_note\nNIIT,3.8%,federal threshold\n" };
  const preview = expect(await call("post", "/api/rates/csv/preview", cookie, csvInput), 200);
  assert.equal(preview.rows[0].rate, "0.0380");
  expect(await call("post", "/api/rates/csv/confirm", cookie, { ...csvInput, previewToken: preview.previewToken }), 200);
  assert.match((await call("get", "/api/rates/2027/csv", cookie)).text, /NIIT,0.0380,federal threshold/);
  expect(await call("post", "/api/rates", cookie, { ...rates, niitRate: "1.0001" }), 400);
  expect(await call("post", "/api/residences", cookie, { personId: ma.personId, stateCode: "MA", confirmed: true, subjectToNiit: "no" }), 400);
  record("NIIT CSV / validation", { csvPercent: "0.0380", exportContainsNIIT: true, invalidRate: 400, invalidFlag: 400 });
  const ctx = await reportContext(f.detail.id);
  const holder = ctx.year.holders.find((r) => r.displayName === "Davis Allan");
  await withPdfBrowser(async (browser) => {
    for (const [name, html, compact] of [
      ["notice", statementNoticeHtml(ctx, holder), false],
      ["statement", statementHtml(ctx, holder), false],
      ["board", boardHtml(ctx), true],
    ]) {
      const pdf = await textPdf(await onePagePdf(browser, html, compact));
      assert.equal(pdf.pages, 1);
      for (const term of ["15.00%", "3.80%", "9.30%"]) assert.ok(pdf.text.includes(term), `${name} missing ${term}`);
      assert.ok(pdf.text.includes(TAX_CAVEAT), `${name} missing full caveat`);
      assert.match(pdf.text, /PRACTICE — NOT A STATEMENT/);
      if (name === "board") assert.ok(pdf.text.includes("Federal NIIT — not included in the pool (board policy)"));
      record(`PDF ${name}: rates and caveat`, { pages: pdf.pages, components: ["15.00%", "3.80%", "9.30%"], caveat: TAX_CAVEAT, text: pdf.text });
    }
    const exempt = ctx.year.holders.find((r) => r.personId === ma.personId);
    const noNiit = await textPdf(await onePagePdf(browser, statementHtml(ctx, exempt)));
    assert.match(noNiit.text, /Federal NIIT at 0.00% \(not subject\) \$0.00/);
    record("Exempt-holder PDF", { niit: "Federal NIIT at 0.00% (not subject) $0.00" });
  });
  // Create a pre-NIIT frozen year in test-only tables, using the original fixture
  // inputs with the new fields removed. Never alter a real finalized record.
  const { draftInputs } = await import("../src/lib/distribution-years.ts");
  const { db } = await import("@workspace/db");
  const legacyInputs = await draftInputs(db, f.detail.id);
  delete legacyInputs.rates.niitRate;
  delete legacyInputs.rates.niitIncludedInPool;
  // Historical golden fixture retains its original distribution, independent
  // of the amended draft declaration above.
  legacyInputs.declaration.declaredPerShareCents = "6098";
  for (const r of legacyInputs.residences) delete r.subjectToNiit;
  await client.query("INSERT INTO year_finalizations (year_id,frozen_inputs,created_by,note) VALUES ($1,$2,'test-bootstrap','STUB pre-NIIT frozen year')", [f.detail.id, JSON.stringify(legacyInputs)]);
  const frozenBefore = (await client.query("SELECT frozen_inputs::text FROM year_finalizations WHERE year_id=$1", [f.detail.id])).rows[0].frozen_inputs;
  const finalBefore = expect(await call("get", base, cookie), 200);
  const legacyCtx = await reportContext(f.detail.id);
  const legacyHolder = legacyCtx.year.holders.find((r) => r.personId === holder.personId);
  const stableLegacyContext = { ...legacyCtx, generatedAt: "2026-11-08T00:00:00.000Z", databaseName: "STUB-db", serverAddress: null };
  const legacyTemplateHashes = {};
  const beforeTemplates = {};
  for (const name of ["statementHtml", "statementNoticeHtml", "boardHtml"]) {
    const args = name === "boardHtml" ? [legacyCtx] : [legacyCtx, legacyHolder];
    const actual = { statementHtml, statementNoticeHtml, boardHtml }[name](...args);
    beforeTemplates[name] = actual;
    legacyTemplateHashes[name] = digest({ statementHtml, statementNoticeHtml, boardHtml }[name](stableLegacyContext, legacyHolder));
    assert.equal(legacyTemplateHashes[name], legacyGoldens[name], `${name}: pre-NIIT document HTML must remain byte-identical`);
  }
  const { yearDocumentStore } = await import("../src/lib/year-document-store.ts");
  const stored = (await client.query("SELECT object_path FROM year_documents WHERE id=$1", [f.source.id])).rows[0];
  const object = await yearDocumentStore.getFile(stored.object_path);
  const [documentBefore] = await object.download();
  // Preserve an actual pre-change report PDF as well as the source image.
  // Generated-on-demand PDFs have per-download timestamps/Chromium metadata;
  // unchanged historical document bytes and identical HTML are separate checks.
  const legacyPdf = await withPdfBrowser((browser) => onePagePdf(browser, beforeTemplates.statementHtml));
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, {
    filename: "STUB-pre-NIIT-finalized-statement.pdf", contentType: "application/pdf", size: legacyPdf.length,
  }), 201);
  assert.ok((await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: legacyPdf })).ok);
  const sealedPdf = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  assert.deepEqual((await call("get", sealedPdf.downloadUrl, cookie)).body, legacyPdf);
  expect(await call("post", "/api/rates", cookie, { ...rates, federalRate: "0.1900", niitRate: "0.0500" }), 201);
  expect(await call("post", "/api/residences", cookie, { personId: holder.personId, stateCode: "NONE", subjectToNiit: false, confirmed: true }), 201);
  const finalAfter = expect(await call("get", base, cookie), 200);
  assert.deepEqual(finalAfter.calculation, finalBefore.calculation);
  assert.deepEqual(finalAfter.holders, finalBefore.holders);
  assert.equal((await client.query("SELECT frozen_inputs::text FROM year_finalizations WHERE year_id=$1", [f.detail.id])).rows[0].frozen_inputs, frozenBefore);
  const [documentAfter] = await object.download();
  assert.deepEqual(documentBefore, documentAfter);
  const sealedPdfAfter = (await call("get", sealedPdf.downloadUrl, cookie)).body;
  assert.deepEqual(sealedPdfAfter, legacyPdf);
  const afterCtx = { ...await reportContext(f.detail.id), generatedAt: legacyCtx.generatedAt };
  for (const name of ["statementHtml", "statementNoticeHtml", "boardHtml"]) {
    const fn = { statementHtml, statementNoticeHtml, boardHtml }[name];
    assert.equal(fn(afterCtx, legacyHolder), beforeTemplates[name]);
  }
  record("Finalized legacy figures and documents preserved", {
    frozenInputsByteIdentical: true, calculationAndHolderResultsIdentical: true,
    noticeStatementBoardHTMLByteIdenticalToPreChangeCode: true,
    storedDocumentBytesIdentical: true, documentSha256: digest(documentAfter),
    storedLegacyPdfBytesIdentical: true, legacyPdfSha256: digest(sealedPdfAfter), legacyPdfBytes: legacyPdf.length,
    legacyTemplateHashes,
    comparisonGenerationTimeHeldConstant: true,
  });
  // New finalizations must freeze NIIT and applicability, including No.
  const practice = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId: f.detail.snapshotId }), 201);
  const newBase = `/api/years/${practice.id}`;
  expect(await call("post", `${newBase}/figures`, cookie, { grossCents: "8680000", costs: [] }), 201);
  expect(await call("post", `${newBase}/declaration`, cookie, { declaredPerShareCents: "5273", declarationDate: "2026-10-20" }), 201);
  const locked = expect(await call("post", `${newBase}/finalize`, cookie, {}), 201);
  const frozen = (await client.query("SELECT frozen_inputs FROM year_finalizations WHERE year_id=$1", [practice.id])).rows[0].frozen_inputs;
  assert.equal(frozen.rates.niitRate, "0.0500");
  assert.equal(frozen.rates.niitIncludedInPool, false);
  assert.equal(frozen.residences.find((r) => r.personId === ma.personId).subjectToNiit, false);
  expect(await call("post", "/api/rates", cookie, rates), 201);
  const unchanged = expect(await call("get", newBase, cookie), 200);
  assert.deepEqual(unchanged.calculation, locked.calculation);
  record("New finalizations freeze NIIT and holder flag", { rate: frozen.rates.niitRate, niitIncludedInPool: frozen.rates.niitIncludedInPool, MassachusettsSubject: false, laterRateRevisionDoesNotChangeFinalizedCalculation: true });
  // Preserve a year finalized under the first, NIIT-inclusive policy too.
  const archived = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice: true, snapshotId: f.detail.snapshotId }), 201);
  const archivedBase = `/api/years/${archived.id}`;
  const oldNiitInputs = structuredClone(legacyInputs);
  oldNiitInputs.rates.niitRate = "0.0380";
  for (const r of oldNiitInputs.residences) r.subjectToNiit = true;
  await client.query("INSERT INTO year_finalizations (year_id,frozen_inputs,created_by,note) VALUES ($1,$2,'test-bootstrap','STUB original NIIT-inclusive finalization')", [archived.id, JSON.stringify(oldNiitInputs)]);
  const archivedBefore = expect(await call("get", archivedBase, cookie), 200);
  assert.equal(archivedBefore.calculation.combinedRate, "0.2810");
  assert.equal(archivedBefore.calculation.proposedPerShareCents, "6098");
  const archivedRaw = (await client.query("SELECT frozen_inputs::text FROM year_finalizations WHERE year_id=$1", [archived.id])).rows[0].frozen_inputs;
  const archivedCtx = await reportContext(archived.id);
  const archivedHolder = archivedCtx.year.holders.find((r) => r.personId === ca.personId);
  const archivedTemplates = [statementHtml(archivedCtx, archivedHolder), statementNoticeHtml(archivedCtx, archivedHolder), boardHtml(archivedCtx)];
  assert.match(archivedTemplates[2], />NIIT rate</);
  assert.doesNotMatch(archivedTemplates[2], /not included in the pool/);
  expect(await call("post", "/api/rates", cookie, { ...rates, niitRate: "0.1000" }), 201);
  expect(await call("post", "/api/residences", cookie, { personId: ca.personId, stateCode: "CA", subjectToNiit: false, confirmed: true }), 201);
  const archivedAfter = expect(await call("get", archivedBase, cookie), 200);
  assert.deepEqual(archivedAfter.calculation, archivedBefore.calculation);
  assert.deepEqual(archivedAfter.holders, archivedBefore.holders);
  assert.equal((await client.query("SELECT frozen_inputs::text FROM year_finalizations WHERE year_id=$1", [archived.id])).rows[0].frozen_inputs, archivedRaw);
  const archivedAfterCtx = { ...await reportContext(archived.id), generatedAt: archivedCtx.generatedAt };
  assert.deepEqual([statementHtml(archivedAfterCtx, archivedHolder), statementNoticeHtml(archivedAfterCtx, archivedHolder), boardHtml(archivedAfterCtx)], archivedTemplates);
  record("Original NIIT-inclusive finalization preserved", { combinedRate: "0.2810", proposedPerShareCents: "6098", frozenInputsByteIdentical: true, templatesByteIdentical: true, noPolicyInjected: true });
  expect(await call("post", "/api/residences", null, { personId: ma.personId, stateCode: "MA", subjectToNiit: true, confirmed: true }), 401);
  record("Access checks", { anonymousResidenceWrite: 401 });
} catch (error) {
  h.results.push({ check: "NIIT verification failure", result: "FAIL", evidence: error.stack ?? error.message });
  process.exitCode = 1;
} finally { await h.finish(); }
