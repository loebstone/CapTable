import type { ReportContext, ReportHolder } from "./context";
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
  </style></head><body><main class="sheet">${body}${footer(context)}</main></body></html>`;
}
function valueRow(label: string, value: string, strong = false) {
  return `<tr${strong ? ' class="strong"' : ""}><td>${html(label)}</td><td class="right amount">${html(value)}</td></tr>`;
}
export function statementHtml(context: ReportContext, holder: ReportHolder) {
  const year = context.year;
  const c = year.calculation!;
  const numerator = BigInt(c.netProfitCents) * shareUnits(holder.shares);
  const denominator = 4000000n * 10000n;
  const federal = rounded(numerator * rateUnits(c.federalRate), denominator);
  const state = rounded(numerator * rateUnits(holder.stateRate!), denominator);
  const rounding = BigInt(holder.estimatedTaxCents!) - federal - state;
  // Privacy boundary: render only this holder's records. Do not render free-text
  // ledger/hold/correction notes or methods that could name a different person.
  const entries = year.payments.filter((e) => e.personId === holder.personId);
  const paymentRows = entries.map((entry) => `<tr><td>${html(entry.date)}</td><td>${html(BigInt(entry.amountCents) < 0n
    ? entry.kind === "cash" ? "Cash reversal" : "APIC retention reversal"
    : entry.kind === "cash" ? "Cash paid" : "Retained as additional paid-in capital")}</td><td class="right amount">${html(dollars(entry.amountCents))}</td></tr>`).join("");
  const body = `<header><div class="eyebrow">Shareholder distribution statement · ${year.calendarYear}</div>
    <h1>${ISSUER}</h1><p>Timber revenue distribution for ${year.calendarYear}</p></header>
    <div class="sub"><div><h2>${html(holder.displayName)}</h2><p>Class ${html(holder.shareClass)} · ${html(holder.shares)} shares</p></div>
    <div class="right muted"><p>Statement as of ${html(context.generatedAt.slice(0, 10))} (UTC)</p><p>${year.status === "corrected" ? "Includes recorded corrections" : "Finalized distribution record"}</p></div></div>
    <div class="box">Your nominal distribution <strong class="hero amount">${html(dollars(holder.nominalCents))}</strong>
    <p>This is the amount declared for your shares, before accounting for cash already paid or amounts you directed the Corporation to retain.</p></div>
    <div class="grid"><section><h2>How your amount was determined</h2><table>
    ${valueRow("Net timbering profit for the year", dollars(c.netProfitCents))}
    ${valueRow("Declared amount per share", dollars(year.declaredPerShareCents))}
    ${valueRow("Declaration date", dateLabel(year.declarationDate))}
    ${valueRow("Your shares", holder.shares)}
    ${valueRow("Your nominal distribution", dollars(holder.nominalCents), true)}</table></section>
    <section><h2>Your estimated tax</h2><table>
    ${valueRow(`Federal tax at ${percent(c.federalRate)}`, dollars(federal))}
    ${valueRow(`State tax: ${holder.stateCode} at ${percent(holder.stateRate)}`, dollars(state))}
    ${rounding === 0n ? "" : valueRow("Cent rounding adjustment", dollars(rounding))}
    ${valueRow("Total estimated tax", dollars(holder.estimatedTaxCents), true)}</table>
    <p class="muted">Estimated from your share of the year's net timbering profit, using the rates recorded for this finalized year.</p></section></div>
    <p class="caveat">${TAX_CAVEAT}</p>
    <h2>Cash paid and amounts retained</h2>
    <p class="muted">For cash, the date is the payment date. For retained amounts, it is the date your direction letter was received. A negative entry reverses an earlier entry.</p>
    <table><colgroup><col style="width:22%"><col style="width:54%"><col style="width:24%"></colgroup><thead><tr><th>Date</th><th>Record</th><th class="right">Amount</th></tr></thead><tbody>
    ${paymentRows || '<tr><td colspan="3">No cash payments or APIC retentions have been recorded.</td></tr>'}</tbody></table>
    <table style="margin-top:12px">${valueRow("Total cash paid, after reversals", dollars(holder.paidCents))}
    ${valueRow("Total retained as additional paid-in capital, after reversals", dollars(holder.retainedCents))}
    ${valueRow("Remaining amount", dollars(holder.remainingCents), true)}</table>
    <p>Status: <strong>${html(holder.status)}</strong>${holder.status === "held" ? ". The remaining amount is marked as held." : ""}</p>`;
  return document(context, `${year.calendarYear} shareholder statement`, body);
}
export function boardHtml(context: ReportContext) {
  const year = context.year, c = year.calculation;
  const sourceName = (id: number) => year.documents.find((d) => d.id === id)?.filename ?? "Missing document";
  const figureRows = year.figures ? valueRow(`Gross timber revenue — ${sourceName(year.figures.grossDocumentId)}`, dollars(year.figures.grossCents)) +
    year.figures.costs.map((line) => valueRow(`${line.label} — ${sourceName(line.documentId)}`, dollars(line.amountCents))).join("") +
    valueRow("Net timbering profit (gross minus costs)", dollars(c!.netProfitCents), true) : valueRow("Year figures", "Not recorded");
  const worked = c ? valueRow("Net profit", dollars(c.netProfitCents)) +
    valueRow("Federal rate", percent(c.federalRate)) + valueRow(`Highest state: ${c.highestState ?? "missing"}`, percent(c.highestStateRate)) +
    valueRow("Combined rate", percent(c.combinedRate)) + valueRow("Pool: net × combined rate", dollars(c.poolCents)) +
    valueRow("Divide pool by shares", "400") + valueRow("Proposed amount per share", dollars(c.proposedPerShareCents), true) : valueRow("Proposed amount", "Awaiting figures");
  const body = `<header><div class="eyebrow">Board summary · ${year.calendarYear} · ${html(year.status)}</div>
    <h1>${ISSUER}</h1><div class="sub"><p>Distribution year ${year.calendarYear} · snapshot #${year.snapshotId}</p><p>As of ${html(context.generatedAt.slice(0, 10))} (UTC)</p></div></header>
    <p>${context.classes.map((cl) => `Class ${html(cl.shareClass)}: ${html(cl.totalShares)} shares / ${cl.holderCount} holders`).join(" · ")} · <strong>${year.holders.length} shareholders</strong></p>
    <div class="grid"><section><h2>Year figures and source documents</h2><table class="mini">${figureRows}</table>
    <p><strong>Declared per share:</strong> ${html(dollars(year.declaredPerShareCents))} · <strong>Date:</strong> ${html(dateLabel(year.declarationDate))}</p>
    <table class="mini">${valueRow("Sum of nominal amounts", dollars(c?.sumNominalCents ?? null))}
    ${valueRow("Declared per share × 400", dollars(c?.declaredPoolCents ?? null))}
    ${valueRow("Rounding residual (sum minus declared × 400)", dollars(c?.residualCents ?? null), true)}</table></section>
    <section><h2>Worked proposed per-share calculation</h2><table class="mini">${worked}</table></section></div>
    <div class="totals"><span>Nominal <strong>${html(dollars(year.declaredPerShareCents === null ? null : year.totals.nominalCents))}</strong></span>
    <span>Paid <strong>${html(dollars(year.totals.paidCents))}</strong></span><span>Retained <strong>${html(dollars(year.totals.retainedCents))}</strong></span>
    <span>Remaining <strong>${html(dollars(year.declaredPerShareCents === null ? null : year.totals.remainingCents))}</strong></span>
    <span>${year.totals.openCount} open / ${year.totals.heldCount} held / ${year.totals.completeCount} complete</span></div>
    <table class="holders"><colgroup><col style="width:25%"><col style="width:5%"><col style="width:6%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:12%"><col style="width:8%"></colgroup><thead><tr>
    <th>Name</th><th>Class</th><th>State</th><th class="right">Shares</th><th class="right">Nominal</th><th class="right">Est. tax</th><th class="right">Surplus</th><th>Status</th></tr></thead><tbody>
    ${year.holders.map((h) => `<tr data-holder-row><td class="name">${html(h.displayName)}${h.isUnsettled ? " (unsettled)" : ""}</td><td>${html(h.shareClass)}</td><td>${html(h.stateCode ?? "missing")}</td><td class="right">${html(h.shares)}</td><td class="right">${html(dollars(h.nominalCents))}</td><td class="right">${html(dollars(h.estimatedTaxCents))}</td><td class="right">${html(dollars(h.surplusCents))}</td><td>${html(h.status)}</td></tr>`).join("")}
    </tbody></table><p class="muted">${year.status === "draft" ? "Open year: figures, rates and residences remain subject to revision until finalization." : year.status === "corrected" ? "Includes explicit corrections; calculations retain the finalized snapshot, rates and residences." : "Finalized inputs are locked."}</p>`;
  return document(context, `${year.calendarYear} board summary`, body, true);
}
