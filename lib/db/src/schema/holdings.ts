import { pgTable, serial, text, timestamp, integer, jsonb, numeric, boolean, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type StoredHolding = {
  personId: string; displayName: string; shareClass: "A" | "B" | "C" | "D";
  shares: string; isUnsettled: boolean; note: string | null; addressState: string | null;
};
export type StoredClass = { shareClass: "A" | "B" | "C" | "D"; totalShares: string; holderCount: number };
export type StoredHoldings = { holdings: StoredHolding[]; classes: StoredClass[]; grandTotal: string; asOf: string };

export const holdingFetches = pgTable("holding_fetches", {
  id: serial("id").primaryKey(),
  payload: jsonb("payload").$type<StoredHoldings>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  fetchedBy: text("fetched_by").notNull(),
});
export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  fetchId: integer("fetch_id").notNull().references(() => holdingFetches.id),
  asOf: text("as_of").notNull(),
  classes: jsonb("classes").$type<StoredClass[]>().notNull(),
  grandTotal: numeric("grand_total", { precision: 10, scale: 4 }).notNull(),
  rowCount: integer("row_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  note: text("note").notNull(),
});
export const snapshotRows = pgTable("snapshot_rows", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  shareClass: text("share_class").$type<"A" | "B" | "C" | "D">().notNull(),
  shares: numeric("shares", { precision: 10, scale: 4 }).notNull(),
  isUnsettled: boolean("is_unsettled").notNull(),
  note: text("note"),
  addressState: text("address_state"),
}, (t) => [
  check("snapshot_valid_class", sql`${t.shareClass} IN ('A','B','C','D')`),
  check("snapshot_positive_shares", sql`${t.shares} >= 0`),
  unique("snapshot_person_class").on(t.snapshotId, t.personId, t.shareClass),
]);
