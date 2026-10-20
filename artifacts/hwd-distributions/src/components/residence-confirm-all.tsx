import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirmAllResidences, type Residence, type ResidenceBatchResult } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Btn } from "@/components/bits";
import { invalidateResidenceViews } from "@/lib/residence-cache";
import { errMessage } from "@/lib/format";

export function ResidenceConfirmAll({ rows, busy }: { rows: Residence[]; busy: boolean }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Residence[] | null>(null);
  const [result, setResult] = useState<ResidenceBatchResult | null>(null);
  const mutation = useConfirmAllResidences({ mutation: {
    onSuccess: (data) => { setResult(data); setPreview(null); invalidateResidenceViews(qc); },
    onError: () => invalidateResidenceViews(qc),
  } });
  const eligible = rows.filter((r) => !r.confirmed && r.stateCode !== null);
  const counts = new Map<string, number>();
  for (const row of preview ?? []) counts.set(row.stateCode!, (counts.get(row.stateCode!) ?? 0) + 1);
  const summary = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([state, count]) => `${state} ${count}`).join(", ");

  return <div className="space-y-3">
    <Btn disabled={!eligible.length || busy || mutation.isPending} onClick={() => { mutation.reset(); setPreview(eligible); }} data-testid="button-confirm-all-residences">Confirm all unconfirmed</Btn>
    {result && <div role="status" className="rounded-md border border-border p-4 text-sm" data-testid="result-confirm-all-residences">
      <p>{result.confirmedCount} residences confirmed. {result.skipped.length} skipped because their state is missing.</p>
      {result.skipped.length > 0 && <ul className="mt-2 list-inside list-disc">{result.skipped.map((r) => <li key={r.personId}>{r.displayName} — missing state</li>)}</ul>}
    </div>}
    <Dialog open={preview !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setPreview(null); }}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Confirm {preview?.length ?? 0} residences</DialogTitle>
          <DialogDescription>Confirm {preview?.length ?? 0} residences: {summary}. Rows without a state are skipped and listed afterward. No note is required.</DialogDescription>
        </DialogHeader>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{errMessage(mutation.error)}</p>}
        <div className="flex justify-end gap-2">
          <Btn variant="quiet" disabled={mutation.isPending} onClick={() => setPreview(null)}>Cancel</Btn>
          <Btn disabled={!preview?.length || mutation.isPending} onClick={() => mutation.mutate({ data: { revisionIds: preview!.map((r) => r.id) } })} data-testid="button-confirm-residence-batch">{mutation.isPending ? "Confirming…" : "Confirm residences"}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
