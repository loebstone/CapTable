import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useResetPracticeYear, type YearDetail } from "@workspace/api-client-react";
import { Btn, Field, inputCls } from "@/components/bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { errMessage } from "@/lib/format";

export function PracticeReset({ y }: { y: YearDetail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const reset = useResetPracticeYear({ mutation: { onSuccess: () => {
    void qc.invalidateQueries();
    setWord(""); setOpen(false);
  } } });
  return <>
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
      <span>Start this practice year over, keeping its snapshot and audit history.</span>
      <Btn variant="ghost" onClick={() => { setWord(""); reset.reset(); setOpen(true); }} data-testid="button-reset-practice">Reset practice year</Btn>
    </div>
    <Dialog open={open} onOpenChange={(value) => !reset.isPending && setOpen(value)}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Reset {y.calendarYear} — Practice?</DialogTitle>
          <DialogDescription>This permanently deletes this practice year's figures, cost lines, documents and stored files, declaration, finalization, corrections, ledger entries and holds. Its snapshot, year identity and audit history remain. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (word === "RESET" && !reset.isPending) reset.mutate({ id: y.id, data: { confirmation: "RESET" } }); }}>
          <Field label="Type RESET to confirm"><input className={inputCls} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" data-testid="input-reset-confirmation" /></Field>
          {reset.isError && <p role="alert" className="text-sm text-destructive">{errMessage(reset.error)}</p>}
          <div className="flex justify-end gap-2"><Btn type="button" variant="quiet" disabled={reset.isPending} onClick={() => setOpen(false)}>Cancel</Btn><Btn type="submit" disabled={word !== "RESET" || reset.isPending} disabledReason={reset.isPending ? "Resetting this practice year; please wait." : "Type RESET to confirm this permanent reset."} data-testid="button-confirm-reset">{reset.isPending ? "Resetting…" : "Reset practice year"}</Btn></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
