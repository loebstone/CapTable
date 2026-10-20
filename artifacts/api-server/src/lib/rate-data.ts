import { db, rateTables, stateRates, rateImports, rateCodeRevisions } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { latestBy, type Tx } from "./records";

export type RateDatabase = Tx | typeof db;

/** Full manual saves remain full replacements. CSV rows overlay that baseline. */
export async function currentRates(database: RateDatabase, taxYear: number) {
  const [base] = await database.select().from(rateTables).where(eq(rateTables.taxYear, taxYear)).orderBy(desc(rateTables.id)).limit(1);
  const condition = and(eq(rateImports.taxYear, taxYear), base ? eq(rateImports.baseTableId, base.id) : isNull(rateImports.baseTableId));
  const [lastImport] = await database.select().from(rateImports).where(condition).orderBy(desc(rateImports.id)).limit(1);
  if (!base && !lastImport) return null;
  const original = base ? await database.select().from(stateRates).where(eq(stateRates.tableId, base.id)) : [];
  const codes = new Map(original.map((s) => [s.stateCode, { rate: s.rate, sourceNote: s.sourceNote }]));
  if (base) codes.set("FEDERAL", { rate: base.federalRate, sourceNote: base.federalSourceNote });
  const revisions = await database.select({
    id: rateCodeRevisions.id, code: rateCodeRevisions.code, rate: rateCodeRevisions.rate, sourceNote: rateCodeRevisions.sourceNote,
  }).from(rateCodeRevisions).innerJoin(rateImports, eq(rateCodeRevisions.importId, rateImports.id))
    .where(condition).orderBy(desc(rateCodeRevisions.id));
  for (const r of latestBy(revisions, (r) => r.code)) codes.set(r.code, { rate: r.rate, sourceNote: r.sourceNote });
  const federal = codes.get("FEDERAL");
  if (!federal) throw new Error("Stored rate year has no federal rate");
  return {
    // Negative IDs identify CSV-only virtual tables, never FK targets. Frozen
    // distributions store their complete effective rate inputs, not this pointer.
    id: base?.id ?? -lastImport!.id, taxYear,
    federalRate: federal.rate, federalSourceNote: federal.sourceNote,
    states: [...codes].filter(([code]) => code !== "FEDERAL").sort(([a], [b]) => a.localeCompare(b))
      .map(([stateCode, value]) => ({ stateCode, ...value })),
    createdAt: lastImport?.createdAt ?? base!.createdAt,
    createdBy: lastImport?.createdBy ?? base!.createdBy,
    note: lastImport ? `CSV import ${lastImport.filename}: ${lastImport.changedCount} changed, ${lastImport.unchangedCount} unchanged` : base!.note,
  };
}

export async function allCurrentRates(database: RateDatabase) {
  const years = new Set([
    ...(await database.select({ year: rateTables.taxYear }).from(rateTables)).map((r) => r.year),
    ...(await database.select({ year: rateImports.taxYear }).from(rateImports)).map((r) => r.year),
  ]);
  return (await Promise.all([...years].sort((a, b) => b - a).map((y) => currentRates(database, y)))).filter((r) => r !== null);
}
