import type { FrozenYearInputs } from "@workspace/db";
import { HttpError } from "./errors";
import { shareUnits } from "./roster";

// All intermediate money, rates and shares use exact integer ratios.
// Cent rounding is half away from zero; no float conversions anywhere.
export function rounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Positive denominator required");
  const sign = numerator < 0n ? -1n : 1n;
  const value = numerator * sign;
  return sign * ((value + denominator / 2n) / denominator);
}
export function units4(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const v = units < 0n ? -units : units;
  return `${sign}${v / 10000n}.${String(v % 10000n).padStart(4, "0")}`;
}
export function rateUnits(rate: string): bigint {
  if (!/^\d\.\d{4}$/.test(rate)) throw new Error("Four-decimal rate required");
  return BigInt(rate.replace(".", ""));
}
export function validateYearSnapshot(rows: FrozenYearInputs["rows"]) {
  for (const shareClass of ["A", "B", "C", "D"]) {
    const total = rows.filter((r) => r.shareClass === shareClass).reduce((sum, r) => sum + shareUnits(r.shares), 0n);
    const delta = total - 1000000n;
    if (delta !== 0n) throw new HttpError(409, `Class ${shareClass} is ${delta < 0n ? "short" : "over"} by ${units4(delta < 0n ? -delta : delta)} shares (observed ${units4(total)}; required 100.0000)`);
  }
  const total = rows.reduce((sum, r) => sum + shareUnits(r.shares), 0n);
  if (total !== 4000000n) throw new HttpError(409, `Snapshot grand total is ${units4(total)}; required 400.0000`);
}

type Entry = {personId: string; kind: "cash" | "apic"; amountCents: bigint};
type Hold = {personId: string; held: boolean; note: string};

export function calculateYear(input: FrozenYearInputs, entries: Entry[] = [], holds: Hold[] = []) {
  const blockers: {personId: string | null; displayName: string; reason: string}[] = [];
  const residenceMap = new Map(input.residences.map((r) => [r.personId, r]));
  const rateMap = new Map(input.rates.states.map((s) => [s.stateCode, s.rate]));
  const federal = rateUnits(input.rates.federalRate);
  const figures = input.figures;
  const gross = figures ? BigInt(figures.grossCents) : 0n;
  const costs = figures ? figures.costs.reduce((sum, c) => sum + BigInt(c.amountCents), 0n) : 0n;
  const net = gross - costs;
  const declared = input.declaration ? BigInt(input.declaration.declaredPerShareCents) : null;
  if (!figures) blockers.push({ personId: null, displayName: "Year", reason: "Gross revenue and source-document-backed figures are missing" });
  if (!input.declaration) blockers.push({ personId: null, displayName: "Year", reason: "Declared per-share amount and declaration date are missing" });
  const grouped = new Map<string, {personId: string; displayName: string; shareClass: string; shares: bigint; isUnsettled: boolean}>();
  for (const row of input.rows) {
    const previous = grouped.get(row.personId);
    if (previous) {
      previous.shares += shareUnits(row.shares);
      previous.shareClass += `, ${row.shareClass}`;
      previous.isUnsettled ||= row.isUnsettled;
    } else grouped.set(row.personId, { ...row, shares: shareUnits(row.shares) });
  }
  let highestRate: bigint | null = null;
  let highestState: string | null = null;
  let missingRate = false;
  const holders = [...grouped.values()].map((person) => {
    const residence = residenceMap.get(person.personId);
    const state = residence?.stateCode ?? null;
    const stateRate = state ? rateMap.get(state) ?? null : null;
    if (!state) blockers.push({ personId: person.personId, displayName: person.displayName, reason: "Tax residence is missing" });
    if (!residence?.confirmed) blockers.push({ personId: person.personId, displayName: person.displayName, reason: "Tax residence is unconfirmed" });
    if (state && stateRate === null) blockers.push({ personId: person.personId, displayName: person.displayName, reason: `No rate row for ${state} in this year's rate table` });
    if (stateRate === null) missingRate = true;
    else if (highestRate === null || rateUnits(stateRate) > highestRate) {
      highestRate = rateUnits(stateRate); highestState = state;
    }
    const nominal = declared === null ? null : rounded(declared * person.shares, 10000n);
    // Tax uses exact (unrounded) gain; only displayed gain and final tax round to cents.
    const gain = figures ? rounded(net * person.shares, 4000000n) : null;
    const tax = figures && stateRate !== null ? rounded(net * person.shares * (federal + rateUnits(stateRate)), 4000000n * 10000n) : null;
    const personEntries = entries.filter((e) => e.personId === person.personId);
    const paid = personEntries.filter((e) => e.kind === "cash").reduce((sum, e) => sum + e.amountCents, 0n);
    const retained = personEntries.filter((e) => e.kind === "apic").reduce((sum, e) => sum + e.amountCents, 0n);
    const remaining = nominal === null ? null : nominal - paid - retained;
    const hold = holds.find((h) => h.personId === person.personId);
    const held = hold ? hold.held : person.isUnsettled;
    const status: "open" | "held" | "complete" = remaining === 0n ? "complete" : held ? "held" : "open";
    return {
      personId: person.personId, displayName: person.displayName, shareClass: person.shareClass,
      shares: units4(person.shares), stateCode: state, residenceConfirmed: !!residence?.confirmed,
      isUnsettled: person.isUnsettled, stateRate,
      nominalCents: nominal?.toString() ?? null, shareOfGainCents: gain?.toString() ?? null,
      estimatedTaxCents: tax?.toString() ?? null,
      surplusCents: nominal !== null && tax !== null ? (nominal - tax).toString() : null,
      paidCents: paid.toString(), retainedCents: retained.toString(), remainingCents: remaining?.toString() ?? null,
      status, holdNote: hold?.note ?? (person.isUnsettled ? "Held: unsettled in the frozen holdings snapshot" : null),
    };
  });
  const combined: bigint | null = missingRate || highestRate === null ? null : federal + highestRate;
  const sumNominal = holders.reduce((sum, h) => sum + BigInt(h.nominalCents ?? "0"), 0n);
  const expected = declared === null ? null : declared * 400n;
  const calculation = figures ? {
    grossCents: gross.toString(), costTotalCents: costs.toString(), netProfitCents: net.toString(),
    federalRate: input.rates.federalRate,
    highestState: missingRate ? null : highestState,
    highestStateRate: missingRate || highestRate === null ? null : units4(highestRate),
    combinedRate: combined === null ? null : units4(combined),
    poolCents: combined === null ? null : rounded(net * combined, 10000n).toString(),
    proposedPerShareCents: combined === null ? null : rounded(net * combined, 10000n * 400n).toString(),
    declaredPoolCents: expected?.toString() ?? null,
    sumNominalCents: declared === null ? null : sumNominal.toString(),
    residualCents: expected === null ? null : (sumNominal - expected).toString(),
  } : null;
  return {
    calculation, holders, blockers,
    totals: {
      nominalCents: sumNominal.toString(),
      paidCents: holders.reduce((s, h) => s + BigInt(h.paidCents), 0n).toString(),
      retainedCents: holders.reduce((s, h) => s + BigInt(h.retainedCents), 0n).toString(),
      remainingCents: holders.reduce((s, h) => s + BigInt(h.remainingCents ?? "0"), 0n).toString(),
      openCount: holders.filter((h) => h.status === "open").length,
      heldCount: holders.filter((h) => h.status === "held").length,
      completeCount: holders.filter((h) => h.status === "complete").length,
    },
  };
}
