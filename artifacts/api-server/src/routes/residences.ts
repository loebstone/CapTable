import { Router, type IRouter } from "express";
import { db, residences } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { ListResidencesResponse, SaveResidenceBody, SaveResidenceResponse } from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { append, write, latestBy } from "../lib/records";
import { assertAccess } from "../lib/access";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.get("/residences", async (_req, res): Promise<void> => {
  const rows = latestBy(await db.select().from(residences).orderBy(desc(residences.id)), (r) => r.personId);
  res.json(ListResidencesResponse.parse(rows.sort((a, b) => a.displayName.localeCompare(b.displayName))));
});
router.post("/residences", async (req, res): Promise<void> => {
  const data = SaveResidenceBody.parse(req.body);
  const row = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const [previous] = await tx.select().from(residences).where(eq(residences.personId, data.personId)).orderBy(desc(residences.id)).limit(1);
    if (!previous) throw new HttpError(404, "Holder not found; load current holdings first");
    return append(tx, actor, residences, {
      ...data, displayName: previous.displayName,
      confirmedBy: data.confirmed ? actor : null,
      confirmedAt: data.confirmed ? new Date().toISOString() : null,
    });
  });
  res.status(201).json(SaveResidenceResponse.parse(row));
});
export default router;
