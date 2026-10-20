/**
 * Development-only focused security regressions. Local Roster STUB, transaction-
 * local test tables, no real email; source staging validation is explicitly mocked.
 */
import assert from "node:assert/strict";
import request from "supertest";
import { stage2Harness } from "./stage2-harness.mjs";

const h = await stage2Harness();
const { app, client, call, expect, record } = h;
try {
  const { publicOrigin } = await import("../src/lib/origin.ts");
  const { ObjectStorageService } = await import("../src/lib/objectStorage.ts");
  const { yearDocumentStore } = await import("../src/lib/year-document-store.ts");
  const origin = process.env.APP_ORIGIN;
  const forged = { protocol: "https", get: (name) => ({ host: "attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" })[name] };
  assert.equal(publicOrigin(forged), origin);
  process.env.NODE_ENV = "production";
  delete process.env.APP_ORIGIN;
  assert.throws(() => publicOrigin(forged), /APP_ORIGIN is required/);
  process.env.APP_ORIGIN = "https://trusted.example";
  assert.equal(publicOrigin(forged), "https://trusted.example");
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = origin;
  record("B2. Trusted origin", "Production missing origin fails; configured origin ignores Host and forwarded headers; test-only values");

  const countSessions = async () => (await client.query("SELECT count(*)::int AS n FROM hwd_sessions")).rows[0].n;
  const missing = await request(app).post("/api/auth/link").send({ email: "bootstrap@example.test" });
  assert.equal(missing.status, 403);
  const hostile = await request(app).post("/api/auth/link").set("Origin", "https://attacker.example").set("X-Forwarded-Host", "attacker.example").set("X-Forwarded-Proto", "https").send({ email: "bootstrap@example.test" });
  assert.equal(hostile.status, 403);
  record("F1. Fail-closed writes", { noBrowserHeaders: missing.status, hostileOriginWithForgedForwardedHost: hostile.status });
  expect(await call("post", "/api/auth/link", null, { email: "bootstrap@example.test" }), 200);
  const link = new URL(h.getLoggedLink()), token = link.searchParams.get("token");
  for (let i = 0; i < 2; i++) {
    const landing = await call("get", link.pathname + link.search);
    assert.equal(landing.status, 200); assert.match(landing.text, /Continue to HWD Cap Table/);
    assert.equal(landing.headers["referrer-policy"], "strict-origin");
    assert.equal(landing.headers["set-cookie"], undefined);
  }
  assert.equal(await countSessions(), 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM link_consumptions")).rows[0].n, 0);
  const crossPost = await request(app).post(link.pathname).set("Origin", "https://attacker.example").send({ token });
  assert.equal(crossPost.status, 403);
  const signed = await call("post", link.pathname, null, { token });
  assert.equal(signed.status, 303); assert.equal(await countSessions(), 1);
  assert.equal((await call("post", link.pathname, null, { token })).status, 401);
  record("F4. GET confirmation / POST redemption", { repeatedGET: 200, sessionsAfterGET: 0, consumptionsAfterGET: 0, crossOriginPOST: 403, sameOriginPOST: 303, sessionsAfterPOST: 1, replay: 401, tokenNotPrinted: true });
  const expired = "e".repeat(64);
  const { hash } = await import("../src/lib/auth.ts");
  await client.query("INSERT INTO magic_links(token_hash,email,person_id,display_name,expires_at) VALUES($1,$2,$3,$4,$5)", [hash(expired), "bootstrap@example.test", "test-bootstrap", "Test Bootstrap", new Date(Date.now() - 1).toISOString()]);
  assert.equal((await call("post", "/api/auth/verify", null, { token: expired })).status, 401);
  const expiry = (await client.query("SELECT extract(epoch FROM (expires_at-created_at))::int AS seconds FROM magic_links WHERE token_hash=$1", [hash(token)])).rows[0].seconds;
  assert.ok(Math.abs(expiry - 900) <= 1);
  record("Expiry and single-use", { expirySeconds: expiry, expiredPOST: 401, replayPOST: 401 });

  // Separate IPs make the per-token assertion independent of the per-IP limit.
  const invalidToken = "b".repeat(64);
  for (let i = 0; i < 11; i++) {
    const r = await request(app).post("/api/auth/verify").set("Origin", origin).set("X-Forwarded-For", `192.0.2.${i + 1}`).send({ token: invalidToken });
    assert.equal(r.status, i < 10 ? 401 : 429);
  }
  for (let i = 0; i < 11; i++) {
    const r = await request(app).post("/api/auth/verify").set("Origin", origin).set("X-Forwarded-For", "198.51.100.1").send({ token: i.toString(16).padStart(64, "0") });
    assert.equal(r.status, i < 10 ? 401 : 429);
  }
  for (let i = 0; i < 21; i++) {
    const r = await request(app).post("/api/auth/link").set("Origin", origin).set("X-Forwarded-For", "203.0.113.1").send({ email: "denied@example.test" });
    assert.equal(r.status, i < 20 ? 403 : 429);
  }
  record("F2. Rate limits", { redemptionSameTokenAcrossIPs: "11th -> 429", redemptionSameIPAcrossTokens: "11th -> 429", requestsSameIP: "21st -> 429", counters: "per server process; no scheduled jobs" });

  // Explicit storage MOCK: verify rejection cannot create a sealed copy.
  const original = ObjectStorageService.prototype.getObjectEntityFile;
  try {
    for (const test of [
      { label: "oversize", actual: 20971521, expected: 20, header: Buffer.from("%PDF-test") },
      { label: "size mismatch", actual: 9, expected: 10, header: Buffer.from("%PDF-test") },
      { label: "wrong type", actual: 9, expected: 9, header: Buffer.from("not a PDF") },
    ]) {
      let copied = false, deleted = false;
      const fake = { name: "staging", getMetadata: async () => [{ size: String(test.actual), generation: "1" }], download: async () => [test.header], copy: async () => { copied = true; }, delete: async () => { deleted = true; } };
      fake.bucket = { file: () => fake };
      ObjectStorageService.prototype.getObjectEntityFile = async () => fake;
      await assert.rejects(yearDocumentStore.seal("/objects/uploads/test", "application/pdf", test.expected));
      assert.equal(copied, false); assert.equal(deleted, true);
      record(`F3. ${test.label}`, { source: "EXPLICIT STORAGE MOCK", copied: false, stagingCleanup: true });
    }
  } finally { ObjectStorageService.prototype.getObjectEntityFile = original; }
  const headers = (await call("get", "/api/healthz")).headers;
  assert.equal(headers["x-frame-options"], "DENY");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  record("Security response headers", { xFrameOptions: "DENY", frameAncestors: "'none'", cspPresent: true });
} finally { await h.finish(); }
