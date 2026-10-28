import { db, sessions } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { activeEntry } from "./access";
import { signInCheck } from "./roster";

// Never authorize from an email typed by the visitor. A prior verified identity
// supplies the mapping; mailbox possession is still proved by the magic link.
// This allows existing members to sign in during a Roster outage.
export async function backDoorIdentity(email: string) {
  const [known] = await db.select().from(sessions).where(eq(sessions.email, email)).orderBy(desc(sessions.id)).limit(1);
  const person = known
    ? { personId: known.personId, displayName: known.displayName }
    : await signInCheck(email);
  return await activeEntry(person.personId) ? person : null;
}
