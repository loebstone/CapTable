import type { FrozenYearInputs } from "@workspace/db";

// Finalization policy only. Never alters figures, rates or arithmetic.
export function sourceDocumentBlockers(input: FrozenYearInputs, isPractice: boolean) {
  if (isPractice || !input.figures) return [];
  const missing = [
    ...(input.figures.grossDocumentId == null ? ["Gross timber revenue"] : []),
    ...input.figures.costs.flatMap((cost, index) =>
      cost.documentId == null ? [`${cost.label} (cost line ${index + 1})`] : []),
  ];
  return missing.length ? [{
    personId: null, displayName: "Year",
    reason: `Source document missing for: ${missing.join(", ")}`,
  }] : [];
}
