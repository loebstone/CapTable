import { pgTable, serial, text, integer, timestamp, numeric, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { rateTables } from "./rates";

// CSV imports are sparse overlays on a full manual revision (or a new year).
// A later manual save supersedes these overlays without mutating their history.
export const rateImports = pgTable("rate_imports", {
  id: serial("id").primaryKey(),
  taxYear: integer("tax_year").notNull(),
  baseTableId: integer("base_table_id").references(() => rateTables.id),
  filename: text("filename").notNull(),
  changedCount: integer("changed_count").notNull(),
  unchangedCount: integer("unchanged_count").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
export const rateCodeRevisions = pgTable("rate_code_revisions", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => rateImports.id),
  code: text("code").notNull(),
  rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
  sourceNote: text("source_note").notNull(),
}, (t) => [
  unique("rate_code_import_unique").on(t.importId, t.code),
  check("import_rate_range", sql`${t.rate} BETWEEN 0 AND 1`),
  check("import_rate_none_zero", sql`${t.code} <> 'NONE' OR ${t.rate} = 0`),
  check("import_rate_code", sql`${t.code} ~ '^(FEDERAL|NONE|[A-Z]{2})$'`),
]);
