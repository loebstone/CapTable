/** No database, email, sessions or external services. */
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { configureProxy, proxyPolicy, ssoProxyDiagnostic } from "../src/lib/proxy.ts";
import { authLimit } from "../src/lib/auth-limits.ts";
import { BUILD_ID } from "../src/lib/build.ts";

assert.deepEqual(proxyPolicy(undefined), { hops: 1, reason: "TRUSTED_PROXY_HOPS unset; preserving the app's existing value of 1" });
for (let n = 0; n <= 8; n++) assert.equal(proxyPolicy(String(n)).hops, n);
for (const value of ["", " ", "true", "all", "-1", "9", "1.5", "04", "4x", "Infinity"]) {
  assert.throws(() => proxyPolicy(value), /integer from 0 through 8/);
}
console.log("PASS proxy config: preserved default 1; integers 0–8; invalid values fail closed");
const app = express();
const prior = process.env.TRUSTED_PROXY_HOPS;
process.env.TRUSTED_PROXY_HOPS = "4";
const policy = configureProxy(app);
if (prior === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = prior;
assert.equal(app.get("trust proxy"), 4);
app.get("/auth/sso", (req, res) => res.json(ssoProxyDiagnostic(req, policy.hops)));
const chain = "198.51.100.99, 203.0.113.7, 10.0.0.3, 10.0.0.2, 10.0.0.1";
const first = await request(app).get("/auth/sso?ticket=DO_NOT_LOG").set("X-Forwarded-For", chain);
assert.equal(first.body.resolvedIp, "203.0.113.7");
assert.equal(first.body.forwardedFor, chain); assert.equal(first.body.trustedProxyHops, 4);
assert.ok(first.body.socketAddress);
assert.ok(!JSON.stringify(first.body).includes("DO_NOT_LOG"));
const spoofed = await request(app).get("/auth/sso")
  .set("X-Forwarded-For", `192.0.2.123, ${chain}`);
assert.equal(spoofed.body.resolvedIp, "203.0.113.7");
console.log("PASS hops=4 resolves fourth-from-right XFF 203.0.113.7; extra left-hand spoof ignored");
console.log("PASS diagnostic contains only full XFF, socket, resolved IP and hops; no ticket");
app.get("/limit", (req, res) => {
  try { authLimit(`proxy-test:${req.ip}`, 2, "Limited"); res.sendStatus(200); }
  catch (error) { res.sendStatus(error.status); }
});
for (let i = 0; i < 3; i++) {
  const res = await request(app).get("/limit").set("X-Forwarded-For", chain);
  assert.equal(res.status, i < 2 ? 200 : 429);
}
const other = await request(app).get("/limit").set("X-Forwarded-For", chain.replace("203.0.113.7", "203.0.113.8"));
assert.equal(other.status, 200);
const evasion = await request(app).get("/limit").set("X-Forwarded-For", `192.0.2.124, ${chain}`);
assert.equal(evasion.status, 429);
console.log("PASS limiter separates real visitors sharing proxies; left-hand spoof cannot evade limit");
assert.equal(BUILD_ID, "development-unbundled");
console.log("PASS direct-source tests explicitly identify unbundled code; running bundled build checked via healthz");
