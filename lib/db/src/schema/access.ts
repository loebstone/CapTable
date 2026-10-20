import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// Append-only revisions. The greatest id per personId is the effective entry.
export const accessEntries = pgTable("access_entries", {
  id: serial("id").primaryKey(),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  addedBy: text("added_by").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
  note: text("note").notNull(),
}, (t) => [index("access_person_idx").on(t.personId, t.id)]);
