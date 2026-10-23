import { pgTable, serial, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { distributionYears } from "./distributions";

const at = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
export type MailingDraft = {
  subject: string; body: string; documentIds: number[];
  attachment: "notice" | "statement" | "none";
  choices: Record<string, "notice" | "statement" | "none">;
};
export const mailSettings = pgTable("mail_settings", {
  id: serial("id").primaryKey(), replyTo: text("reply_to").notNull(),
  createdBy: text("created_by").notNull(), createdAt: at(),
});
export const paperPreferences = pgTable("paper_preferences", {
  id: serial("id").primaryKey(), personId: text("person_id").notNull(),
  prefersPaper: boolean("prefers_paper").notNull(), createdBy: text("created_by").notNull(), createdAt: at(),
});
export const mailingDrafts = pgTable("mailing_drafts", {
  id: serial("id").primaryKey(), yearId: integer("year_id").notNull().references(() => distributionYears.id),
  content: jsonb("content").$type<MailingDraft>().notNull(), createdBy: text("created_by").notNull(), createdAt: at(),
});
export const mailingBatches = pgTable("mailing_batches", {
  id: serial("id").primaryKey(), yearId: integer("year_id").notNull().references(() => distributionYears.id),
  draftId: integer("draft_id").notNull().references(() => mailingDrafts.id),
  kind: text("kind").$type<"send" | "resend" | "preview">().notNull(),
  createdBy: text("created_by").notNull(), createdAt: at(),
});
export type MailAttachmentRecord = { filename: string; size: number; sha256: string; documentId?: number };
export const mailingAttempts = pgTable("mailing_attempts", {
  id: serial("id").primaryKey(), batchId: integer("batch_id").notNull().references(() => mailingBatches.id),
  personId: text("person_id").notNull(), to: text("recipient_email").notNull(),
  // Legacy columns remain nullable to preserve historical append-only rows.
  // New mailings keep one uniform subject/body in the immutable mailing draft.
  subject: text("subject"), body: text("body"), replyTo: text("reply_to").notNull(),
  attachments: jsonb("attachments").$type<MailAttachmentRecord[]>().notNull(),
  createdAt: at(), createdBy: text("created_by").notNull(),
});
export const mailingResults = pgTable("mailing_results", {
  id: serial("id").primaryKey(), attemptId: integer("attempt_id").notNull().unique().references(() => mailingAttempts.id),
  messageId: text("message_id").unique(), result: text("result").$type<"sent" | "failed" | "unknown">().notNull(),
  detail: text("detail").notNull(), createdAt: at(),
});
export const mailingEvents = pgTable("mailing_events", {
  id: serial("id").primaryKey(), webhookId: text("webhook_id").notNull().unique(),
  messageId: text("message_id").notNull(), event: text("event").notNull(), occurredAt: text("occurred_at").notNull(),
  createdAt: at(),
});
