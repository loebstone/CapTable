import {
  db, distributionYears, snapshots, snapshotRows, residences, rateTables, stateRates,
  yearFigures, yearCosts, yearDeclarations, yearFinalizations, yearCorrections,
  distributionEntries, distributionHolds, yearDocuments, type FrozenYearInputs,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { latestBy, type Tx } from "./records";
import { HttpError } from "./errors";
import { calculateYear } from "./distribution-math";

export type Database = Tx | typeof db;

export async function requireYear(database: Database, id: number) {
  const [year] = await database.select().from(distributionYears).where(eq(distributionYears.id, id)).limit(1);
  if (!year) throw new HttpError(404, "Distribution year not found");
  return year;
}
export async function getFinalization(database: Database, yearId: number) {
  const [row] = await database.select().from(yearFinalizations).where(eq(yearFinalizations.yearId, yearId)).limit(1);
  return row ?? null;
}
export async function requireDraft(database: Database, yearId: number) {
  await requireYear(database, yearId);
  if (await getFinalization(database, yearId)) throw new HttpError(409, "This year is finalized and locked; append a correction with a note instead");
}
export async function requireFinalized(database: Database, yearId: number) {
  await requireYear(database, yearId);
  const row = await getFinalization(database, yearId);
  if (!row) throw new HttpError(409, "Finalize this year before recording corrections, payments or holds");
  return row;
}
export async function requireDocument(database: Database, yearId: number, documentId: number) {
  const [document] = await database.select().from(yearDocuments).where(eq(yearDocuments.id, documentId)).limit(1);
  if (!document || document.yearId !== yearId) throw new HttpError(400, "Every figure must reference an uploaded source document attached to this year");
  return document;
}
export async function currentYearRates(database: Database, calendarYear: number) {
  const [row] = await database.select().from(rateTables).where(eq(rateTables.taxYear, calendarYear)).orderBy(desc(rateTables.id)).limit(1);
  if (!row) throw new HttpError(409, `No rate table exists for ${calendarYear}. Enter rates or copy a prior year on Annual rates before opening this year.`);
  const states = await database.select({
    stateCode: stateRates.stateCode, rate: stateRates.rate, sourceNote: stateRates.sourceNote,
  }).from(stateRates).where(eq(stateRates.tableId, row.id)).orderBy(stateRates.stateCode);
  return { id: row.id, federalRate: row.federalRate, states };
}
export async function draftInputs(database: Database, id: number): Promise<FrozenYearInputs> {
  const year = await requireYear(database, id);
  const [snapshot] = await database.select().from(snapshots).where(eq(snapshots.id, year.snapshotId)).limit(1);
  const rows = await database.select().from(snapshotRows).where(eq(snapshotRows.snapshotId, year.snapshotId)).orderBy(snapshotRows.id);
  const currentResidences = latestBy(await database.select().from(residences).orderBy(desc(residences.id)), (r) => r.personId);
  const [figures] = await database.select().from(yearFigures).where(eq(yearFigures.yearId, id)).orderBy(desc(yearFigures.id)).limit(1);
  const costs = figures ? await database.select().from(yearCosts).where(eq(yearCosts.figuresId, figures.id)).orderBy(yearCosts.id) : [];
  const [declaration] = await database.select().from(yearDeclarations).where(eq(yearDeclarations.yearId, id)).orderBy(desc(yearDeclarations.id)).limit(1);
  return {
    snapshotId: year.snapshotId, snapshotAsOf: snapshot.asOf,
    rows: rows.map(({ personId, displayName, shareClass, shares, isUnsettled, note, addressState }) => ({ personId, displayName, shareClass, shares, isUnsettled, note, addressState })),
    residences: [...new Set(rows.map((r) => r.personId))].map((personId) => {
      const residence = currentResidences.find((r) => r.personId === personId);
      return { personId, stateCode: residence?.stateCode ?? null, confirmed: residence?.confirmed ?? false, revisionId: residence?.id ?? null };
    }),
    rates: await currentYearRates(database, year.calendarYear),
    figures: figures ? {
      grossCents: figures.grossCents.toString(), grossDocumentId: figures.grossDocumentId,
      costs: costs.map((c) => ({ label: c.label, amountCents: c.amountCents.toString(), documentId: c.documentId })), note: figures.note,
    } : null,
    declaration: declaration ? { declaredPerShareCents: declaration.declaredPerShareCents.toString(), declarationDate: declaration.declarationDate } : null,
  };
}
export function correctedInputs(base: FrozenYearInputs, corrections: (typeof yearCorrections.$inferSelect)[]): FrozenYearInputs {
  const input = structuredClone(base);
  for (const correction of corrections) {
    if (correction.kind === "note") continue;
    const amount = correction.amountCents;
    if (amount === null) throw new Error("Amount correction missing its amount");
    if (correction.kind === "grossAdjustment" && input.figures) {
      input.figures.grossCents = (BigInt(input.figures.grossCents) + amount).toString();
      if (correction.documentId) input.figures.grossDocumentId = correction.documentId;
    }
    if (correction.kind === "costAdjustment" && input.figures) {
      input.figures.costs.push({ label: `Correction: ${correction.note}`, amountCents: amount.toString(), documentId: correction.documentId! });
    }
    if (correction.kind === "declaredPerShareAdjustment" && input.declaration) {
      input.declaration.declaredPerShareCents = (BigInt(input.declaration.declaredPerShareCents) + amount).toString();
      if (correction.declarationDate) input.declaration.declarationDate = correction.declarationDate;
    }
  }
  return input;
}
export function documentResponse(row: typeof yearDocuments.$inferSelect) {
  return {
    id: row.id, filename: row.filename, contentType: row.contentType, size: row.size,
    uploadedAt: row.uploadedAt, uploadedBy: row.uploadedBy,
    downloadUrl: `/api/years/${row.yearId}/documents/${row.id}/file`,
  };
}
export async function yearDetail(database: Database, id: number) {
  const year = await requireYear(database, id);
  const finalization = await getFinalization(database, id);
  const corrections = await database.select().from(yearCorrections).where(eq(yearCorrections.yearId, id)).orderBy(yearCorrections.id);
  const base = finalization ? finalization.frozenInputs : await draftInputs(database, id);
  const effective = finalization ? correctedInputs(base, corrections) : base;
  const entries = await database.select().from(distributionEntries).where(eq(distributionEntries.yearId, id)).orderBy(distributionEntries.id);
  const holdHistory = await database.select().from(distributionHolds).where(eq(distributionHolds.yearId, id)).orderBy(desc(distributionHolds.id));
  const holds = latestBy(holdHistory, (r) => r.personId);
  const result = calculateYear(effective, entries, holds);
  const figuresHistory = await database.select().from(yearFigures).where(eq(yearFigures.yearId, id)).orderBy(yearFigures.id);
  const declarationHistory = await database.select().from(yearDeclarations).where(eq(yearDeclarations.yearId, id)).orderBy(yearDeclarations.id);
  const documents = await database.select().from(yearDocuments).where(eq(yearDocuments.yearId, id)).orderBy(yearDocuments.id);
  const history = [
    { id: `year-${year.id}`, kind: "Year opened", note: year.note, amountCents: null, createdAt: year.createdAt, createdBy: year.createdBy },
    ...figuresHistory.map((r) => ({ id: `figures-${r.id}`, kind: "Figures revision", note: r.note, amountCents: r.grossCents.toString(), createdAt: r.createdAt, createdBy: r.createdBy })),
    ...declarationHistory.map((r) => ({ id: `declaration-${r.id}`, kind: "Declaration revision (per share)", note: r.note, amountCents: r.declaredPerShareCents.toString(), createdAt: r.createdAt, createdBy: r.createdBy })),
    ...(finalization ? [{ id: `finalization-${finalization.id}`, kind: "Finalized", note: finalization.note, amountCents: null, createdAt: finalization.createdAt, createdBy: finalization.createdBy }] : []),
    ...corrections.map((r) => ({ id: `correction-${r.id}`, kind: r.kind, note: r.note, amountCents: r.amountCents?.toString() ?? null, createdAt: r.createdAt, createdBy: r.createdBy })),
    ...holdHistory.map((r) => ({ id: `hold-${r.id}`, kind: r.held ? `Hold: ${r.personId}` : `Hold released: ${r.personId}`, note: r.note, amountCents: null, createdAt: r.createdAt, createdBy: r.createdBy })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    ...year,
    status: finalization ? corrections.length ? "corrected" as const : "finalized" as const : "draft" as const,
    figures: effective.figures,
    declaredPerShareCents: effective.declaration?.declaredPerShareCents ?? null,
    declarationDate: effective.declaration?.declarationDate ?? null,
    rateTableId: effective.rates.id, finalizedAt: finalization?.createdAt ?? null,
    originalCalculation: finalization ? calculateYear(base).calculation : null,
    ...result,
    documents: documents.map(documentResponse),
    payments: entries.map((entry) => ({ ...entry, amountCents: entry.amountCents.toString() })),
    history,
  };
}
export function requiredNote(note: string) {
  if (!note.trim()) throw new HttpError(400, "A nonblank note is required");
  return note.trim();
}
export function calendarDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "Enter a valid calendar date in YYYY-MM-DD format");
  }
  return date;
}
