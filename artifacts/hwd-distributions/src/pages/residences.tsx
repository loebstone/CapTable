import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListResidences, useSaveResidence, type Residence } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, Tag, inputCls } from "@/components/bits";
import { fmtDate, errMessage, STATE_RE } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { ResidenceConfirmAll } from "@/components/residence-confirm-all";
import { invalidateResidenceViews } from "@/lib/residence-cache";

export default function ResidencesPage() {
  const q = useListResidences();
  const qc = useQueryClient();
  const { toast } = useToast();
  const quick = useSaveResidence({ mutation: { onError: () => invalidateResidenceViews(qc), onSuccess: (r) => {
    invalidateResidenceViews(qc);
    toast({ title: "Residence confirmed", description: r.displayName });
  } } });
  const [editing, setEditing] = useState<Residence | null>(null);
  const list = [...(q.data ?? [])].sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.displayName.localeCompare(b.displayName));
  const open = list.filter((r) => !r.confirmed).length;

  return (
    <div className="space-y-8">
      <PageHeader kicker="Tax residence" title="Where each shareholder files">
        Confirm or correct each shareholder's state of tax residence. A missing state stays missing until someone records it. NONE means no state income tax applies.
      </PageHeader>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title="No shareholders on record.">Residence rows appear once shareholders exist in the register.</Empty>
      ) : (
        <>
          <ResidenceConfirmAll rows={list} busy={quick.isPending} />
          {quick.isError && <p role="alert" className="text-sm text-destructive">{errMessage(quick.error)}</p>}
          <div className="text-xs text-muted-foreground" data-testid="text-unconfirmed-count">{open === 0 ? "All residences confirmed." : `${open} of ${list.length} not yet confirmed.`}</div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Shareholder</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Confirmed</th>
                  <th className="px-3 py-2.5 font-medium">Note</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((r) => (
                  <tr key={r.personId} className="transition-colors hover:bg-secondary/50" data-testid={`row-residence-${r.personId}`}>
                    <td className="px-4 py-2.5 font-medium">{r.displayName}</td>
                    <td className="num px-3 py-2.5">{r.stateCode ?? <span className="text-muted-foreground">missing</span>}</td>
                    <td className="px-3 py-2.5">{r.confirmed ? <Tag tone="lichen">Confirmed</Tag> : <Tag tone="amber">Unconfirmed</Tag>}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.confirmedBy ? `${r.confirmedBy}, ${fmtDate(r.confirmedAt)}` : "—"}</td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">{r.note}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {!r.confirmed && r.stateCode && <Btn className="mr-2 py-1 text-xs" disabled={quick.isPending} onClick={() => quick.mutate({ data: { personId: r.personId, expectedRevisionId: r.id, stateCode: r.stateCode!, confirmed: true, note: r.note } })} data-testid={`button-confirm-residence-${r.personId}`}>{quick.isPending && quick.variables?.data.personId === r.personId ? "Confirming…" : "Confirm"}</Btn>}
                      <Btn variant="ghost" className="py-1 text-xs" onClick={() => setEditing(r)} data-testid={`button-edit-residence-${r.personId}`}>{r.confirmed ? "Correct" : "Review"}</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-card">
          {editing && <ResidenceForm key={editing.personId} r={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResidenceForm({ r, onDone }: { r: Residence; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [state, setState] = useState(r.stateCode ?? "");
  const [confirmed, setConfirmed] = useState(true);
  const [note, setNote] = useState(r.note);
  const save = useSaveResidence({
    mutation: {
      onError: () => invalidateResidenceViews(qc),
      onSuccess: () => {
        invalidateResidenceViews(qc);
        toast({ title: "Residence saved", description: r.displayName });
        onDone();
      },
    },
  });
  const code = state.trim().toUpperCase();
  const stateErr = code && !STATE_RE.test(code) ? "Two-letter state code, or NONE." : null;
  const valid = STATE_RE.test(code);

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate({ data: { personId: r.personId, expectedRevisionId: r.id, stateCode: code, confirmed, note: note.trim() } }); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">{r.displayName}</DialogTitle>
        <DialogDescription>Currently {r.stateCode ?? "missing"}{r.confirmed ? ", confirmed" : ", not confirmed"}.</DialogDescription>
      </DialogHeader>
      <Field label="State of tax residence" hint="e.g. OR, WA. Use NONE when no state income tax applies." error={stateErr}>
        <input className={inputCls + " num uppercase"} maxLength={4} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="—" data-testid="input-state-code" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-confirmed" />
        I have confirmed this with the shareholder
      </label>
      <Field label="Note (optional)">
        <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-residence-note" />
      </Field>
      {save.isError && <div className="text-xs text-destructive">{errMessage(save.error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" disabled={!valid || save.isPending} disabledReason={save.isPending ? "Saving this residence; please wait." : "Choose a valid state code or NONE before confirming."} data-testid="button-save-residence">{save.isPending ? "Saving…" : "Save"}</Btn>
      </div>
    </form>
  );
}
