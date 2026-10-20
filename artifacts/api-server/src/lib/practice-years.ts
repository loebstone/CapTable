import {
  auditLog, distributionYears, yearUploads, yearDocuments, yearFigures, yearCosts,
  yearDeclarations, yearFinalizations, yearCorrections, distributionEntries, distributionHolds,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { assertAccess } from "./access";
import { write } from "./records";
import { requireYear, yearDetail } from "./distribution-years";
import { yearDocumentStore } from "./year-document-store";
import { ResetPracticeYearBody } from "@workspace/api-zod";

/**
 * Sole hard-delete exception: never delete the year, its snapshot, or audit rows.
 * The common advisory write lock serializes reset against uploads/figures/ledger.
 * Storage is not transactional: delete files first; on failure retain DB records
 * and return an explicit retry message. Missing objects are safe on retry.
 */
export async function resetPracticeYear(actor: string, id: number, input: unknown) {
  return write(actor, async (tx) => {
    await assertAccess(actor, tx);
    const year = await requireYear(tx, id);
    if (!year.isPractice) {
      await tx.insert(auditLog).values({
        actor, entity: "distribution_years", recordId: String(id),
        operation: JSON.stringify({ action: "PRACTICE_RESET_REFUSED", year: year.calendarYear, reason: "Real year" }),
      });
      return { denied: true as const };
    }
    ResetPracticeYearBody.parse(input);
    const documents = await tx.select().from(yearDocuments).where(eq(yearDocuments.yearId, id));
    const uploads = await tx.select().from(yearUploads).where(eq(yearUploads.yearId, id));
    const figures = await tx.select({ id: yearFigures.id }).from(yearFigures).where(eq(yearFigures.yearId, id));
    const costs = figures.length ? await tx.select({ id: yearCosts.id }).from(yearCosts).where(inArray(yearCosts.figuresId, figures.map((f) => f.id))) : [];
    const tables = { ledgerEntries: distributionEntries, holds: distributionHolds, corrections: yearCorrections, finalizations: yearFinalizations, declarations: yearDeclarations };
    const counts: Record<string, number> = { figures: figures.length, costs: costs.length, documents: documents.length, uploadReservations: uploads.length };
    for (const [name, table] of Object.entries(tables)) {
      const rows = await tx.select({ id: table.id }).from(table).where(eq(table.yearId, id));
      counts[name] = rows.length;
    }
    counts.storedFiles = await yearDocumentStore.removePracticeFiles([...documents.map((d) => d.objectPath), ...uploads.map((u) => u.objectPath)]);
    // Every deletion is scoped to this persisted practice year (or its figure IDs).
    for (const table of Object.values(tables)) await tx.delete(table).where(eq(table.yearId, id));
    if (figures.length) await tx.delete(yearCosts).where(inArray(yearCosts.figuresId, figures.map((f) => f.id)));
    await tx.delete(yearFigures).where(eq(yearFigures.yearId, id));
    await tx.delete(yearDocuments).where(eq(yearDocuments.yearId, id));
    await tx.delete(yearUploads).where(eq(yearUploads.yearId, id));
    await tx.insert(auditLog).values({
      actor, entity: "distribution_years", recordId: String(id),
      operation: JSON.stringify({ action: "PRACTICE_RESET", year: year.calendarYear, snapshotId: year.snapshotId, removed: counts }),
    });
    return yearDetail(tx, id);
  });
}
