/**
 * Exact Stage 2 acceptance inputs, created through real app routes inside the
 * caller's rollback transaction. Local Roster STUB; real private App Storage.
 */
export async function finalizedFixture(h, { isPractice = false } = {}) {
  const { call, expect, login } = h;
  const cookie = await login();
  const fetched = expect(await call("post", "/api/holdings/fetch", cookie), 200);
  const snapshot = expect(await call("post", "/api/snapshots", cookie, { fetchId: fetched.id, note: "STUB Stage 3 verification: exact supplied fixture" }), 201);
  const values = { CA: "0.1330", CO: "0.0440", CT: "0.0699", FL: "0.0000", GA: "0.0539", HI: "0.0725", MA: "0.0500", ME: "0.0715", MO: "0.0470", VA: "0.0575", WY: "0.0000", NONE: "0.0000" };
  expect(await call("post", "/api/rates", cookie, {
    taxYear: 2026, federalRate: "0.1500", federalSourceNote: "STUB Stage 3 test source",
    states: Object.entries(values).map(([stateCode, rate]) => ({ stateCode, rate, sourceNote: "STUB Stage 3 test source" })),
    note: "STUB test rates only, not tax advice",
  }), 201);
  const residences = expect(await call("get", "/api/residences", cookie), 200);
  for (const residence of residences) expect(await call("post", "/api/residences", cookie, {
    personId: residence.personId, stateCode: residence.displayName === "Gaston Natalie Davis" ? "GA" : residence.stateCode,
    confirmed: true, note: "STUB all confirmed, Natalie GA for acceptance",
  }), 201);
  let detail = expect(await call("post", "/api/years", cookie, { calendarYear: 2026, isPractice, snapshotId: snapshot.id, note: "STUB Stage 3 report fixture" }), 201);
  const base = `/api/years/${detail.id}`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
  const slot = expect(await call("post", `${base}/documents/uploads`, cookie, { filename: "STUB-stage3-timber-source.png", contentType: "image/png", size: png.length }), 201);
  const put = await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  if (!put.ok) throw new Error(`Private fixture document upload failed: ${put.status}`);
  const source = expect(await call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
  detail = expect(await call("post", `${base}/figures`, cookie, {
    grossCents: "11000000", grossDocumentId: source.id,
    costs: [{ label: "Zero-cost line", amountCents: "0", documentId: source.id }], note: "STUB gross $110,000; one zero-cost line",
  }), 201);
  detail = expect(await call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "7783", declarationDate: "2026-10-20", note: "STUB declared equal to proposed" }), 201);
  return {
    cookie, base, source, detail,
    async finalizeWithLedger() {
      detail = expect(await call("post", `${base}/finalize`, cookie, { note: "STUB finalization for report acceptance" }), 201);
      const forster = detail.holders.find((p) => p.displayName === "Forster Nancy Anne");
      detail = expect(await call("post", `${base}/payments`, cookie, {
        personId: forster.personId, kind: "cash", amountCents: "100000", date: "2026-10-20",
        method: "Internal method: Davis Allan", note: "Internal privacy probe: Esmond Robert III",
      }), 201);
      const cash = detail.payments[0];
      detail = expect(await call("post", `${base}/payments`, cookie, {
        personId: forster.personId, kind: "apic", amountCents: "55660", date: "2026-10-19",
        note: "STUB shareholder direction letter received",
      }), 201);
      detail = expect(await call("post", `${base}/reversals`, cookie, { entryId: cash.id, date: "2026-10-20", note: "STUB reverse mistaken cash; preserve original row" }), 201);
      detail = expect(await call("post", `${base}/corrections`, cookie, { kind: "note", note: "STUB note-only correction; original arithmetic remains" }), 201);
      return detail;
    },
  };
}
