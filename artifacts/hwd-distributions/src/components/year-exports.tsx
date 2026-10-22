import {
  getDownloadStatementUrl, getDownloadStatementsZipUrl, getDownloadBoardSummaryUrl, getDownloadLedgerUrl,
  getDownloadNoticeUrl, getDownloadNoticesZipUrl,
  type YearDetail,
} from "@workspace/api-client-react";
import { DownloadButton } from "@/components/download-button";

export function YearExports({ y }: { y: YearDetail }) {
  const final = y.isPractice || y.status === "finalized" || y.status === "corrected";
  const n = y.holders.length;
  return (
    <section id="exports" className="space-y-3" data-testid="section-exports">
      <h2 className="font-display text-xl">Statements &amp; exports</h2>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
        <div className="space-y-2 bg-card p-4">
          <div className="text-sm font-medium">Board summary (PDF)</div>
          <p className="text-xs text-muted-foreground">Available while the year is a draft, and after finalization.</p>
          <DownloadButton url={getDownloadBoardSummaryUrl(y.id)} fallbackName={`board-summary-${y.calendarYear}.pdf`} testId="button-download-board">Board summary</DownloadButton>
        </div>
        <div className="space-y-2 bg-card p-4">
          <div className="text-sm font-medium">Accountant workbook (XLSX)</div>
          <p className="text-xs text-muted-foreground">{y.isPractice ? "Practice ledger and per-shareholder totals, at any stage." : final ? "Paid-and-retained ledger and per-shareholder totals." : "The workbook is available after finalization."}</p>
          {final && <DownloadButton url={getDownloadLedgerUrl(y.id)} fallbackName={`ledger-${y.calendarYear}.xlsx`} testId="button-download-ledger">Workbook</DownloadButton>}
        </div>
        <div className="space-y-2 bg-card p-4">
          <div className="text-sm font-medium">All statements &amp; notices (ZIP)</div>
          <p className="text-xs text-muted-foreground">{final ? `${y.isPractice ? "Practice previews at any stage. " : ""}One PDF per holder, ${n} in all. This can take a little while.` : "Shareholder statements are available only after the year is finalized."}</p>
          {final && <div className="flex flex-wrap gap-2">
            <DownloadButton url={getDownloadStatementsZipUrl(y.id)} fallbackName={`statements-${y.calendarYear}.zip`} busyLabel={`Building ${n} statements…`} testId="button-download-statements-zip">All statements</DownloadButton>
            <DownloadButton url={getDownloadNoticesZipUrl(y.id)} fallbackName={`notices-${y.calendarYear}.zip`} busyLabel={`Building ${n} notices…`} testId="button-download-notices-zip">All notices (zip)</DownloadButton>
          </div>}
        </div>
      </div>
      {final && n > 0 && (
        <details className="rounded-lg border border-border bg-card">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium" data-testid="toggle-statements">Individual statements &amp; notices</summary>
          <ul className="divide-y divide-border border-t border-border">
            {y.holders.map((h) => (
              <li key={h.personId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm" data-testid={`row-statement-${h.personId}`}>
                <span>{h.displayName} <span className="num text-xs text-muted-foreground">Class {h.shareClass}</span></span>
                <div className="flex gap-2">
                  <DownloadButton url={getDownloadNoticeUrl(y.id, encodeURIComponent(h.personId))} fallbackName={`notice-${y.calendarYear}.pdf`} variant="quiet" className="px-2 py-1 text-xs" testId={`button-download-notice-${h.personId}`}>Notice</DownloadButton>
                  <DownloadButton url={getDownloadStatementUrl(y.id, encodeURIComponent(h.personId))} fallbackName={`statement-${y.calendarYear}.pdf`} variant="quiet" className="px-2 py-1 text-xs" testId={`button-download-statement-${h.personId}`}>Statement</DownloadButton>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
