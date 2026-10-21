import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePreviewRateCsv, useConfirmRateCsv } from "@workspace/api-client-react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Btn, Field, inputCls } from "@/components/bits";
import { errMessage } from "@/lib/format";

export function RatesCsvImport({ initialYear, onDone }: { initialYear?: number; onDone: () => void }) {
  const [year, setYear] = useState(String(initialYear ?? new Date().getFullYear()));
  const [file, setFile] = useState<{ filename: string; csv: string } | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const qc = useQueryClient();
  const preview = usePreviewRateCsv();
  const confirm = useConfirmRateCsv({ mutation: { onSuccess: () => { void qc.invalidateQueries(); } } });
  const reset = () => { preview.reset(); confirm.reset(); setError(""); };
  const taxYear = Number(year);
  const busy = reading || preview.isPending || confirm.isPending;
  const valid = Number.isInteger(taxYear) && taxYear >= 1900 && taxYear <= 9999 && file !== null;
  const rows = confirm.data?.rows ?? preview.data?.rows;
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Import CSV rates</DialogTitle>
        <DialogDescription>
          Preview first, then confirm. Only new or changed rates or source notes are recorded. Codes absent from your file stay as they are.
        </DialogDescription>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">
        Header: <code>code,rate,source_note</code>. Codes: FEDERAL, a US state/territory, or NONE.
        Use decimal fractions (0.0499) or percentages (4.99%). Rates are stored to four decimal places. Maximum 64 KB.
      </p>
      <Field label="Tax year">
        <input className={inputCls} type="number" min="1900" max="9999" value={year} disabled={busy || confirm.isSuccess}
          data-testid="input-csv-year" onChange={(e) => { setYear(e.target.value); reset(); }} />
      </Field>
      <Field label="CSV file">
        <input className={`${inputCls} text-sm`} type="file" accept=".csv,text/csv" disabled={busy || confirm.isSuccess}
          data-testid="input-rates-csv" onChange={async (e) => {
            reset(); setFile(null);
            const selected = e.target.files?.[0];
            if (!selected) return;
            if (selected.size > 65536) { setError("CSV file exceeds the 64 KB limit"); return; }
            setReading(true);
            try { setFile({ filename: selected.name, csv: await selected.text() }); }
            catch { setError("Could not read that CSV file"); }
            finally { setReading(false); }
          }} />
      </Field>
      {(error || preview.error || confirm.error) && <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">{error || errMessage(preview.error ?? confirm.error)}</p>}
      {(busy || confirm.isSuccess) && <p className="text-xs text-muted-foreground">Year and file selection are locked during import. When finished, close this dialog to start another import.</p>}
      {!confirm.isSuccess && <Btn variant="ghost" disabled={!valid || busy} disabledReason={busy ? "Reading or importing the CSV; please wait." : "Choose a CSV file up to 64 KB and a tax year from 1900 to 9999."} data-testid="button-preview-rates-csv"
        onClick={() => { if (file) { confirm.reset(); preview.mutate({ data: { taxYear, ...file } }); } }}>
        {preview.isPending ? "Checking CSV…" : "Preview CSV"}
      </Btn>}
      {rows && <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm" data-testid="table-rates-csv-preview">
          <thead><tr className="border-b border-border text-left"><th className="p-2">Code</th><th className="p-2">Will set</th><th className="p-2">Current</th><th className="p-2">Source note</th><th className="p-2">Result</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.code} className="border-b border-border last:border-0">
            <td className="p-2">{r.code}</td><td className="num p-2">{r.rate}</td><td className="num p-2">{r.currentRate ?? "new"}</td>
            <td className="whitespace-pre-wrap p-2">{r.sourceNote}</td><td className="p-2">{r.status === "unchanged" ? "Unchanged — skipped" : r.status === "new" ? "New" : "Changed"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {confirm.data ? <p role="status" className="text-sm" data-testid="status-rates-csv-result">
        {confirm.data.changedCount} revisions saved; {confirm.data.unchangedCount} unchanged rows skipped.
        {confirm.data.changedCount === 0 && " Nothing was written."}
      </p> : preview.data && <p className="text-sm">{preview.data.changedCount} new or changed; {preview.data.unchangedCount} unchanged. No changes have been saved yet.</p>}
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" disabled={busy} onClick={onDone}>{confirm.isSuccess ? "Done" : "Cancel"}</Btn>
        {preview.data && !confirm.isSuccess && <Btn disabled={busy} data-testid="button-confirm-rates-csv"
          onClick={() => { if (file && preview.data) confirm.mutate({ data: { taxYear, ...file, previewToken: preview.data.previewToken } }); }}>
          {confirm.isPending ? "Saving…" : `Confirm import (${preview.data.changedCount} changes)`}
        </Btn>}
      </div>
    </div>
  );
}
