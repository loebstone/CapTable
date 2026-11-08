// DEVELOPMENT ONLY, loopback only. Isolated rollback tables and local fixture
// Roster; never sends email or touches existing records. Only for browser checks.
import express from "express";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { createWebApp } from "../../hwd-distributions/server.mjs";

const h = await stage2Harness();
delete process.env.SITE_BASE_URL; // Deterministic suite-menu fallback; no site call.
const fixture = await finalizedFixture(h, { isPractice: true });
const cookie = fixture.cookie;
const year = h.expect(await h.call("post", "/api/years", cookie, { calendarYear: 2026, snapshotId: fixture.detail.snapshotId }), 201);
const base = `/api/years/${year.id}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=", "base64");
const slot = h.expect(await h.call("post", `${base}/documents/uploads`, cookie, { filename: "STUB-official-figures.png", contentType: "image/png", size: png.length }), 201);
if (!(await fetch(slot.uploadURL, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).ok) throw new Error("Fixture upload failed");
h.expect(await h.call("post", `${base}/documents`, cookie, { uploadId: slot.uploadId }), 201);
process.env.APP_ORIGIN = "http://127.0.0.1:8099";
const test = express();
test.get("/__draft-test/start", (_req, res) => {
  res.setHeader("Set-Cookie", cookie + "; HttpOnly; SameSite=Lax; Path=/");
  res.redirect(303, `/years/${year.id}`);
});
test.use(h.app);
test.use(createWebApp());
const server = test.listen(8099, "127.0.0.1", () => console.log(`DRAFT browser harness READY http://127.0.0.1:8099/__draft-test/start; real test year ${year.id}, practice ${fixture.detail.id}; local Roster STUB; no emails`));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  await h.finish();
  process.exit(0);
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
