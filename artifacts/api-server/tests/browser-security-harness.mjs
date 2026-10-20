/**
 * DEVELOPMENT-ONLY, loopback-only browser test server. Production-built UI and
 * actual API, local Roster STUB, real private storage, temporary DB tables rolled
 * back on shutdown. Never use this harness as an application service.
 */
import express from "express";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";
import { createWebApp } from "../../hwd-distributions/server.mjs";

const h = await stage2Harness();
if (!process.argv.includes("--backup")) {
  const fixture = await finalizedFixture(h);
  await fixture.finalizeWithLedger();
} else {
  await h.login(); // Access-only backup flow needs no extra stored fixture file.
}
if (process.argv.includes("--practice")) {
  const practice = await finalizedFixture(h, { isPractice: true });
  await practice.finalizeWithLedger();
}
process.env.APP_ORIGIN = "http://127.0.0.1:8099";
const test = express();
const writes = [];
test.use((req, res, next) => {
  if (req.path.startsWith("/api/") && req.method === "POST") res.on("finish", () => {
    writes.push({ path: req.path, status: res.statusCode, originPresent: Boolean(req.get("origin")), originMatches: req.get("origin") === process.env.APP_ORIGIN });
  });
  next();
});
test.get("/__security-test/open-link", (_req, res) => {
  const link = h.getLoggedLink();
  if (!link) { res.sendStatus(404); return; }
  // Redirect internally; never print the link or return it as evidence.
  res.redirect(303, link);
});
test.get("/__security-test/evidence", async (_req, res) => {
  const sessions = (await h.client.query("SELECT count(*)::int AS n FROM hwd_sessions")).rows[0].n;
  res.json({ source: "LOCAL ROSTER STUB / DEVELOPMENT TEMP TABLES", writes, sessions });
});
test.use(h.app);
test.use(createWebApp());
const server = test.listen(8099, "127.0.0.1", () => {
  process.stdout.write("SECURITY_BROWSER_READY (local stub; token values withheld)\n");
});
process.once("SIGTERM", async () => {
  server.close();
  await h.finish();
  process.exit(0);
});
