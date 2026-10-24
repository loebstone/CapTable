import {
  auditLog, distributionYears, yearUploads, yearDocuments, yearFigures, yearCosts,
  yearDeclarations, yearFinalizations, yearCorrections, distributionEntries, distributionHolds,
  mailingDrafts,
  directionTokens, signedDirections, directionResets,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { assertAccess } from "./access";
import { write, append } from "./records";
import { defaultMailing } from "./mailings";
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
    const tokens = await tx.select().from(directionTokens).where(eq(directionTokens.yearId, id));
    const directions = await tx.select().from(signedDirections).where(eq(signedDirections.yearId, id));
    if (tokens.length || directions.length) {
      await append(tx, actor, directionResets, { yearId: id, lastTokenId: Math.max(0, ...tokens.map((t) => t.id)),
        lastDirectionId: Math.max(0, ...directions.map((d) => d.id)), createdBy: actor }, "PRACTICE_DIRECTIONS_RESET");
    }
    // Every deletion is scoped to this persisted practice year (or its figure IDs).
    for (const table of Object.values(tables)) await tx.delete(table).where(eq(table.yearId, id));
    if (figures.length) await tx.delete(yearCosts).where(inArray(yearCosts.figuresId, figures.map((f) => f.id)));
    await tx.delete(yearFigures).where(eq(yearFigures.yearId, id));
    await tx.delete(yearDocuments).where(eq(yearDocuments.yearId, id));
    await tx.delete(yearUploads).where(eq(yearUploads.yearId, id));
    // Preview history remains permanent, but a reset draft must not retain IDs
    // pointing at source documents that the practice reset just removed.
    const drafts = await tx.select().from(mailingDrafts).where(eq(mailingDrafts.yearId, id));
    if (drafts.length) await append(tx, actor, mailingDrafts, { yearId: id, content: defaultMailing, createdBy: actor }, "PRACTICE_MAILING_RESET");
    await tx.insert(auditLog).values({
      actor, entity: "distribution_years", recordId: String(id),
      operation: JSON.stringify({ action: "PRACTICE_RESET", year: year.calendarYear, snapshotId: year.snapshotId, removed: counts }),
    });
    return yearDetail(tx, id);
  });
}
