import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import JSZip from "jszip";
import { pool, createDatabaseClient } from "@workspace/db";
import { currentIdentity } from "./auth";
import { yearDocumentStore } from "./year-document-store";
import { HttpError } from "./errors";
import { catalogDump, dumpAvailable, postgresDump, tableInventory, type BackupClient } from "./backup-postgres";

export const MAX_BACKUP_BYTES = 500_000_000;
let active = false;
const run = promisify(execFile);
const safeFilename = (name: string) => name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_") || "document";
const configNames = ["DATABASE_URL", "APP_ORIGIN", "ROSTER_BASE_URL", "DISTRIBUTIONS_SERVICE_KEY", "BOOTSTRAP_PERSON_ID", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "SESSION_SECRET", "PRIVATE_OBJECT_DIR", "PUBLIC_OBJECT_SEARCH_PATHS", "DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
function credentialPatterns() {
  // Identity IDs and email addresses are legitimate database records, not
  // serialized configuration. Never export raw authentication credentials.
  const password = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).password) : "";
  // Short local database passwords can be ordinary words in SQL/help text.
  // The complete connection string is always checked; additionally check
  // distinct-length password components, never arbitrary short substrings.
  return [...configNames, password.length >= 16 ? password : "", ...["RESEND_API_KEY", "DISTRIBUTIONS_SERVICE_KEY", "SESSION_SECRET", "DATABASE_URL"].map((name) => process.env[name])]
    .filter((value): value is string => Boolean(value)).map((value) => Buffer.from(value));
}
function credentialGuard() {
  const patterns = credentialPatterns(), length = Math.max(...patterns.map((p) => p.length));
  let tail = Buffer.alloc(0);
  return new Transform({ transform(chunk: Buffer, _encoding, done) {
    const combined = Buffer.concat([tail, chunk]);
    if (patterns.some((pattern) => combined.includes(pattern))) { done(new HttpError(409, "Backup content contains configuration or raw credentials; no archive was released")); return; }
    tail = Buffer.from(combined.subarray(-Math.max(0, length - 1)));
    done(null, chunk);
  } });
}
const RESTORE = `# Restore HWD Distributions

This archive contains private family records, including historical identity and
hashed sign-in/session records. Protect it as carefully as the running app.

1. Restore into an EMPTY PostgreSQL database, never over a running app:
   psql --set ON_ERROR_STOP=on --single-transaction --file <environment_timestamp.sql> <target-connection>
   Use PostgreSQL/psql 16.10 or a compatible newer release. Database roles,
   grants, passwords, runtime configuration and storage credentials are NOT
   included; supply those separately. pg_dump includes schema, constraints,
   indexes, sequences and data. The catalog fallback identifies its engine in
   manifest.json and refuses schema objects it cannot faithfully reproduce.
2. Verify every table count against manifest.json before starting the app.
   Counts use ONLY (physical table rows; partition parents exclude children).
3. Source document files are under documents/<yearId>/<documentId>_<filename>.
   manifest.json maps each archive name to its original private objectPath.
   Upload those bytes to the corresponding path within the new deployment's
   PRIVATE storage area; preserve each /objects/... relative path, or append an
   explicitly reviewed migration before use. Never make these documents public.
   Pending upload reservations are SQL records, not sealed source documents.
   Their ephemeral staging objects are not included.
4. Configure the destination's runtime settings separately and invalidate old
   sessions before opening access. Verify Roster identity delegation, private
   document access and the app's session policy before use.

The manifest is the point-in-time snapshot before this download's success audit.
The live audit table gains one BACKUP_DOWNLOAD entry after successful streaming;
that new event is intentionally not inside its own backup. A failed/aborted
download is not a completed backup. No archive is retained by the application.
`;

