import type { ReportContext, ReportHolder } from "./context";
import { formatShares } from "@workspace/display";
import { dollars, html, percent, dateLabel, ISSUER, TAX_CAVEAT } from "./format";
import { rateUnits, rounded } from "../distribution-math";
import { shareUnits } from "../roster";

function footer(context: ReportContext) {
  return `<footer>Generated ${html(context.generatedAt)} · ENVIRONMENT ${html(context.environment)}<br>Observed database ${html(context.databaseName)} · server ${html(context.serverAddress ?? "SQL NULL")}</footer>`;
}
function document(context: ReportContext, title: string, body: string, compact = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${html(ISSUER)} — ${html(title)}</title><style>
  @page{size:Letter;margin:${compact ? ".32in" : ".55in"}}
  *{box-sizing:border-box}html,body{margin:0;padding:0;color:#172b31;background:white;font-family:Arial,Helvetica,sans-serif;font-size:${compact ? "9px" : "12px"};line-height:1.32}
  .sheet{width:${compact ? "754.56px" : "710.4px"};transform-origin:top left}
  .practice-watermark{position:fixed;top:43%;left:0;width:100%;text-align:center;transform:rotate(-32deg);font:bold 33px Arial,sans-serif;white-space:nowrap;color:rgba(150,30,30,.24);z-index:1000;pointer-events:none}
  h1{font-family:Georgia,serif;font-size:${compact ? "22px" : "27px"};line-height:1.12;margin:0 0 4px;font-weight:normal}
  h2{font-size:${compact ? "12px" : "15px"};margin:0 0 7px}h3{font-size:11px;margin:15px 0 6px}
  p{margin:7px 0}.muted{color:#536269}.eyebrow{letter-spacing:1.4px;text-transform:uppercase;color:#884d40;font-size:9px;margin-bottom:8px}
  header{border-bottom:2px solid #884d40;padding-bottom:${compact ? "7px" : "17px"};margin-bottom:${compact ? "8px" : "18px"}}
  .sub{display:flex;justify-content:space-between;gap:12px}.sub p{margin:3px 0}
  .amount{font-variant-numeric:tabular-nums;white-space:nowrap}.box{background:#f4f2ec;border:1px solid #d6d2c9;padding:12px;margin:13px 0}
  .hero{font:normal 30px Georgia,serif;display:block;margin-top:5px}.caveat{border-left:3px solid #884d40;padding:9px 12px;background:#f8f5ef;font-size:11px;line-height:1.5;margin:14px 0}
  table{width:100%;border-collapse:collapse;table-layout:fixed}th{text-align:left;font-size:inherit;font-weight:600;color:#536269;background:#f4f2ec}
  td,th{padding:${compact ? "2px 4px" : "5px 7px"};border-bottom:1px solid #deddd7;vertical-align:top;overflow-wrap:anywhere}
  .right{text-align:right}.strong{font-weight:bold}.grid{display:grid;grid-template-columns:1fr 1fr;gap:${compact ? "12px" : "24px"}}
  .mini td{padding:2px 4px}.totals{display:flex;justify-content:space-between;border-top:1px solid #884d40;border-bottom:1px solid #884d40;padding:6px 0;margin:8px 0}
  .holders{font-size:8.5px;line-height:1.2}.holders th{font-size:8px}.holders td{padding:2px 3px;white-space:nowrap;overflow-wrap:normal}
  .holders tr:nth-child(even){background:#faf9f5}.holders .name{white-space:normal}
  footer{font-size:${compact ? "7px" : "8px"};line-height:1.4;color:#536269;border-top:1px solid #d6d2c9;padding-top:7px;margin-top:12px}
  </style></head><body>${context.year.isPractice ? '<div class="practice-watermark">PRACTICE — NOT A STATEMENT</div>' : ""}<main class="sheet">${body}${footer(context)}</main></body></html>`;
}
function valueRow(label: string, value: string, strong = false) {
  return `<tr${strong ? ' class="strong"' : ""}><td>${html(label)}</td><td class="right amount">${html(value)}</td></tr>`;
}
export function statementHtml(context: ReportContext, holder: ReportHolder) {
  const year = context.year;
  const c = year.calculation;
  const draftPractice = year.isPractice && year.status === "draft";
  const undeclared = draftPractice && year.declaredPerShareCents === null;
  const numerator = c ? BigInt(c.netProfitCents) * shareUnits(holder.shares) : null;
  const denominator = 4000000n * 10000n;
  const federal = numerator === null || !c ? null : rounded(numerator * rateUnits(c.federalRate), denominator);
  const state = numerator === null || holder.stateRate === null ? null : rounded(numerator * rateUnits(holder.stateRate), denominator);
  const rounding = holder.estimatedTaxCents === null || federal === null || state === null ? null : BigInt(holder.estimatedTaxCents) - federal - state;
  const proposedPerShare = c?.proposedPerShareCents ?? null;
  const proposedDistribution = proposedPerShare === null ? null : rounded(BigInt(proposedPerShare) * shareUnits(holder.shares), 10000n);
  const proposedSurplus = proposedDistribution === null || holder.estimatedTaxCents === null ? null : proposedDistribution - BigInt(holder.estimatedTaxCents);
  // Privacy boundary: render only this holder's records. Do not render free-text
  // ledger/hold/correction notes or methods that could name a different person.
  const entries = year.payments.filter((e) => e.personId === holder.personId);
  const paymentRows = entries.map((entry) => `<tr><td>${html(entry.date)}</td><td>${html(BigInt(entry.amountCents) < 0n
    ? entry.kind === "cash" ? "Cash reversal" : "APIC retention reversal"
    : entry.kind === "cash" ? "Paid" : "APIC retained")}</td><td class="right amount">${html(dollars(entry.amountCents))}</td></tr>`).join("");
  const body = `<header><div class="eyebrow">Shareholder distribution statement · ${year.calendarYear}</div>
    <h1>${ISSUER}</h1><p>Timber revenue distribution for ${year.calendarYear}</p></header>
    <div class="sub"><div><h2>${html(holder.displayName)}</h2><p>Class ${html(holder.shareClass)} · ${html(formatShares(holder.shares))} shares</p></div>
    <div class="right muted"><p>Statement as of ${html(context.generatedAt.slice(0, 10))} (UTC)</p><p>${draftPractice ? "Proposed practice preview — not finalized" : year.status === "corrected" ? "Includes recorded corrections" : "Finalized distribution record"}</p></div></div>
    <div class="box">Your distribution <strong class="hero amount">${html(undeclared ? "not yet set" : dollars(holder.nominalCents))}</strong>
    <p>${undeclared ? "No distribution amount has been set. Proposed amounts below are for practice only." : `The Corporation distributed ${html(dollars(year.declaredPerShareCents))} per share. You hold ${html(formatShares(holder.shares))} shares. Below is what has been paid to you and what you directed the Corporation to keep as additional paid-in capital.`}</p></div>
    <div class="grid"><section><h2>How your amount was determined</h2><table>
    ${valueRow("Net timbering profit for the year", dollars(c?.netProfitCents ?? null))}
    ${valueRow("Distribution per share", undeclared ? "not yet set" : dollars(year.declaredPerShareCents))}
    ${undeclared ? valueRow("Proposed amount per share", dollars(proposedPerShare)) + valueRow("Proposed distribution for your shares", dollars(proposedDistribution)) : ""}
    ${valueRow("Approved by the board on", dateLabel(year.declarationDate))}
    ${valueRow("Your shares", formatShares(holder.shares))}
    ${valueRow("Allocated profit (your share of the net profit)", dollars(holder.shareOfGainCents))}
    ${valueRow("Distribution", undeclared ? "not yet set" : dollars(holder.nominalCents), true)}</table></section>
    <section><h2>Your estimated tax</h2><table>
    ${valueRow(c ? `Federal tax at ${percent(c.federalRate)}` : "Federal tax (awaiting figures)", dollars(federal))}
    ${valueRow(`State tax: ${holder.stateCode ?? "missing"} at ${percent(holder.stateRate)}`, dollars(state))}
    ${rounding === null || rounding === 0n ? "" : valueRow("Cent rounding adjustment", dollars(rounding))}
    ${valueRow("Estimated tax", dollars(holder.estimatedTaxCents), true)}
    ${valueRow("Surplus/Deficit", dollars(undeclared ? proposedSurplus : holder.surplusCents))}</table>
    <p class="muted">Surplus/Deficit is your distribution less your estimated tax.</p>
    <p class="muted">Estimated from your share of the year's net timbering profit, using ${draftPractice ? "proposed practice inputs, not finalized figures. Missing amounts are not recorded, not zero" : "the rates recorded for this finalized year"}.</p></section></div>
    <p class="caveat">${TAX_CAVEAT}</p>
    <h2>Paid and APIC retained</h2>
    ${holder.isOnHold ? '<p>Your distribution is being held pending resolution; the Corporation will be in touch.</p>' : `
    <p class="muted">For Paid, the date is the payment date. For APIC retained (additional paid-in capital), it is the date your direction letter was received. A negative entry reverses an earlier entry.</p>
    <table><colgroup><col style="width:22%"><col style="width:54%"><col style="width:24%"></colgroup><thead><tr><th>Date</th><th>Record</th><th class="right">Amount</th></tr></thead><tbody>
    ${paymentRows || '<tr><td colspan="3">No cash payments or APIC retentions have been recorded.</td></tr>'}</tbody></table>
    <table style="margin-top:12px">${valueRow("Paid", dollars(holder.paidCents))}
    ${valueRow("APIC retained", dollars(holder.retainedCents))}</table>`}
    <p>Instruction: <strong>${html(holder.instruction)}</strong></p>`;
  return document(context, `${year.calendarYear} shareholder statement`, body);
}
export function statementNoticeHtml(context: ReportContext, holder: ReportHolder) {
  const year = context.year;
  const c = year.calculation;
  const draftPractice = year.isPractice && year.status === "draft";
  const undeclared = draftPractice && year.declaredPerShareCents === null;
  // Identical presentation rounding and proposed fallback to statementHtml;
  // this document never changes the stored inputs or year calculations.
  const numerator = c ? BigInt(c.netProfitCents) * shareUnits(holder.shares) : null;
  const denominator = 4000000n * 10000n;
  const federal = numerator === null || !c ? null : rounded(numerator * rateUnits(c.federalRate), denominator);
  const state = numerator === null || holder.stateRate === null ? null : rounded(numerator * rateUnits(holder.stateRate), denominator);
  const rounding = holder.estimatedTaxCents === null || federal === null || state === null ? null : BigInt(holder.estimatedTaxCents) - federal - state;
  const proposedPerShare = c?.proposedPerShareCents ?? null;
  const proposedDistribution = proposedPerShare === null ? null : rounded(BigInt(proposedPerShare) * shareUnits(holder.shares), 10000n);
  const proposedSurplus = proposedDistribution === null || holder.estimatedTaxCents === null ? null : proposedDistribution - BigInt(holder.estimatedTaxCents);
  const surplus = undeclared ? proposedSurplus : holder.surplusCents === null ? null : BigInt(holder.surplusCents);
  const eligible = surplus === null ? null : surplus > 0n ? surplus : 0n;
  // Privacy boundary: only this holder's amounts and identity, never any
  // payment/hold/correction records, free-text notes or other holders' names.
  const body = `<header><div class="eyebrow">Shareholder distribution notice · ${year.calendarYear}</div>
    <h1>${ISSUER}</h1><p>Timber revenue distribution for ${year.calendarYear}</p></header>
    <div class="sub"><div><h2>${html(holder.displayName)}</h2><p>Class ${html(holder.shareClass)} · ${html(formatShares(holder.shares))} shares</p></div>
    <div class="right muted"><p>Notice dated ${html(context.generatedAt.slice(0, 10))}</p><p>${draftPractice ? "Proposed practice preview — not finalized" : year.status === "corrected" ? "Includes recorded corrections" : "Finalized distribution record"}</p></div></div>
    <div class="box">Your distribution <strong class="hero amount">${html(undeclared ? "not yet set" : dollars(holder.nominalCents))}</strong>
    <p>${undeclared ? "No distribution amount has been set. Proposed amounts below are for practice only." : `The Corporation will distribute ${html(dollars(year.declaredPerShareCents))} per share. You hold ${html(formatShares(holder.shares))} shares.`}</p></div>
    <div class="grid"><section><h2>How your amount was determined</h2><table>
    ${valueRow(`Net timbering profit for ${year.calendarYear}`, dollars(c?.netProfitCents ?? null))}
    ${valueRow("Distribution per share", undeclared ? "not yet set" : dollars(year.declaredPerShareCents))}
    ${valueRow("Approved by the board on", dateLabel(year.declarationDate))}
    ${valueRow("Your shares", formatShares(holder.shares))}
    ${valueRow("Your distribution", undeclared ? "not yet set" : dollars(holder.nominalCents), true)}</table></section>
    <section><h2>Your estimated tax</h2><table>
    ${valueRow("Allocated profit (your share of the net profit)", dollars(holder.shareOfGainCents))}
    ${valueRow(c ? `Federal tax at ${percent(c.federalRate)}` : "Federal tax (awaiting figures)", dollars(federal))}
    ${valueRow(`State tax: ${holder.stateCode ?? "missing"} at ${percent(holder.stateRate)}`, dollars(state))}
    ${rounding === null || rounding === 0n ? "" : valueRow("Cent rounding adjustment", dollars(rounding))}
    ${valueRow("Estimated tax", dollars(holder.estimatedTaxCents), true)}
    ${valueRow("Surplus/Deficit", dollars(surplus))}
    ${valueRow("Amount eligible for Additional Paid-In Capital reinvestment", dollars(eligible))}</table>
    <p class="muted">Surplus/Deficit is your distribution less your estimated tax.</p></section></div>
    <p class="caveat">${TAX_CAVEAT}</p>`;
  return document(context, `${year.calendarYear} shareholder distribution notice`, body);
}
export function boardHtml(context: ReportContext) {
  const year = context.year, c = year.calculation;
  const sum = (key: "shareOfGainCents" | "estimatedTaxCents" | "surplusCents") =>
    year.holders.some((h) => h[key] === null) ? null : year.holders.reduce((total, h) => total + BigInt(h[key]!), 0n);
  const sourceName = (id: number | null) => id === null && year.isPractice ? "none (practice)" : year.documents.find((d) => d.id === id)?.filename ?? "Missing document";
  const figureRows = year.figures ? valueRow(`Gross timber revenue — ${sourceName(year.figures.grossDocumentId)}`, dollars(year.figures.grossCents)) +
    year.figures.costs.map((line) => valueRow(`${line.label} — ${sourceName(line.documentId)}`, dollars(line.amountCents))).join("") +
    valueRow("Net timbering profit (gross minus costs)", dollars(c!.netProfitCents), true) : valueRow("Year figures", "Not recorded");
  const worked = c ? valueRow("Net profit", dollars(c.netProfitCents)) +
    valueRow("Federal rate", percent(c.federalRate)) + valueRow(`Highest state: ${c.highestState ?? "missing"}`, percent(c.highestStateRate)) +
    valueRow("Combined rate", percent(c.combinedRate)) + valueRow("Pool: net × combined rate", dollars(c.poolCents)) +
    valueRow("Divide pool by shares", "400") + valueRow("Proposed amount per share", dollars(c.proposedPerShareCents), true) : valueRow("Proposed amount", "Awaiting figures");
  const body = `<header><div class="eyebrow">Board summary · ${year.calendarYear} · ${html(year.status)}</div>
    <h1>${ISSUER}</h1><div class="sub"><p>Distribution year ${year.calendarYear} · snapshot #${year.snapshotId}</p><p>As of ${html(context.generatedAt.slice(0, 10))} (UTC)</p></div></header>
    <p>${context.classes.map((cl) => `Class ${html(cl.shareClass)}: ${html(formatShares(cl.totalShares))} shares / ${cl.holderCount} holders`).join(" · ")} · <strong>${year.holders.length} shareholders</strong></p>
    <div class="grid"><section><h2>Year figures and source documents</h2><table class="mini">${figureRows}</table>
    <p><strong>Distribution per share:</strong> ${html(dollars(year.declaredPerShareCents))} · <strong>Date:</strong> ${html(dateLabel(year.declarationDate))}</p>
    <table class="mini">${valueRow("Sum of distributions", dollars(c?.sumNominalCents ?? null))}
    ${valueRow("Distribution per share × 400", dollars(c?.declaredPoolCents ?? null))}
    ${valueRow("Rounding residual (sum minus per share × 400)", dollars(c?.residualCents ?? null), true)}</table></section>
    <section><h2>Worked proposed per-share calculation</h2><table class="mini">${worked}</table></section></div>
    <div class="totals"><span>on hold: ${year.totals.heldCount}, paid in full: ${year.totals.completeCount}, to pay: ${year.totals.openCount}</span></div>
    <table class="holders"><colgroup><col style="width:20%"><col style="width:5%"><col style="width:5%"><col style="width:6%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:9%"><col style="width:8%"><col style="width:7%"></colgroup><thead><tr>
    <th>Holder</th><th>Class</th><th>State</th><th class="right">Shares</th><th class="right">Allocated profit</th><th class="right">Distribution</th><th class="right">Estimated tax</th><th class="right">Surplus/Deficit</th><th class="right">APIC retained</th><th class="right">Paid</th><th>Instruction</th></tr></thead><tbody>
    ${year.holders.map((h) => `<tr data-holder-row><td class="name">${html(h.displayName)}${h.isUnsettled ? " (unsettled)" : ""}</td><td>${html(h.shareClass)}</td><td>${html(h.stateCode ?? "missing")}</td><td class="right">${html(formatShares(h.shares))}</td><td class="right">${html(dollars(h.shareOfGainCents))}</td><td class="right">${html(dollars(h.nominalCents))}</td><td class="right">${html(dollars(h.estimatedTaxCents))}</td><td class="right">${html(dollars(h.surplusCents))}</td><td class="right">${html(dollars(h.retainedCents))}</td><td class="right">${html(dollars(h.paidCents))}</td><td>${html(h.instruction)}</td></tr>`).join("")}
    </tbody><tfoot><tr class="strong"><td colspan="4">Totals</td><td class="right">${html(dollars(sum("shareOfGainCents")))}</td><td class="right">${html(dollars(year.declaredPerShareCents === null ? null : year.totals.nominalCents))}</td><td class="right">${html(dollars(sum("estimatedTaxCents")))}</td><td class="right">${html(dollars(sum("surplusCents")))}</td><td class="right">${year.payments.length ? html(dollars(year.totals.retainedCents)) : "—"}</td><td class="right">${year.payments.length ? html(dollars(year.totals.paidCents)) : "—"}</td><td></td></tr></tfoot></table><p class="muted">${year.status === "draft" ? "Open year: figures, rates and residences remain subject to revision until finalization." : year.status === "corrected" ? "Includes explicit corrections; calculations retain the finalized snapshot, rates and residences." : "Finalized inputs are locked."}</p>`;
  return document(context, `${year.calendarYear} board summary`, body, true);
}
