/**
 * DEVELOPMENT ONLY. Public development data is read, never modified. Auth/audit
 * test writes stay in the existing temporary-table rollback harness. Restores
 * and fixture seeding happen ONLY in randomly named scratch databases.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import request from "supertest";
import JSZip from "jszip";
import { stage2Harness } from "./stage2-harness.mjs";
import { finalizedFixture } from "./stage3-fixture.mjs";

const credentialNames = ["DATABASE_URL", "APP_ORIGIN", "ROSTER_BASE_URL", "DISTRIBUTIONS_SERVICE_KEY", "BOOTSTRAP_PERSON_ID", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "SESSION_SECRET", "PRIVATE_OBJECT_DIR", "PUBLIC_OBJECT_SEARCH_PATHS", "DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
const originalCredentials = ["DATABASE_URL", "DISTRIBUTIONS_SERVICE_KEY", "RESEND_API_KEY", "SESSION_SECRET"].map((name) => process.env[name]).filter(Boolean);
const originalUrl = process.env.DATABASE_URL;
const h = await stage2Harness();
const { createDatabaseClient } = await import("@workspace/db");
const { identifier: q, tableInventory, postgresEnvironment } = await import("../src/lib/backup-postgres.ts");
const { backupPlan, preflightBackup } = await import("../src/lib/backup.ts");
const admin = createDatabaseClient(); await admin.connect();
const scratch = [];
const clients = [];
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function database() {
  const name = `hwd_backup_verify_${randomBytes(7).toString("hex")}`;
  assert.match(name, /^hwd_backup_verify_[0-9a-f]+$/);
  await admin.query(`CREATE DATABASE ${q(name)} TEMPLATE template0`);
  scratch.push(name);
  const url = new URL(originalUrl); url.pathname = `/${name}`;
  return { name, url: url.toString() };
}
async function connect(url) {
  const save = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  const client = createDatabaseClient();
  process.env.DATABASE_URL = save;
  client.on("error", () => undefined); // Scratch DB teardown may terminate idle connections.
  clients.push(client);
  await client.connect(); return client;
}
async function restore(sql, target) {
  const targetClient = await connect(target.url);
  // pg_dump may include CREATE SCHEMA public; restore to a genuinely empty
  // database namespace rather than change/rewrite SQL or any stored values.
  if (/\bCREATE SCHEMA public;/.test(sql)) await targetClient.query("DROP SCHEMA public CASCADE");
  await targetClient.end();
  const child = spawn("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=on", "--single-transaction"], { env: postgresEnvironment(target.url), stdio: ["pipe", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  child.stdin.on("error", () => undefined); child.stdin.end(sql);
  const code = await done;
  assert.equal(code, 0, `Scratch restore failed: ${stderr.split("\n").find((line) => line.includes("ERROR:")) ?? "psql failed"}`);
}
async function inspect(bytes, liveClient) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.app, "HWD Distributions"); assert.equal(manifest.environment, "development");
  assert.equal(Number(manifest.totalBytes), bytes.length);
  const sql = await zip.file(manifest.sql.filename).async("string");
  assert.equal(Number(manifest.sqlBytes), Buffer.byteLength(sql));
  assert.match(manifest.sql.filename, /development_.*\.sql$/);
  assert.ok(zip.file("RESTORE.md"));
  assert.deepEqual(manifest.tables, await tableInventory(liveClient));
  for (const file of Object.values(zip.files).filter((entry) => !entry.dir)) {
    const data = await file.async("nodebuffer");
    for (const name of credentialNames) assert.equal(data.includes(Buffer.from(name)), false, "Configuration name found in ZIP");
    for (const value of originalCredentials) assert.equal(data.includes(Buffer.from(value)), false, "Raw credential found in ZIP");
  }
  // KEY is required SQL syntax, not evidence of a leaked credential.
  const keyLines = sql.split("\n").filter((line) => /\bKEY\b/.test(line));
  assert.ok(keyLines.length > 0);
  assert.ok(keyLines.every((line) => /\b(PRIMARY|FOREIGN) KEY\b/.test(line)), "Unexpected KEY match requires review");
  const { yearDocumentStore } = await import("../src/lib/year-document-store.ts");
  let documentBytes = 0;
  for (const doc of manifest.documents) {
    assert.match(doc.archiveName, /^documents\/\d+\/\d+_[^/\\]+$/);
    const bytes = await zip.file(doc.archiveName).async("nodebuffer");
    const [stored] = await (await yearDocumentStore.getFile(doc.objectPath)).download();
    assert.deepEqual(bytes, stored); assert.equal(bytes.length, doc.size);
    documentBytes += bytes.length;
  }
  assert.equal(manifest.documentCount, manifest.documents.length);
  assert.equal(manifest.documentBytes, documentBytes);
  return { zip, manifest, sql, keyMatches: keyLines.length };
}
async function post(cookie) {
  return request(h.app).post("/api/backup").set("Origin", process.env.APP_ORIGIN).set("Cookie", cookie).buffer(true)
    .parse((res, done) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => done(null, Buffer.concat(chunks))); });
}
try {
  h.results.push({ check: "Observed identity", environment: "development", observed: (await admin.query("SELECT current_database(),inet_server_addr()::text")).rows[0] });
  const cookie = await h.login();
  h.expect(await h.call("post", "/api/backup"), 401);
  h.expect(await h.call("get", "/api/backup/confirm"), 401);
  assert.equal((await request(h.app).post("/api/backup").set("Cookie", cookie).set("Origin", "https://foreign.example")).status, 403);
  assert.equal((await request(h.app).post("/api/backup").set("Cookie", cookie)).status, 403);
  h.record("Authorization / same origin", "Anonymous POST and confirmation GET -> 401; foreign/missing Origin -> 403");
  const landing = await h.call("get", "/api/backup/confirm", cookie);
  h.expect(landing, 200); assert.equal(landing.headers["referrer-policy"], "strict-origin");
  assert.match(landing.text, /method="post"/);
  const beforeAudit = Number((await h.client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n);
  const liveResponse = await post(cookie);
  assert.equal(liveResponse.status, 200, liveResponse.body.toString());
  const live = await inspect(liveResponse.body, admin);
  const restoredLive = await database();
  await restore(live.sql, restoredLive);
  const restoredClient = await connect(restoredLive.url);
  assert.deepEqual(await tableInventory(restoredClient), live.manifest.tables);
  await restoredClient.end();
  assert.equal(Number((await h.client.query("SELECT count(*) AS n FROM audit_log")).rows[0].n), beforeAudit + 1);
  const completion = JSON.parse((await h.client.query("SELECT operation FROM audit_log ORDER BY id DESC LIMIT 1")).rows[0].operation);
  assert.equal(completion.action, "BACKUP_DOWNLOAD"); assert.equal(completion.sizeBytes, liveResponse.body.length);
  h.record("Live development backup / psql restore", { engine: live.manifest.sql.engine, tables: live.manifest.tables.length, bytes: liveResponse.body.length, documentCount: live.manifest.documentCount, restoredAndLiveCountsMatch: true, secretNames: 0, rawCredentials: 0, KEYMatchesOnlySqlConstraints: live.keyMatches, auditEntries: 1 });

  // Seed an isolated scratch source with the supplied fixture and actual
  // private source file, not a fake file store and never the Farm's public data.
  const fixtureYear = await finalizedFixture(h, { isPractice: true });
  const unicodeNote = "Backup UTF-8 — café, 'quoted', \\slash\nsecond line";
  await h.client.query("INSERT INTO audit_log(actor,entity,record_id,operation) VALUES($1,$2,$3,$4)", ["test-bootstrap", "backup_encoding_test", "unicode", unicodeNote]);
  const source = await database();
  await restore(live.sql, source);
  const sourceClient = await connect(source.url);
  const tables = await tableInventory(sourceClient);
  await sourceClient.query("SET session_replication_role=replica");
  await sourceClient.query(`TRUNCATE ${tables.map((t) => `${q(t.schema)}.${q(t.name)}`).join(",")} CASCADE`);
  for (const table of tables) {
    const rows = await h.client.query({ text: `SELECT * FROM pg_temp.${q(table.name)}`, rowMode: "array", types: { getTypeParser: () => (s) => s } });
    if (!rows.rows.length) continue;
    const columns = rows.fields.map((field) => q(field.name)).join(",");
    const parameters = rows.fields.map((_, i) => `$${i + 1}`).join(",");
    for (const values of rows.rows) await sourceClient.query(`INSERT INTO ${q(table.schema)}.${q(table.name)} (${columns}) VALUES (${parameters})`, values);
  }
  await sourceClient.query("SET session_replication_role=origin");
  // pg_dump preserves sequence state; set the scratch fixture's sequences to
  // match its copied IDs, without touching any live sequence.
  for (const table of tables) {
    const serial = (await sourceClient.query("SELECT pg_get_serial_sequence($1,'id') AS name", [`${q(table.schema)}.${q(table.name)}`])).rows[0].name;
    if (serial) {
      const max = (await sourceClient.query(`SELECT max(id)::text AS n FROM ${q(table.schema)}.${q(table.name)}`)).rows[0].n;
      await sourceClient.query("SELECT setval($1::regclass,$2,$3)", [serial, max ?? "1", max !== null]);
    }
  }
  process.env.DATABASE_URL = source.url; // This verification process only.
  const fixtureResponse = await post(cookie);
  assert.equal(fixtureResponse.status, 200, fixtureResponse.body.toString());
  const fixture = await inspect(fixtureResponse.body, sourceClient);
  assert.equal(fixture.manifest.documentCount, 1);
  const restoredFixture = await database(); await restore(fixture.sql, restoredFixture);
  const restoredFixtureClient = await connect(restoredFixture.url);
  assert.deepEqual(await tableInventory(restoredFixtureClient), fixture.manifest.tables);
  await restoredFixtureClient.end();
  h.record("Fixture documents and complete restore", { source: "SCRATCH DATABASE / LOCAL ROSTER STUB / REAL PRIVATE STORAGE", tables: fixture.manifest.tables.length, documents: fixture.manifest.documentCount, documentBytes: fixture.manifest.documentBytes, storedBytesMatch: true, restoredCountsMatch: true, sqlSha256: sha(Buffer.from(fixture.sql)) });

  await sourceClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const controller = new AbortController();
  const tooLarge = await backupPlan(sourceClient, controller.signal);
  await assert.rejects(preflightBackup(tooLarge, controller.signal, 128), (e) => e.status === 413 && /500 MB/.test(e.message));
  const probe = await backupPlan(sourceClient, controller.signal);
  const commit = probe.manifest.gitCommit;
  probe.manifest.gitCommit = process.env.SESSION_SECRET; // Dummy test-process credential only.
  await assert.rejects(preflightBackup(probe, controller.signal), (e) => e.status === 409);
  probe.manifest.gitCommit = "SESSION_SECRET";
  await assert.rejects(preflightBackup(probe, controller.signal), (e) => e.status === 409);
  probe.manifest.gitCommit = commit;
  const catalog = await backupPlan(sourceClient, controller.signal, true);
  await preflightBackup(catalog, controller.signal);
  const archive = await catalog.archive(), chunks = [];
  try {
    await pipeline(archive.output, new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }));
  } finally { archive.destroy(); }
  const catalogResult = await inspect(Buffer.concat(chunks), sourceClient);
  assert.equal(catalogResult.manifest.sql.engine, "catalog");
  await sourceClient.query("COMMIT");
  const restoredCatalog = await database(); await restore(catalogResult.sql, restoredCatalog);
  const restoredCatalogClient = await connect(restoredCatalog.url);
  assert.deepEqual(await tableInventory(restoredCatalogClient), catalogResult.manifest.tables);
  const indexes = await restoredCatalogClient.query("SELECT 1 FROM pg_indexes WHERE indexname='one_real_distribution_per_calendar_year'");
  assert.equal(indexes.rowCount, 1);
  assert.equal((await restoredCatalogClient.query("SELECT operation FROM public.audit_log WHERE entity='backup_encoding_test'")).rows[0].operation, unicodeNote);
  await restoredCatalogClient.end(); await sourceClient.end();
  h.record("Fallback / cap", { catalogRestoreCountsMatch: true, partialUniqueIndexRestored: true, tinyLimitSimulatesOversize: 413, rawCredentialAndConfigNameRejected: 409, archiveReleasedOnOversize: false, applicationArchiveOrTempFileStored: false });
  process.env.DATABASE_URL = originalUrl;
  h.expect(await h.call("post", `${fixtureYear.base}/reset-practice`, cookie, { confirmation: "RESET" }), 200);
  // A revoked session must not reach either backup route.
  const otherCookie = await h.login("other@example.test").catch(() => null);
  assert.equal(otherCookie, null); // Roster allowed, not in local access.
  await h.client.query(`INSERT INTO access_entries(person_id,display_name,added_by,note,removed_at)
    VALUES('test-bootstrap','Test Bootstrap','test-bootstrap','TEST ONLY: inactive-route refusal',now())`);
  h.expect(await h.call("post", "/api/backup", cookie), 403);
  h.expect(await h.call("get", "/api/backup/confirm", cookie), 403);
  h.record("Inactive access", "Valid session, inactive local access -> 403 on POST and confirmation GET; Roster-allowed but unlisted identity cannot request a link");
} catch (error) {
  process.exitCode = 1;
  h.results.push({ check: "Backup acceptance", result: "FAIL", error: error.message, stack: error.stack });
} finally {
  process.env.DATABASE_URL = originalUrl;
  for (const client of clients) await client.end().catch(() => undefined);
  for (const name of scratch.reverse()) await admin.query(`DROP DATABASE ${q(name)} WITH (FORCE)`).catch(() => undefined);
  await admin.end(); await h.finish();
}
