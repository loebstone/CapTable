import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const magicLinks = pgTable("magic_links", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
export const linkConsumptions = pgTable("link_consumptions", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull().unique().references(() => magicLinks.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
export const sessions = pgTable("hwd_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  personId: text("person_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
export const sessionRevocations = pgTable("session_revocations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().unique().references(() => sessions.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