export async function backupPlan(client: BackupClient, signal: AbortSignal, forceCatalog = false) {
  await client.query("SET LOCAL search_path=pg_catalog");
  const identity = (await client.query("SELECT current_database() AS name,inet_server_addr()::text AS address")).rows[0];
  const tables = await tableInventory(client);
  // Bound ZIP directory/manifest metadata as well as file-stream buffers.
  const documents = (await client.query<{ id: number; yearId: number; objectPath: string; filename: string; size: number }>(`SELECT id,"year_id" AS "yearId",object_path AS "objectPath",filename,size FROM public.year_documents ORDER BY id LIMIT 100001`)).rows;
  if (documents.length > 100000) throw new HttpError(413, "Backup exceeds the safe 100,000-document directory limit");
  let documentBytes = 0;
  const sources: ((typeof documents)[number] & { archiveName: string; file: Awaited<ReturnType<typeof yearDocumentStore.getFile>> })[] = [];
  for (const doc of documents) {
    signal.throwIfAborted();
    const file = await yearDocumentStore.getFile(doc.objectPath);
    const [metadata] = await file.getMetadata();
    signal.throwIfAborted();
    if (String(metadata.size) !== String(doc.size) || !metadata.generation) throw new HttpError(409, "A stored source document does not match its database record; backup stopped");
    documentBytes += Number(metadata.size);
    if (documentBytes > MAX_BACKUP_BYTES) throw new HttpError(413, "Backup exceeds the 500 MB maximum");
    sources.push({ ...doc, archiveName: `documents/${doc.yearId}/${doc.id}_${safeFilename(doc.filename)}`, file: file.bucket.file(file.name, { generation: metadata.generation }) });
  }
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const timestamp = new Date().toISOString(), stamp = timestamp.replace(/[:.]/g, "-");
  const id = randomUUID(), sqlName = `HWD_Distributions_${environment}_${stamp}.sql`;
  const engine = !forceCatalog && await dumpAvailable() ? "pg_dump" : "catalog";
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot as string;
  let gitCommit: string | null = null;
  try { const result = await run("git", ["rev-parse", "HEAD"], { timeout: 2000 }); if (/^[0-9a-f]{40,64}$/.test(result.stdout.trim())) gitCommit = result.stdout.trim(); } catch { /* optional metadata */ }
  const manifest = {
    app: "HWD Distributions", environment, timestamp, backupId: id, gitCommit,
    database: { name: identity.name, serverAddress: identity.address },
    sql: { filename: sqlName, engine, countsUseOnly: true },
    // Fixed-width decimal bytes keep manifest/ZIP length stable between
    // the counting pass and the delivered pass, without buffering either.
    totalBytes: "00000000000000000000",
    sqlBytes: "00000000000000000000",
    tables, documentCount: sources.length, documentBytes,
    documents: sources.map(({ file: _file, ...doc }) => doc),
    auditTiming: "Snapshot precedes this download's completion audit",
  };
  return {
    id, environment, manifest, filename: `HWD_Distributions_${environment}_Backup_${stamp}.zip`,
    async archive() {
      const zip = new JSZip(), inputs: Readable[] = [];
      const add = (name: string, input: Readable) => { inputs.push(input); zip.file(name, input, { date: new Date(timestamp) }); };
      const sql = engine === "pg_dump" ? postgresDump(snapshot, id, signal) : await catalogDump(client, tables);
      const header = `-- HWD Distributions; environment ${environment}; observed database ${JSON.stringify(identity.name)}, server ${JSON.stringify(identity.address)}\n`;
      add(sqlName, Readable.from((async function* () {
        let count = Buffer.byteLength(header);
        yield Buffer.from(header, "utf8");
        for await (const bytes of sql) {
          // JSZip's Node adapter expects bytes, not JS strings; otherwise the
          // catalog fallback can corrupt non-ASCII names/notes in the dump.
          const chunk = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
          count += chunk.length;
          yield chunk;
        }
        manifest.sqlBytes = String(count).padStart(20, "0");
      })()));
      for (const doc of sources) add(doc.archiveName, Readable.from((async function* () {
        for await (const bytes of doc.file.createReadStream()) yield bytes;
      })()));
      zip.file("manifest.json", JSON.stringify(manifest, null, 2), { date: new Date(timestamp) });
      zip.file("RESTORE.md", RESTORE, { date: new Date(timestamp) });
      // STORE makes preflight and download byte lengths deterministic, including
      // incompressible documents, without buffering an archive or using disk.
      const output = zip.generateNodeStream({ streamFiles: true, compression: "STORE" }) as Readable;
      return { output, destroy() { output.destroy(); sql.destroy(); for (const input of inputs) input.destroy(); } };
    },
  };
}
export type BackupPlan = Awaited<ReturnType<typeof backupPlan>>;
export async function preflightBackup(plan: BackupPlan, signal: AbortSignal, maxBytes = MAX_BACKUP_BYTES) {
  const archive = await plan.archive();
  let bytes = 0;
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    done(bytes > Math.min(maxBytes, MAX_BACKUP_BYTES) ? new HttpError(413, "Backup exceeds the 500 MB maximum; no archive was released") : undefined);
  } });
  // Scan the uncompressed ZIP (STORE) so SQL, metadata and document contents
  // are all checked, including credentials split across stream boundaries.
  try {
    await pipeline(archive.output, credentialGuard(), sink, { signal });
    plan.manifest.totalBytes = String(bytes).padStart(20, "0");
    return bytes;
  }
  finally { archive.destroy(); }
}

