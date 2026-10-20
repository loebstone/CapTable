import { pgTable, serial, text, integer, bigint, boolean, date, timestamp, jsonb, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { snapshots, type StoredHolding } from "./holdings";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const distributionYears = pgTable("distribution_years", {
  id: serial("id").primaryKey(),
  calendarYear: integer("calendar_year").notNull(),
  // Creation-only: distribution year records have no update/delete API.
  isPractice: boolean("is_practice").notNull().default(false),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
}, (t) => [
  uniqueIndex("one_real_distribution_per_calendar_year").on(t.calendarYear).where(sql`${t.isPractice} = false`),
]);
export const yearUploads = pgTable("year_uploads", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  objectPath: text("object_path").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
});
export const yearDocuments = pgTable("year_documents", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  uploadId: integer("upload_id").notNull().unique().references(() => yearUploads.id),
  objectPath: text("object_path").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedAt: instant("uploaded_at"),
  uploadedBy: text("uploaded_by").notNull(),
});
export const yearFigures = pgTable("year_figures", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  grossCents: bigint("gross_cents", { mode: "bigint" }).notNull(),
  grossDocumentId: integer("gross_document_id").references(() => yearDocuments.id),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
}, (t) => [check("gross_nonnegative", sql`${t.grossCents} >= 0`)]);
export const yearCosts = pgTable("year_costs", {
  id: serial("id").primaryKey(),
  figuresId: integer("figures_id").notNull().references(() => yearFigures.id),
  label: text("label").notNull(),
  amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  documentId: integer("document_id").references(() => yearDocuments.id),
}, (t) => [check("cost_nonnegative", sql`${t.amountCents} >= 0`)]);
export const yearDeclarations = pgTable("year_declarations", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  declaredPerShareCents: bigint("declared_per_share_cents", { mode: "bigint" }).notNull(),
  declarationDate: date("declaration_date", { mode: "string" }).notNull(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
}, (t) => [check("declared_nonnegative", sql`${t.declaredPerShareCents} >= 0`)]);

export type FrozenYearInputs = {
  snapshotId: number;
  snapshotAsOf: string;
  rows: StoredHolding[];
  residences: { personId: string; stateCode: string | null; confirmed: boolean; revisionId: number | null }[];
  rates: { id: number; federalRate: string; states: { stateCode: string; rate: string; sourceNote: string }[] };
  figures: { grossCents: string; grossDocumentId: number | null; costs: { label: string; amountCents: string; documentId: number | null }[]; note: string } | null;
  declaration: { declaredPerShareCents: string; declarationDate: string } | null;
};
export const yearFinalizations = pgTable("year_finalizations", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().unique().references(() => distributionYears.id),
  frozenInputs: jsonb("frozen_inputs").$type<FrozenYearInputs>().notNull(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
});
export const yearCorrections = pgTable("year_corrections", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  kind: text("kind").$type<"note" | "grossAdjustment" | "costAdjustment" | "declaredPerShareAdjustment">().notNull(),
  amountCents: bigint("amount_cents", { mode: "bigint" }),
  documentId: integer("document_id").references(() => yearDocuments.id),
  declarationDate: date("declaration_date", { mode: "string" }),
  note: text("note").notNull(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
}, (t) => [check("year_correction_kind", sql`${t.kind} IN ('note','grossAdjustment','costAdjustment','declaredPerShareAdjustment')`)]);
export const distributionEntries = pgTable("distribution_entries", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  personId: text("person_id").notNull(),
  kind: text("kind").$type<"cash" | "apic">().notNull(),
  amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  date: date("date", { mode: "string" }).notNull(),
  method: text("method"),
  note: text("note").notNull(),
  reversesEntryId: integer("reverses_entry_id").unique(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
}, (t) => [
  check("distribution_entry_kind", sql`${t.kind} IN ('cash','apic')`),
  check("entry_reversal_sign", sql`(${t.amountCents} > 0 AND ${t.reversesEntryId} IS NULL) OR (${t.amountCents} < 0 AND ${t.reversesEntryId} IS NOT NULL AND length(trim(${t.note})) > 0)`),
]);
export const distributionHolds = pgTable("distribution_holds", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id").notNull().references(() => distributionYears.id),
  personId: text("person_id").notNull(),
  held: boolean("held").notNull(),
  note: text("note").notNull(),
  createdAt: instant("created_at"),
  createdBy: text("created_by").notNull(),
});
