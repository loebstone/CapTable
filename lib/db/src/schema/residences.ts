import { pgTable, serial, text, boolean, timestamp, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One logical current residence per person; every correction is a new revision.
export const residences = pgTable("tax_residences", {
  id: serial("id").primaryKey(),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  stateCode: text("state_code"),
  confirmed: boolean("confirmed").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  note: text("note").notNull(),
}, (t) => [
  check("residence_state", sql`${t.stateCode} IS NULL OR ${t.stateCode} ~ '^(NONE|[A-Z]{2})$'`),
  check("residence_confirmation", sql`NOT ${t.confirmed} OR (${t.stateCode} IS NOT NULL AND ${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`),
  index("residence_person_idx").on(t.personId, t.id),
]);
