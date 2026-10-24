import { residences } from "@workspace/db";
import { eq } from "drizzle-orm";
import { append, type Tx } from "./records";
import { proposedState, type fetchRosterHoldings } from "./roster";

/** All stored holdings refreshes preserve the same missing/proposed residence rule. */
export async function proposeHoldingResidences(tx: Tx, actor: string, payload: Awaited<ReturnType<typeof fetchRosterHoldings>>) {
  for (const person of new Map(payload.holdings.map((h) => [h.personId, h])).values()) {
    const [existing] = await tx.select({ id: residences.id }).from(residences).where(eq(residences.personId, person.personId)).limit(1);
    if (existing) continue;
    const stateCode = proposedState(person.addressState);
    await append(tx, actor, residences, {
      personId: person.personId, displayName: person.displayName, stateCode, confirmed: false,
      note: stateCode === null ? "Missing: no addressState supplied by Roster" : `Proposed from Roster addressState (${person.addressState}); requires confirmation`,
    });
  }
}
