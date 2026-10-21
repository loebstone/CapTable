import { Router, type IRouter } from "express";
import { db, holdingFetches, snapshots, snapshotRows, residences } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GetHoldingsResponse, FetchHoldingsResponse, ListSnapshotsResponse, TakeSnapshotBody,
  TakeSnapshotResponse, GetSnapshotParams, GetSnapshotResponse,
} from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { fetchRosterHoldings, proposedState } from "../lib/roster";
import { append, write } from "../lib/records";
import { assertAccess } from "../lib/access";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.get("/holdings", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(holdingFetches).orderBy(desc(holdingFetches.id)).limit(1);
  res.json(GetHoldingsResponse.parse({ holdings: row ? { id: row.id, ...row.payload, fetchedAt: row.fetchedAt } : null }));
});
router.post("/holdings/fetch", async (req, res): Promise<void> => {
  const payload = await fetchRosterHoldings();
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const row = await append(tx, actor, holdingFetches, { payload, fetchedBy: actor });
    for (const person of new Map(payload.holdings.map((h) => [h.personId, h])).values()) {
      const [existing] = await tx.select({ id: residences.id }).from(residences).where(eq(residences.personId, person.personId)).limit(1);
      if (existing) continue;
      const stateCode = proposedState(person.addressState);
      await append(tx, actor, residences, {
        personId: person.personId, displayName: person.displayName, stateCode, confirmed: false,
        note: stateCode === null ? "Missing: no addressState supplied by Roster" : `Proposed from Roster addressState (${person.addressState}); requires confirmation`,
      });
    }
    return { id: row.id, ...payload, fetchedAt: row.fetchedAt };
  });
  res.json(FetchHoldingsResponse.parse(result));
});
router.get("/snapshots", async (_req, res): Promise<void> => {
  res.json(ListSnapshotsResponse.parse(await db.select().from(snapshots).orderBy(desc(snapshots.id))));
});
router.post("/snapshots", async (req, res): Promise<void> => {
  const data = TakeSnapshotBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const [fetch] = await tx.select().from(holdingFetches).where(eq(holdingFetches.id, data.fetchId)).limit(1);
    if (!fetch) throw new HttpError(404, "Stored holdings fetch not found; load holdings first");
    const payload = fetch.payload;
    const snapshot = await append(tx, actor, snapshots, {
      fetchId: fetch.id, asOf: payload.asOf, classes: payload.classes, grandTotal: payload.grandTotal,
      rowCount: payload.holdings.length, createdBy: actor, note: data.note.trim(),
    });
    for (const holding of payload.holdings) {
      await append(tx, actor, snapshotRows, { snapshotId: snapshot.id, ...holding });
    }
    return snapshot;
  });
  res.status(201).json(TakeSnapshotResponse.parse(result));
});
router.get("/snapshots/:id", async (req, res): Promise<void> => {
  const { id } = GetSnapshotParams.parse(req.params);
  const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.id, id)).limit(1);
  if (!snapshot) throw new HttpError(404, "Snapshot not found");
  const rows = await db.select().from(snapshotRows).where(eq(snapshotRows.snapshotId, id)).orderBy(snapshotRows.id);
  const [fetch] = await db.select().from(holdingFetches).where(eq(holdingFetches.id, snapshot.fetchId)).limit(1);
  res.json(GetSnapshotResponse.parse({
    id: snapshot.id, holdings: rows, classes: snapshot.classes, grandTotal: snapshot.grandTotal,
    asOf: snapshot.asOf, fetchedAt: fetch.fetchedAt,
  }));
});
export default router;
