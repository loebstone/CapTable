// TEST DATA ONLY. Never imported by the application or used as a fallback.
// Stable fake IDs are fixture positions, not real Roster identities.
const groups = {
  A: [
    ["Esmond Robert III", "50", "CT"],
    ["Shea Rosemary", "50", "CT"],
  ],
  B: [
    ["Adorno Marco", "4.3", "MA", true],
    ["Adorno Pamela", "4", "MA"],
    ["Baillio Ashley Davis", "5", "FL"],
    ["Boelter Polly", "8.3", "HI"],
    ["Davis Allan", "11", "CA"],
    ["Davis Jeff", "1", "FL"],
    ["Dong Davis Stewart", "2", "CA"],
    ["Dong Dexter David", "2", "MA"],
    ["Dong Patty Pieropan", "2.3", "CA"],
    ["Dong Polly Mei", "2", "CA"],
    ["Fiorenzi Andrew", "2.8", "FL"],
    ["Fiorenzi Camille", "2.8", "FL"],
    ["Fiorenzi Marie", "2.9", "FL"],
    ["Fiorenzi Philomena", "2.8", "FL"],
    ["Gaston Ben", "1", "VA"],
    ["Gaston Gilbert J. Jr.", "20.4", "VA"],
    ["Gaston Natalie Davis", "5", null],
    ["Gaston Stan", "1", "VA"],
    ["Mathieu Leigh E.", "3", "ME"],
    ["Mathieu Nicky", "3", "ME"],
    ["Mowatt Bobbie Gaston", "5", "ME"],
    ["Pieropan Nancy", "8.4", "WY"],
  ],
  C: [
    ["Blassingame Ashley Loeb", "2", "CA"],
    ["Clayson Davis", "12", "MA"],
    ["Clayson Diana W.", "7", "MA"],
    ["Clayson Lindsay", "3", "MA"],
    ["Forster Nancy Anne", "20", "MA"],
    ["Harris Wendy", "9", "MA"],
    ["Jenkins Christine C.", "6", "CA"],
    ["Kneisel David", "6", "CT"],
    ["Kneisel Geoffrey", "7", "ME", true],
    ["Kneisel Lindsay", "7", "MA"],
    ["Loeb Hillary Clayson", "10", "CA"],
    ["Loeb Marina", "2", "CA"],
    ["Loeb Victoria (Tory)", "2", "CA"],
    ["Rapp Jennifer", "7", "MO"],
  ],
  D: [
    ["Davis Bryn", "11.33", "MA"],
    ["Davis Kiel", "11.33", "CO"],
    ["Holmes Brette Kameny", "16", "UK"],
    ["Kameny Xander", "17", "CA"],
    ["Maldonado Kehr", "11.34", "MA"],
    ["Stone Asa", "10", "MA"],
    ["Stone Micah", "11", "MA"],
    ["Stone Noah W.", "11", "MA"],
    ["Stone Susan", "1", "MA"],
  ],
} as const;

function four(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(4, "0")}`;
}
export const rosterFixture = {
  holdings: Object.entries(groups).flatMap(([shareClass, rows]) => rows.map((row, index) => ({
    personId: `fixture-${shareClass}-${String(index + 1).padStart(2, "0")}`,
    displayName: row[0], shareClass, shares: four(row[1]), addressState: row[2],
    isUnsettled: row.length > 3 && row[3] === true,
    note: row.length > 3 ? "Unsettled — test fixture" : "",
  }))),
  classes: Object.entries(groups).map(([shareClass, rows]) => ({ shareClass, totalShares: "100.0000", holderCount: rows.length })),
  grandTotal: "400.0000",
  asOf: "2026-10-20T12:00:00.000Z",
};
