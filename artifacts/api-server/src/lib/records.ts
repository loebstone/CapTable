import { db, auditLog } from "@workspace/db";
import { sql, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function write<T>(actor: string, action: (tx: Tx, actor: string) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // Serialize this tiny app's writes, including bootstrap and last-person removal.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(48133001)`);
    return action(tx, actor);
  });
}

export async function append<T extends PgTable>(
  tx: Tx, actor: string, table: T, values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  const [row] = await tx.insert(table).values(values).returning();
  if (!row) throw new Error("Insert did not return a record");
  const entity = getTableName(table);
  await tx.insert(auditLog).values({
    actor, entity, operation: "INSERT", recordId: String((row as { id: number }).id),
  });
  return row as T["$inferSelect"];
}

export function latestBy<T, K>(rows: T[], key: (row: T) => K): T[] {
  // Callers order descending id. The first revision wins.
  return [...new Map(rows.slice().reverse().map((row) => [key(row), row])).values()];
}