export async function downloadBackup(req: Request, res: Response) {
  if (active) throw new HttpError(429, "A backup is already running; try again after it finishes");
  active = true;
  const client = createDatabaseClient(), abort = new AbortController();
  client.on("error", () => abort.abort());
  const deadline = setTimeout(() => abort.abort(), 10 * 60 * 1000);
  deadline.unref();
  const closeClient = () => { void client.end().catch(() => undefined); };
  abort.signal.addEventListener("abort", closeClient, { once: true });
  const disconnected = () => { if (!res.writableFinished) abort.abort(); };
  res.on("close", disconnected);
  let releaseAudit: (() => void) | undefined;
  try {
    // Reserve before taking the write lock: queued writers must not exhaust
    // the pool and prevent our final access check/audit from completing.
    const auditClient = await pool.connect();
    releaseAudit = () => auditClient.release();
    const checkAccess = async () => {
      const { rows } = await auditClient.query("SELECT removed_at FROM access_entries WHERE person_id=$1 ORDER BY id DESC LIMIT 1", [currentIdentity(req).personId]);
      if (!rows.length || rows[0].removed_at !== null) throw new HttpError(403, "This person is not on the active HWD Distributions access list");
    };
    await client.connect();
    // Acquire before BEGIN so a reset finishing while we wait cannot leave a
    // pre-reset snapshot pointing at already-deleted source objects.
    await client.query("SELECT pg_advisory_lock(48133001)");
    await checkAccess();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const plan = await backupPlan(client, abort.signal);
    const expectedBytes = await preflightBackup(plan, abort.signal);
    await checkAccess();
    const archive = await plan.archive();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${plan.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    let size = 0;
    const counter = new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      done(size > MAX_BACKUP_BYTES ? new HttpError(413, "Backup exceeds the 500 MB maximum") : null, chunk);
    } });
    try {
      await pipeline(archive.output, credentialGuard(), counter, res, { end: false, signal: abort.signal });
      if (size !== expectedBytes) throw new HttpError(502, "Backup size changed during export; download failed");
      // The dedicated session already holds the application's common write
      // lock. Do not acquire it again on this separate audit connection.
      await auditClient.query("INSERT INTO audit_log(actor,entity,record_id,operation) VALUES($1,'backups',$2,$3)", [
        currentIdentity(req).personId, plan.id,
        JSON.stringify({ action: "BACKUP_DOWNLOAD", environment: plan.environment, sizeBytes: size, documentCount: plan.manifest.documentCount }),
      ]);
      await client.query("COMMIT");
      res.end();
    } finally { archive.destroy(); }
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Backup could not be completed; no archive was released");
  } finally {
    clearTimeout(deadline);
    abort.signal.removeEventListener("abort", closeClient);
    res.off("close", disconnected);
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("SELECT pg_advisory_unlock(48133001)").catch(() => undefined);
    await client.end().catch(() => undefined);
    releaseAudit?.();
    active = false;
  }
}
