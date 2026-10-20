import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Every application insert gets an audit row in the same transaction.
// Never store raw magic links, session tokens, keys or cookies here.
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  entity: text("entity").notNull(),
  operation: text("operation").notNull(),
  recordId: text("record_id").notNull(),
});
