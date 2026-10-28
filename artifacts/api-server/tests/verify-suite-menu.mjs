/** Development only. Menu fetches stubbed; access checks use rollback-local fixtures. */
import assert from "node:assert/strict";
import { createSuiteMenuClient, suiteToolsVisible, fallbackMenu } from "../src/lib/suite-menu.ts";
import { stage2Harness } from "./stage2-harness.mjs";

let clock = 0, calls = 0, warnings = 0, mode = "ok";
const fixture = { ...fallbackMenu("https://site.example.test"), version: 2,
  logoSvg: '<svg onload="alert(1)"><script>alert(1)</script><image href="https://evil.test"/></svg>' };
const client = createSuiteMenuClient({
  now: () => clock, configured: () => "https://site.example.test", warn: () => warnings++,
  fetch: async (url, options) => {
    calls++;
    assert.equal(url, "https://site.example.test/api/suite/menu");
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    if (mode === "down") throw new Error("stub outage");
    if (mode === "unsafe") return Response.json({ ...fixture, items: [{ id: "x", label: "bad", href: "javascript:alert(1)" }] });
    if (mode === "large") return new Response("x".repeat(131073));
    return Response.json(fixture);
  },
});
const first = await client();
assert.equal(first.source, "site"); assert.equal(first.version, "2");
assert.deepEqual(await client(), first); assert.equal(calls, 1);
clock += 300001; await Promise.all([client(), client(), client()]); assert.equal(calls, 2);
console.log("PASS fetched, 5-minute cached, concurrent fetch coalesced, timeout signal/redirect policy");
assert.ok(!JSON.stringify(first).includes("logoSvg")); assert.ok(!JSON.stringify(first).includes("script"));
console.log("PASS remote malicious SVG discarded; only local treeline rendered");
mode = "down"; clock += 300001;
assert.equal((await client()).source, "fallback");
clock += 300001; await client(); assert.equal(warnings, 1);
assert.equal((await client()).items.find((x) => x.id === "scheduler").href, "https://calendar.hwdfarm.com");
mode = "ok"; clock += 300001; await client();
mode = "down"; clock += 300001; await client(); assert.equal(warnings, 2);
console.log("PASS outage fallback, warning once per outage, recovery resets warning");
let unsetCalls = 0;
const unset = createSuiteMenuClient({ configured: () => undefined, warn: () => {}, fetch: async () => { unsetCalls++; throw Error(); } });
assert.equal((await unset()).homeHref, "https://hwd-main-site.replit.app/"); assert.equal(unsetCalls, 0);
mode = "unsafe"; clock += 300001; assert.equal((await client()).source, "fallback");
mode = "large"; clock += 300001; assert.equal((await client()).source, "fallback");
console.log("PASS unset fallback, unsafe URL rejected, oversized body rejected");
assert.equal(suiteToolsVisible(undefined), false); assert.equal(suiteToolsVisible([]), false);
assert.equal(suiteToolsVisible(["other"]), false); assert.equal(suiteToolsVisible(["forecast"]), true);
assert.equal(suiteToolsVisible(["captable"]), true);
console.log("PASS Tools visibility: absent/no matching apps hidden; forecast or captable visible");
const h = await stage2Harness();
const savedSite = process.env.SITE_BASE_URL;
try {
  delete process.env.SITE_BASE_URL;
  h.expect(await h.call("get", "/api/suite/menu"), 401);
  const cookie = await h.login();
  const res = await h.call("get", "/api/suite/menu", cookie); h.expect(res, 200);
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.deepEqual(res.body.tools, []); assert.ok(!("logoSvg" in res.body));
  console.log("PASS route requires active session/access; absent session apps hides Tools; response private");
} finally {
  if (savedSite === undefined) delete process.env.SITE_BASE_URL; else process.env.SITE_BASE_URL = savedSite;
  await h.finish();
}
