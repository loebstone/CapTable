import { pgTable, serial, text, integer, timestamp, numeric, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const rateTables = pgTable("rate_tables", {
  id: serial("id").primaryKey(),
  taxYear: integer("tax_year").notNull(),
  federalRate: numeric("federal_rate", { precision: 6, scale: 4 }).notNull(),
  federalSourceNote: text("federal_source_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
}, (t) => [check("federal_rate_range", sql`${t.federalRate} BETWEEN 0 AND 1`)]);
export const stateRates = pgTable("state_rates", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull().references(() => rateTables.id),
  stateCode: text("state_code").notNull(),
  rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
  sourceNote: text("source_note").notNull(),
}, (t) => [
  unique("state_rate_unique").on(t.tableId, t.stateCode),
  check("state_rate_code", sql`${t.stateCode} ~ '^(NONE|[A-Z]{2})$'`),
  check("state_rate_range", sql`${t.rate} BETWEEN 0 AND 1`),
  check("none_rate_zero", sql`${t.stateCode} <> 'NONE' OR ${t.rate} = 0`),
]);
