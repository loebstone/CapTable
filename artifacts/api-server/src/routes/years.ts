import { Router, type IRouter } from "express";
import {
  db, distributionYears, snapshotRows, yearFigures, yearCosts, yearDeclarations,
  yearFinalizations, yearCorrections,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  OpenYearBody, GetYearParams, GetYearResponse, ListYearsResponse, SaveYearFiguresBody,
  DeclareYearBody, FinalizeYearBody, CorrectYearBody,
} from "@workspace/api-zod";
import { currentIdentity } from "../lib/auth";
import { assertAccess } from "../lib/access";
import { write, append } from "../lib/records";
import { validateYearSnapshot, calculateYear } from "../lib/distribution-math";
import {
  yearDetail, currentYearRates, draftInputs, requireDraft, requireFinalized, requireDocument, requiredNote, calendarDate,
} from "../lib/distribution-years";
import { HttpError } from "../lib/errors";
import { resetPracticeYear } from "../lib/practice-years";

const router: IRouter = Router();
for (const [path, practice] of [["/years", false], ["/practice-years", true]] as const) router.get(path, async (_req, res): Promise<void> => {
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(distributionYears).where(eq(distributionYears.isPractice, practice)).orderBy(desc(distributionYears.calendarYear), desc(distributionYears.id));
    return Promise.all(rows.map(async (year) => {
      const final = await requireFinalized(tx, year.id).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 409) return null;
        throw error;
      });
      const [correction] = await tx.select({ id: yearCorrections.id }).from(yearCorrections).where(eq(yearCorrections.yearId, year.id)).limit(1);
      return { ...year, status: final ? correction ? "corrected" : "finalized" : "draft" };
    }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(ListYearsResponse.parse(result));
});
router.get("/years/:id", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const detail = await db.transaction((tx) => yearDetail(tx, id), { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(GetYearResponse.parse(detail));
});
router.post("/years", async (req, res): Promise<void> => {
  const data = OpenYearBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const [existing] = await tx.select().from(distributionYears).where(and(eq(distributionYears.calendarYear, data.calendarYear), eq(distributionYears.isPractice, false))).limit(1);
    if (!data.isPractice && existing) throw new HttpError(409, `A real distribution year already exists for ${data.calendarYear}`);
    const rows = await tx.select().from(snapshotRows).where(eq(snapshotRows.snapshotId, data.snapshotId));
    if (!rows.length) throw new HttpError(404, "Holdings snapshot not found or empty");
    validateYearSnapshot(rows);
    await currentYearRates(tx, data.calendarYear);
    const year = await append(tx, actor, distributionYears, { ...data, note: requiredNote(data.note), createdBy: actor });
    return yearDetail(tx, year.id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/reset-practice", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const result = await resetPracticeYear(currentIdentity(req).personId, id, req.body);
  // Refusal is returned AFTER committing its audit, not thrown in the transaction.
  if ("denied" in result) { res.status(403).json({ error: "A real distribution year cannot be reset" }); return; }
  res.json(GetYearResponse.parse(result));
});
router.post("/years/:id/figures", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = SaveYearFiguresBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx);
    const year = await requireDraft(tx, id);
    if (!year.isPractice || data.grossDocumentId != null) await requireDocument(tx, id, data.grossDocumentId);
    for (const cost of data.costs) {
      if (!cost.label.trim()) throw new HttpError(400, "Each cost line needs a nonblank label");
      if (!year.isPractice || cost.documentId != null) await requireDocument(tx, id, cost.documentId);
    }
    const figures = await append(tx, actor, yearFigures, {
      yearId: id, grossCents: BigInt(data.grossCents), grossDocumentId: data.grossDocumentId ?? null,
      note: requiredNote(data.note), createdBy: actor,
    });
    for (const cost of data.costs) await append(tx, actor, yearCosts, {
      figuresId: figures.id, label: cost.label.trim(), amountCents: BigInt(cost.amountCents), documentId: cost.documentId ?? null,
    });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/declaration", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = DeclareYearBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireDraft(tx, id);
    await append(tx, actor, yearDeclarations, {
      yearId: id, declaredPerShareCents: BigInt(data.declaredPerShareCents),
      declarationDate: calendarDate(data.declarationDate), note: requiredNote(data.note), createdBy: actor,
    });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/finalize", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = FinalizeYearBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireDraft(tx, id);
    const frozenInputs = await draftInputs(tx, id);
    validateYearSnapshot(frozenInputs.rows);
    const { blockers } = calculateYear(frozenInputs);
    if (blockers.length) throw new HttpError(409, `Cannot finalize: ${blockers.map((b) => `${b.displayName}: ${b.reason}`).join("; ")}`);
    await append(tx, actor, yearFinalizations, { yearId: id, frozenInputs, note: requiredNote(data.note), createdBy: actor });
    return yearDetail(tx, id);
  });
  res.status(201).json(GetYearResponse.parse(result));
});
router.post("/years/:id/corrections", async (req, res): Promise<void> => {
  const { id } = GetYearParams.parse(req.params);
  const data = CorrectYearBody.parse(req.body);
  const result = await write(currentIdentity(req).personId, async (tx, actor) => {
    await assertAccess(actor, tx); await requireFinalized(tx, id);
    const note = requiredNote(data.note);
    if (data.kind !== "note" && (!data.amountCents || BigInt(data.amountCents) === 0n)) throw new HttpError(400, "Amount corrections require a nonzero signed cent adjustment");
    if (data.kind === "note" && data.amountCents != null) throw new HttpError(400, "A note-only correction cannot carry an amount");
    if (data.kind === "grossAdjustment" || data.kind === "costAdjustment") {
      if (!data.documentId) throw new HttpError(400, "Financial figure corrections require an attached source document");
      await requireDocument(tx, id, data.documentId);
    }
    if (data.kind === "declaredPerShareAdjustment" && !data.declarationDate) throw new HttpError(400, "A declaration adjustment needs its declaration date");
    await append(tx, actor, yearCorrections, {
      yearId: id, kind: data.kind, amountCents: data.amountCents == null ? null : BigInt(data.amountCents),
      documentId: data.documentId ?? null,
      declarationDate: data.declarationDate ? calendarDate(data.declarationDate) : null,
      note, createdBy: actor,
    });
    const detail = await yearDetail(tx, id);
    if (BigInt(detail.calculation!.grossCents) < 0n || BigInt(detail.calculation!.costTotalCents) < 0n || BigInt(detail.declaredPerShareCents!) < 0n) {
      throw new HttpError(409, "Correction would make gross, total costs or declared per-share amount negative");
    }
    if (detail.holders.some((h) => BigInt(h.remainingCents!) < 0n)) throw new HttpError(409, "Correction would reduce a nominal amount below its paid plus retained total; reverse entries first");
    return detail;
  });
  res.status(201).json(GetYearResponse.parse(result));
});
export default router;
