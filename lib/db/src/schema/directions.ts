import { pgTable, serial, integer, text, jsonb, timestamp, bigint, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { distributionYears } from "./distributions";
const at = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const directionTemplates = pgTable("direction_templates", {
  id: serial("id").primaryKey(), version: integer("version").notNull().unique(),
  text: text("text").notNull(), createdAt: at(),
}, (t) => [check("direction_template_version", sql`${t.version} > 0`)]);
export const directionTokens = pgTable("direction_tokens", {
  id: serial("id").primaryKey(), yearId: integer("year_id").notNull().references(() => distributionYears.id),
  personId: text("person_id").notNull(), tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(), templateId: integer("template_id").notNull().references(() => directionTemplates.id),
  context: jsonb("context").$type<{
    holderName: string; calendarYear: number; boardApprovalDate: string;
    maxAmountCents: string; suggestedAmountCents: string; isPractice: boolean;
  }>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: at(), createdBy: text("created_by").notNull(),
}, (t) => [check("direction_token_hash_format", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`)]);
export const directionTokenEvents = pgTable("direction_token_events", {
  id: serial("id").primaryKey(), tokenId: integer("token_id").notNull().references(() => directionTokens.id),
  kind: text("kind").$type<"voided" | "continued" | "spent">().notNull(),
  createdAt: at(), createdBy: text("created_by").notNull(),
}, (t) => [check("direction_token_event_kind", sql`${t.kind} IN ('voided','continued','spent')`)]);
export const directionSessions = pgTable("direction_sessions", {
  id: serial("id").primaryKey(), tokenId: integer("token_id").notNull().unique().references(() => directionTokens.id),
  sessionHash: text("session_hash").notNull().unique(),
  ip: text("ip").notNull(), browser: text("browser").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: at(),
}, (t) => [check("direction_session_hash_format", sql`${t.sessionHash} ~ '^[a-f0-9]{64}$'`)]);
export type DirectionEvidence = {
  typedName: string; signedAt: string; signedAtNewYork: string; email: string;
  linkId: number; continuedAt: string; ip: string; browser: string;
  templateVersion: number; consentText: string; consent: true;
};
export const signedDirections = pgTable("signed_directions", {
  id: serial("id").primaryKey(), yearId: integer("year_id").notNull().references(() => distributionYears.id),
  personId: text("person_id").notNull(), tokenId: integer("token_id").unique().references(() => directionTokens.id),
  templateId: integer("template_id").notNull().references(() => directionTemplates.id),
  kind: text("kind").$type<"electronic" | "paper">().notNull(),
  amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  receivedDate: text("received_date").notNull(),
  // IDs intentionally aren't FKs: a guarded practice reset removes its files/ledger,
  // but retains immutable signature history and invalidates it via direction_resets.
  documentId: integer("document_id"), sourceDocumentId: integer("source_document_id"),
  documentHash: text("document_hash"), pdfHash: text("pdf_hash"),
  evidence: jsonb("evidence").$type<DirectionEvidence>(),
  createdAt: at(), createdBy: text("created_by").notNull(),
}, (t) => [
  check("direction_amount_nonnegative", sql`${t.amountCents} >= 0`),
  check("direction_evidence_kind", sql`(${t.kind} = 'paper' AND ${t.tokenId} IS NULL) OR (${t.kind} = 'electronic' AND ${t.tokenId} IS NOT NULL AND ${t.evidence} IS NOT NULL AND ${t.documentId} IS NOT NULL AND ${t.sourceDocumentId} IS NOT NULL AND ${t.documentHash} IS NOT NULL AND ${t.pdfHash} IS NOT NULL AND ${t.documentHash} ~ '^[a-f0-9]{64}$' AND ${t.pdfHash} ~ '^[a-f0-9]{64}$')`),
]);
export const directionConfirmations = pgTable("direction_confirmations", {
  id: serial("id").primaryKey(), directionId: integer("direction_id").notNull().unique().references(() => signedDirections.id),
  entryId: integer("entry_id"), supersedesId: integer("supersedes_id"),
  note: text("note").notNull(), createdAt: at(), createdBy: text("created_by").notNull(),
});
export const directionReceipts = pgTable("direction_receipts", {
  id: serial("id").primaryKey(), directionId: integer("direction_id").notNull().references(() => signedDirections.id),
  messageId: text("message_id"), result: text("result").notNull(),
  detail: text("detail").notNull(), createdAt: at(),
}, (t) => [check("direction_receipt_result", sql`${t.result} IN ('reserved','sent','failed','unknown')`)]);
export const directionDispatches = pgTable("direction_dispatches", {
  id: serial("id").primaryKey(), tokenId: integer("token_id").notNull().references(() => directionTokens.id),
  messageId: text("message_id"), result: text("result").notNull(), createdAt: at(),
}, (t) => [check("direction_dispatch_result", sql`${t.result} IN ('sent','failed','unknown')`)]);
export const directionResets = pgTable("direction_resets", {
  id: serial("id").primaryKey(), yearId: integer("year_id").notNull().references(() => distributionYears.id),
  lastTokenId: integer("last_token_id").notNull(), lastDirectionId: integer("last_direction_id").notNull(),
  createdAt: at(), createdBy: text("created_by").notNull(),
});
