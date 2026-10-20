import { Router, type IRouter } from "express";
import { distributionEntries, distributionHolds } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { GetYearParams, GetYearResponse, RecordPaymentBody, ReversePaymentBody, SetYearHoldBody } from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { write, append } from "../lib/records";
import { requireFinalized, yearDetail, calendarDate, requiredNote } from "../lib/distribution-years";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();
router.post("/years/:id/payments", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = RecordPaymentBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireFinalized(tx, id);
    const detail = await yearDetail(tx, id);
    const holder = detail.holders.find((h) => h.personId === data.personId);
    if (!holder) throw new HttpError(404, "Shareholder is not in this year's frozen snapshot");
    const amount = BigInt(data.amountCents);
    if (amount <= 0n) throw new HttpError(400, "Enter a positive amount; use reversal for a mistaken entry");
    if (amount > BigInt(holder.remainingCents!)) throw new HttpError(409, `Entry exceeds remaining open amount of ${holder.remainingCents} cents for ${holder.displayName}`);
    if (data.kind === "cash" && !data.method?.trim()) throw new HttpError(400, "Cash-paid entries need a method or check number");
    await append(tx, actor, distributionEntries, {
      yearId: id, personId: holder.personId, kind: data.kind, amountCents: amount,
      date: calendarDate(data.date), method: data.kind === "cash" ? data.method!.trim() : null,
      note: data.note?.trim() ?? "", createdBy: actor,
    });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/reversals", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = ReversePaymentBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireFinalized(tx, id);
    const [original] = await tx.select().from(distributionEntries).where(and(eq(distributionEntries.id, data.entryId), eq(distributionEntries.yearId, id))).limit(1);
    if (!original || original.amountCents <= 0n) throw new HttpError(400, "Only a positive entry in this year can be reversed");
    const [previous] = await tx.select().from(distributionEntries).where(eq(distributionEntries.reversesEntryId, original.id)).limit(1);
    if (previous) throw new HttpError(409, "This entry has already been reversed");
    await append(tx, actor, distributionEntries, {
      yearId: id, personId: original.personId, kind: original.kind, amountCents: -original.amountCents,
      date: calendarDate(data.date), method: original.method, note: requiredNote(data.note),
      reversesEntryId: original.id, createdBy: actor,
    });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/holds", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = SetYearHoldBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireFinalized(tx, id);
    const detail = await yearDetail(tx, id);
    if (!detail.holders.some((h) => h.personId === data.personId)) throw new HttpError(404, "Shareholder is not in this year's frozen snapshot");
    await append(tx, actor, distributionHolds, { yearId: id, ...data, note: requiredNote(data.note), createdBy: actor });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
export default router;
