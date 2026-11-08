// DEVELOPMENT ONLY: loopback, rollback-local tables, stub Roster, no emails.
import express from "express";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { createWebApp } from "../../hwd-distributions/server.mjs";

const h = await stage2Harness();
delete process.env.SITE_BASE_URL;
const fixture = await finalizedFixture(h, { isPractice: true });
const cookie = fixture.cookie, base = `/api/years/${fixture.detail.id}`;
const rates = h.expect(await h.call("get", "/api/rates", cookie), 200)[0];
h.expect(await h.call("post", "/api/rates", cookie, {
  ...rates, niitRate: "0.0380",
  states: rates.states.map((r) => r.stateCode === "CA" ? { ...r, rate: "0.0930" } : r),
}), 201);
h.expect(await h.call("post", `${base}/figures`, cookie, { grossCents: "8680000", costs: [{ label: "Zero cost", amountCents: "0" }] }), 201);
h.expect(await h.call("post", `${base}/declaration`, cookie, { declaredPerShareCents: "5273", declarationDate: "2026-10-20" }), 201);
process.env.APP_ORIGIN = "http://127.0.0.1:8099";
const test = express();
test.get("/__niit-test/start", (_req, res) => {
  res.setHeader("Set-Cookie", cookie + "; HttpOnly; SameSite=Lax; Path=/");
  res.redirect(303, `/years/${fixture.detail.id}`);
});
test.use(h.app); test.use(createWebApp());
const server = test.listen(8099, "127.0.0.1", () => console.log(`NIIT browser harness READY http://127.0.0.1:8099/__niit-test/start; practice ${fixture.detail.id}; rollback-local tables; no emails`));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  await h.finish(); process.exit(0);
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
