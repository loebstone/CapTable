import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import type { createDatabaseClient } from "@workspace/db";
import { HttpError } from "./errors";

export type BackupClient = ReturnType<typeof createDatabaseClient>;
export const identifier = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
const userSchema = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'";

export async function dumpAvailable() {
  const child = spawn("pg_dump", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
  try { const [code] = await once(child, "close"); return code === 0; } catch { return false; }
}
export function postgresEnvironment(url = process.env.DATABASE_URL!) {
  const parsed = new URL(url);
  return {
    PATH: process.env.PATH ?? "", PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432", PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get("sslmode") ?? "prefer", PGAPPNAME: "hwd-backup",
  };
}
export function postgresDump(snapshot: string, nonce: string, signal: AbortSignal) {
  return Readable.from((async function* () {
    // Never put credentials in argv, logs or the SQL; no shell is involved.
    const child = spawn("pg_dump", [
      "--format=plain", "--no-owner", "--no-acl", "--no-comments", "--encoding=UTF8",
      `--snapshot=${snapshot}`, `--restrict-key=${nonce.replace(/-/g, "")}`,
    ], { env: postgresEnvironment(), stdio: ["ignore", "pipe", "pipe"], signal });
    child.stderr.resume(); // Fail explicitly, but never expose connection diagnostics.
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    // Attach immediately so spawn failures cannot become unhandled rejections.
    void completion.catch(() => undefined);
    try {
      for await (const bytes of child.stdout) yield bytes as Buffer;
      if (await completion !== 0) throw new HttpError(503, "PostgreSQL backup could not be generated");
    } finally { if (child.exitCode === null) child.kill("SIGTERM"); }
  })());
}
export async function tableInventory(client: BackupClient) {
  const { rows } = await client.query<{ schema: string; name: string }>(`
    SELECT n.nspname AS schema,c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND ${userSchema} ORDER BY n.nspname,c.relname`);
  const result = [];
  for (const table of rows) {
    const count = await client.query(`SELECT count(*)::text AS n FROM ONLY ${identifier(table.schema)}.${identifier(table.name)}`);
    result.push({ ...table, count: count.rows[0].n as string });
  }
  return result;
}
export type Inventory = Awaited<ReturnType<typeof tableInventory>>;

/**
 * Catalog fallback for this app's ordinary tables, enums, serials, constraints
 * and indexes. Refuse unsupported objects rather than emit an incomplete dump.
 * All values are PostgreSQL's text representation; numeric/JSON/date precision
 * never passes through JS number or JSON parsing.
 */
export async function catalogDump(client: BackupClient, tables: Inventory) {
  const unsupported = await client.query(`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema} AND c.relkind IN ('v','m','f','p') UNION ALL
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${userSchema} AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`);
  const triggers = await client.query(`SELECT t.oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema} AND NOT t.tgisinternal`);
  const inheritance = await client.query("SELECT 1 FROM pg_inherits LIMIT 1");
  const specialColumns = await client.query(`SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema} AND (a.attidentity<>'' OR a.attgenerated<>'') LIMIT 1`);
  if (unsupported.rowCount || triggers.rowCount || inheritance.rowCount || specialColumns.rowCount) throw new HttpError(503, "This schema requires pg_dump; the catalog backup would not be complete. Install the PostgreSQL runtime tools.");
  const schemas = await client.query(`SELECT nspname FROM pg_namespace n WHERE ${userSchema} ORDER BY nspname`);
  const enums = await client.query(`SELECT n.nspname AS schema,t.typname,array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE ${userSchema} GROUP BY n.nspname,t.typname`);
  const sequences = await client.query(`SELECT * FROM pg_sequences WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' ORDER BY schemaname,sequencename`);
  const columns = await client.query(`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${userSchema} AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`);
  const constraints = await client.query(`SELECT n.nspname AS schema,c.relname AS name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema} ORDER BY CASE WHEN k.contype='f' THEN 1 ELSE 0 END,n.nspname,c.relname,k.conname`);
  const indexes = await client.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${userSchema} AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid)`);
  const owners = await client.query(`SELECT sn.nspname AS schema,s.relname AS sequence,tn.nspname AS table_schema,t.relname AS table_name,a.attname AS column FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.deptype='a' JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE s.relkind='S' AND sn.nspname !~ '^pg_'`);
  return Readable.from((async function* () {
    yield "SET standard_conforming_strings = on;\nSET search_path = pg_catalog;\n";
    for (const s of schemas.rows) yield `CREATE SCHEMA IF NOT EXISTS ${identifier(s.nspname)};\n`;
    for (const e of enums.rows) yield `CREATE TYPE ${identifier(e.schema)}.${identifier(e.typname)} AS ENUM (${e.labels.map(literal).join(",")});\n`;
    for (const s of sequences.rows) yield `CREATE SEQUENCE ${identifier(s.schemaname)}.${identifier(s.sequencename)} AS ${s.data_type} INCREMENT BY ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START WITH ${s.start_value} CACHE ${s.cache_size} ${s.cycle ? "CYCLE" : "NO CYCLE"};\n`;
    for (const table of tables) {
      const cols = columns.rows.filter((c) => c.schema === table.schema && c.name === table.name);
      yield `CREATE TABLE ${identifier(table.schema)}.${identifier(table.name)} (${cols.map((c) => `${identifier(c.column)} ${c.type}${c.default_value ? ` DEFAULT ${c.default_value}` : ""}${c.required ? " NOT NULL" : ""}`).join(",")});\n`;
      const cursor = identifier(`backup_${table.name}`);
      await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT * FROM ONLY ${identifier(table.schema)}.${identifier(table.name)}`);
      try {
        for (;;) {
          const rows = await client.query({ text: `FETCH 64 FROM ${cursor}`, rowMode: "array", types: { getTypeParser: () => (v: string) => v } });
          if (!rows.rowCount) break;
          for (const values of rows.rows) yield `INSERT INTO ${identifier(table.schema)}.${identifier(table.name)} (${cols.map((c) => identifier(c.column)).join(",")}) VALUES (${values.map((v: string | null) => v === null ? "NULL" : literal(v)).join(",")});\n`;
        }
      } finally { await client.query(`CLOSE ${cursor}`).catch(() => undefined); }
    }
    for (const c of constraints.rows) yield `ALTER TABLE ${identifier(c.schema)}.${identifier(c.name)} ADD CONSTRAINT ${identifier(c.conname)} ${c.definition};\n`;
    for (const i of indexes.rows) yield `${i.definition};\n`;
    for (const s of sequences.rows) {
      const state = await client.query(`SELECT last_value::text,is_called FROM ${identifier(s.schemaname)}.${identifier(s.sequencename)}`);
      yield `SELECT pg_catalog.setval(${literal(`${identifier(s.schemaname)}.${identifier(s.sequencename)}`)},${state.rows[0].last_value},${state.rows[0].is_called});\n`;
    }
    for (const o of owners.rows) yield `ALTER SEQUENCE ${identifier(o.schema)}.${identifier(o.sequence)} OWNED BY ${identifier(o.table_schema)}.${identifier(o.table_name)}.${identifier(o.column)};\n`;
  })());
}
