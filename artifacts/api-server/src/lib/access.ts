import { accessEntries, db } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { append, latestBy, type Tx } from "./records";
import { HttpError } from "./errors";

export async function effectiveAccess(database: Tx | typeof db = db) {
  return latestBy(await database.select().from(accessEntries).orderBy(desc(accessEntries.id)), (r) => r.personId);
}
export async function activeEntry(personId: string, database: Tx | typeof db = db) {
  const [row] = await database.select().from(accessEntries).where(eq(accessEntries.personId, personId)).orderBy(desc(accessEntries.id)).limit(1);
  return row && !row.removedAt ? row : null;
}
export async function assertAccess(personId: string, database: Tx | typeof db = db) {
  if (!await activeEntry(personId, database)) throw new HttpError(403, "This person is not on the active HWD Distributions access list");
}
export async function eligible(personId: string) {
  if (await activeEntry(personId)) return;
  const all = await effectiveAccess();
  // Only a never-initialized access list can bootstrap; removed history cannot reset it.
  if (all.length === 0 && process.env.BOOTSTRAP_PERSON_ID && personId === process.env.BOOTSTRAP_PERSON_ID) return;
  throw new HttpError(403, "This person is not on the active HWD Distributions access list");
}
export async function bootstrapOnVerifiedSignIn(tx: Tx, person: {personId: string; displayName: string}) {
  if (await activeEntry(person.personId, tx)) return;
  const all = await effectiveAccess(tx);
  if (all.length !== 0 || !process.env.BOOTSTRAP_PERSON_ID || person.personId !== process.env.BOOTSTRAP_PERSON_ID) {
    throw new HttpError(403, "This person is not on the active HWD Distributions access list");
  }
  await append(tx, person.personId, accessEntries, {
    ...person, addedBy: person.personId, note: "Initial access: verified bootstrap person",
  });
}
