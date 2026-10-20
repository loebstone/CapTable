import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, residences, auditLog } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { ListResidencesResponse, SaveResidenceBody, SaveResidenceResponse, ConfirmAllResidencesBody, ConfirmAllResidencesResponse } from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { append, write, latestBy } from "../lib/records";
import { assertAccess } from "../lib/access";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.get("/residences", async (_req, res): Promise<void> => {
  const rows = latestBy(await db.select().from(residences).orderBy(desc(residences.id)), (r) => r.personId);
  res.json(ListResidencesResponse.parse(rows.sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.displayName.localeCompare(b.displayName))));
});
router.post("/residences", async (req, res): Promise<void> => {
  const data = SaveResidenceBody.parse(req.body);
  const { expectedRevisionId, ...fields } = data;
  const row = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const [previous] = await tx.select().from(residences).where(eq(residences.personId, data.personId)).orderBy(desc(residences.id)).limit(1);
    if (!previous) throw new HttpError(404, "Holder not found; load current holdings first");
    if (expectedRevisionId !== undefined && expectedRevisionId !== previous.id) throw new HttpError(409, "Residence changed since it was displayed. Review the current state before confirming.");
    return append(tx, actor, residences, {
      ...fields, note: data.note ?? "", displayName: previous.displayName,
      confirmedBy: data.confirmed ? actor : null,
      confirmedAt: data.confirmed ? new Date().toISOString() : null,
    });
  });
  res.status(201).json(SaveResidenceResponse.parse(row));
});
router.post("/residences/confirm-all", async (req, res): Promise<void> => {
  const data = ConfirmAllResidencesBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const current = latestBy(await tx.select().from(residences).orderBy(desc(residences.id)), (r) => r.personId);
    const eligible = current.filter((r) => !r.confirmed && r.stateCode !== null);
    const expected = new Set(data.revisionIds);
    if (expected.size !== data.revisionIds.length || expected.size !== eligible.length || eligible.some((r) => !expected.has(r.id))) {
      throw new HttpError(409, "Residences changed since the preview. Review the updated states before confirming; nothing was written.");
    }
    const confirmedAt = new Date().toISOString(), batchId = randomUUID();
    const counts = new Map<string, number>();
    for (const r of eligible) {
      counts.set(r.stateCode!, (counts.get(r.stateCode!) ?? 0) + 1);
      await append(tx, actor, residences, {
        personId: r.personId, displayName: r.displayName, stateCode: r.stateCode,
        confirmed: true, confirmedBy: actor, confirmedAt, note: r.note,
      }, JSON.stringify({ action: "RESIDENCE_CONFIRMED", batchId, stateCode: r.stateCode, personId: r.personId, confirmedAt }));
    }
    const output = {
      confirmedCount: eligible.length, confirmedBy: actor, confirmedAt,
      stateCounts: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([stateCode, count]) => ({ stateCode, count })),
      skipped: current.filter((r) => !r.confirmed && r.stateCode === null).sort((a, b) => a.displayName.localeCompare(b.displayName)).map(({ personId, displayName }) => ({ personId, displayName })),
    };
    if (eligible.length) await tx.insert(auditLog).values({
      actor, entity: "tax_residences", recordId: batchId,
      operation: JSON.stringify({ action: "RESIDENCES_CONFIRMED", ...output }),
    });
    // Validate before COMMIT, so a bad response cannot leave a partial success.
    return ConfirmAllResidencesResponse.parse(output);
  });
  res.json(result);
});
export default router;
