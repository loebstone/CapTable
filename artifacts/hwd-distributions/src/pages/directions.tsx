import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDirections, useIssueDirectionLink, useRemindDirections, useConfirmDirection, useRecordPaperDirection,
  useRequestYearUpload, useAttachYearDocument, useResendDirectionEnvelope,
  getGetDirectionsQueryKey, getGetMailingQueryKey, getGetYearQueryKey, getListAuditQueryKey,
  type DirectionView, type DirectionStatusRow, type DocumentUploadInputContentType,
} from "@workspace/api-client-react";
import { ArrowLeft, Send, RotateCw, BellRing, CheckCircle2, FileText, PenLine } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, inputCls, Tag } from "@/components/bits";
import { fmtDate, errMessage } from "@/lib/format";
import { fmtCents, parseDollars, centsToInput, todayISO } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useDirectionsInval(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetDirectionsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetYearQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
}

export function useDirections(id: number) {
  return useGetDirections(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetDirectionsQueryKey(id) } });
}

/** Instruction-cell addendum on the year grid: shows signed-awaiting-confirmation and Confirm. */
export function DirectionConfirmCell({ yearId, personId }: { yearId: number; personId: string }) {
  const q = useDirections(yearId);
  const row = q.data?.rows.find((r) => r.personId === personId);
  if (!row?.directionId || !(row.canConfirm || row.confirmationBlocked)) return null;
  return <div className="mt-1 space-y-1"><div className="text-[11px] text-[hsl(30_60%_32%)]" data-testid={`text-direction-awaiting-${personId}`}>{row.documentStatus}</div><ConfirmBtn yearId={yearId} row={row} /></div>;
}

function ConfirmBtn({ yearId, row }: { yearId: number; row: DirectionStatusRow }) {
  const inval = useDirectionsInval(yearId);
  const [note, setNote] = useState(""), [noteOpen, setNoteOpen] = useState(false);
  const { toast } = useToast();
  const m = useConfirmDirection({ mutation: { onSuccess: () => { inval(); toast({ title: "Direction confirmed" }); }, onError: (e) => toast({ title: "Confirm failed", description: errMessage(e), variant: "destructive" }) } });
  return (
    <div className="space-y-1">
    <Btn variant="ghost" className="px-2 py-1 text-xs" disabled={!row.canConfirm || !!row.confirmationBlocked || m.isPending}
      disabledReason={row.confirmationBlocked ?? (m.isPending ? "Confirming; please wait." : "Nothing to confirm.")}
      onClick={() => { if (row.directionId) m.mutate({ id: yearId, directionId: row.directionId, data: note.trim() ? { note: note.trim() } : {} }); }}
      data-testid={`button-confirm-direction-${row.personId}`}><CheckCircle2 className="h-3.5 w-3.5" /> Confirm</Btn>
    {row.confirmationBlocked && <p className="max-w-44 whitespace-normal text-xs text-muted-foreground" role="note" data-testid={`text-confirm-blocked-${row.personId}`}>{row.confirmationBlocked}</p>}
    {row.canConfirm && <button type="button" className="ml-2 text-[11px] text-muted-foreground underline" onClick={() => setNoteOpen(!noteOpen)}>Optional note</button>}
    {noteOpen && <label className="block text-xs">Note (optional)<textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
    </div>
  );
}

export default function DirectionsPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const q = useDirections(id);
  if (!Number.isInteger(id) || id <= 0) return <Empty title="No such year." action={<Link href="/years" className="text-sm text-primary">Back to years</Link>} />;
  if (q.isLoading) return <div className="space-y-6"><div className="h-20 animate-pulse rounded-lg bg-muted" /><SkeletonRows rows={8} /></div>;
  if (q.isError || !q.data) return <ErrorPanel error={q.error} onRetry={() => q.refetch()} />;
  return <Directions id={id} v={q.data} />;
}

function Directions({ id, v }: { id: number; v: DirectionView }) {
  const qc = useQueryClient();
  const inval = useDirectionsInval(id);
  const { toast } = useToast();
  const [paperFor, setPaperFor] = useState<DirectionStatusRow | null>(null);
  const issue = useIssueDirectionLink({ mutation: {
    onSuccess: (r) => { inval(); toast({ title: r.result === "sent" ? (v.isPractice ? "Preview accepted by Resend" : "Signing link accepted by Resend") : "Link email not confirmed",
      description: `${r.result} · expires ${fmtDate(r.expiresAt, true)}${r.result === "unknown" ? " · check Resend before retrying" : ""}`,
      ...(r.result !== "sent" ? { variant: "destructive" as const } : {}) }); },
    onError: (e) => toast({ title: "Could not send link", description: errMessage(e), variant: "destructive" }) } });
  const remind = useRemindDirections({ mutation: {
    onSuccess: (r) => { inval(); toast({ title: `${r.sentCount ?? 0} reminder${r.sentCount === 1 ? "" : "s"} accepted by Resend`,
      description: `${r.count} attempted · ${r.failedCount ?? 0} failed · ${r.unknownCount ?? 0} uncertain` }); },
    onError: (e) => toast({ title: "Reminders failed", description: errMessage(e), variant: "destructive" }) } });
  const resend = useResendDirectionEnvelope({ mutation: {
    onSuccess: (r) => {
      inval(); qc.invalidateQueries({ queryKey: getGetMailingQueryKey(id) });
      const bad = r.results.filter((x) => x.result !== "sent");
      toast({
        title: bad.length ? "Resend failed or uncertain" : v.isPractice ? "Preview accepted by provider" : "Resend accepted by provider",
        description: r.results.map((x) => `${x.result}${x.messageId ? ` · ID ${x.messageId}` : ""}${x.detail ? ` · ${x.detail}` : ""}`).join("; ") || "No message was sent.",
        ...(bad.length || r.results.length === 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (e) => { inval(); qc.invalidateQueries({ queryKey: getGetMailingQueryKey(id) }); toast({ title: "Resend failed", description: errMessage(e), variant: "destructive" }); } } });
  const remindable = v.rows.filter((r) => r.canRemind).length;

  return (
    <div className="space-y-8">
      <Link href={`/years/${id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary" data-testid="link-back-year"><ArrowLeft className="h-3.5 w-3.5" /> Back to year</Link>
      {v.isPractice && <div role="note" className="sticky top-0 z-20 rounded-md border border-amber-600 bg-amber-100 px-4 py-3 font-medium text-amber-950" data-testid="banner-practice-directions">Practice year — nothing here is a real distribution<span className="mt-1 block text-sm font-normal">Signing links go only to you as a preview.</span></div>}
      <PageHeader kicker={String(v.calendarYear)} title="Tax & Reinvestment Document" actions={
        <Btn variant="ghost" disabled={v.isPractice || remindable === 0 || remind.isPending}
          disabledReason={v.isPractice ? "Practice year: reminders are disabled." : remind.isPending ? "Sending; please wait." : "No holders need a reminder."}
          onClick={() => { if (window.confirm(`Send a reminder to ${remindable} holder${remindable === 1 ? "" : "s"}?`)) remind.mutate({ id }); }} data-testid="button-remind"><BellRing className="h-4 w-4" /> Remind {remindable}</Btn>
      } />
      <p className="text-sm text-muted-foreground">Direction to retain as additional paid-in capital</p>
      {v.rows.some((r) => r.channel === "Paper") && <a href={`${BASE}/api/years/${id}/directions/paper.pdf`} className="inline-flex items-center gap-2 text-sm text-primary underline" data-testid="link-print-paper-directions">Print paper directions</a>}
      {v.rows.length === 0 ? <Empty title="No holders for this year." /> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[900px] text-sm" data-testid="table-directions">
            <thead className="bg-secondary/50 text-[11px] tracking-wider text-muted-foreground">
              <tr className="text-left"><th className="px-3 py-2 font-medium">Holder</th><th className="px-2 py-2 font-medium">Email or Paper</th><th className="px-2 py-2 font-medium">Mailing sent/delivered/bounced</th><th className="px-2 py-2 font-medium">Document</th><th className="px-2 py-2 font-medium">Pay instruction</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {v.rows.map((r) => (
                <tr key={r.personId} className="align-top hover:bg-secondary/30" data-testid={`row-direction-${r.personId}`}>
                  <td className="px-3 py-2"><div className="font-medium">{r.displayName}</div>{r.maxAmountCents && <div className="num text-[11px] text-muted-foreground">up to {fmtCents(r.maxAmountCents)}</div>}</td>
                  <td className="px-2 py-2"><Tag tone={r.channel === "Email" ? "lichen" : "plain"}>{r.channel}</Tag>{r.email && <div className="num mt-1 text-xs">{r.email}</div>}</td>
                  <td className={`px-2 py-2 text-xs ${/bounce|fail/i.test(r.mailingStatus) ? "text-destructive" : ""}`} data-testid={`text-mailing-${r.personId}`}>{r.mailingStatus}</td>
                  <td className="px-2 py-2 text-xs" data-testid={`text-document-${r.personId}`}>
                    <div>{r.documentStatus}</div>
                    {r.amountCents && <div className="num">{fmtCents(r.amountCents)}</div>}
                    {r.expiresAt && <div className="text-muted-foreground">Link expires {fmtDate(r.expiresAt, true)}</div>}
                    {!r.canResendEnvelope && r.resendBlocked && <div className="text-muted-foreground" role="note" data-testid={`text-resend-blocked-${r.personId}`}>Resend: {r.resendBlocked}</div>}
                    {r.pdfUrl && <a href={`${BASE}${r.pdfUrl}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" data-testid={`link-direction-pdf-${r.personId}`}><FileText className="h-3.5 w-3.5" /> Document</a>}
                    {(r.history?.length ?? 0) > 1 && <details className="mt-2"><summary className="cursor-pointer text-primary">Direction history</summary>
                      <ul className="mt-1 space-y-1">{r.history?.map((d) => <li key={d.id}>#{d.id} · {fmtCents(d.amountCents)} · {d.kind} · {d.confirmed ? "confirmed" : "not confirmed"}{d.pdfUrl && <> · <a className="underline" href={`${BASE}${d.pdfUrl}`} target="_blank" rel="noreferrer">Document</a></>}</li>)}</ul>
                    </details>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Btn variant="quiet" className="px-2 py-1 text-xs" disabled={!r.canIssue || issue.isPending} disabledReason={issue.isPending ? "Sending; please wait." : "A link cannot be issued for this holder."}
                        onClick={() => { if (window.confirm(v.isPractice ? `Re-issue a preview of ${r.displayName}'s signing link to yourself?` : `Re-issue a signing link to ${r.displayName}?`)) issue.mutate({ id, data: { personId: r.personId } }); }} data-testid={`button-issue-${r.personId}`}><Send className="h-3.5 w-3.5" /> {v.isPractice ? "Re-issue preview link" : "Re-issue link"}</Btn>
                      <Btn variant="quiet" className="px-2 py-1 text-xs" disabled={!r.canResendEnvelope || resend.isPending}
                        disabledReason={resend.isPending ? "Sending; please wait." : r.resendBlocked ?? "Resend is not available for this holder."}
                        onClick={() => { if (window.confirm(v.isPractice
                          ? `Practice: send a copy of ${r.displayName}'s complete original mailing (message and shared attachments), a regenerated notice, and a fresh signing link ONLY to you, the signed-in person. Nothing is sent to the holder. Any unused link is replaced.`
                          : `Resend ${r.displayName}'s complete original mailing (same message and shared attachments) with a regenerated notice and a fresh signing link? The fresh link replaces any unused link.`)) resend.mutate({ id, data: { personId: r.personId } }); }}
                        data-testid={`button-resend-${r.personId}`}><RotateCw className="h-3.5 w-3.5" /> Resend</Btn>
                      <span className="num self-center text-[11px] text-muted-foreground" data-testid={`text-resend-count-${r.personId}`}>Resends: {r.resendCount ?? 0}</span>
                      <Btn variant="quiet" className="px-2 py-1 text-xs" onClick={() => setPaperFor(r)} data-testid={`button-paper-${r.personId}`}><PenLine className="h-3.5 w-3.5" /> Record paper</Btn>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs" data-testid={`text-instruction-${r.personId}`}>
                    <div className="font-medium">{r.instruction}</div>
                    {r.confirmationBlocked && !r.directionId && <div className="text-muted-foreground">{r.confirmationBlocked}</div>}
                    {r.directionId && (r.canConfirm || r.confirmationBlocked) && <div className="mt-1"><ConfirmBtn yearId={id} row={r} /></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!paperFor} onOpenChange={(o) => !o && setPaperFor(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-lg">
          {paperFor && <PaperForm id={id} row={paperFor} onDone={() => setPaperFor(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TYPES: DocumentUploadInputContentType[] = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];

function PaperForm({ id, row, onDone }: { id: number; row: DirectionStatusRow; onDone: () => void }) {
  const inval = useDirectionsInval(id);
  const { toast } = useToast();
  const [amount, setAmount] = useState(centsToInput(row.amountCents ?? row.maxAmountCents));
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const request = useRequestYearUpload();
  const attach = useAttachYearDocument();
  const rec = useRecordPaperDirection();
  const cents = parseDollars(amount);
  const max = row.maxAmountCents;
  const amountOk = cents !== null && (!max || BigInt(cents) <= BigInt(max));
  const valid = amountOk && /^\d{4}-\d{2}-\d{2}$/.test(date) && !busy;

  async function submit() {
    if (!cents) return;
    setErr(null);
    try {
      let documentId: number | undefined;
      if (file) {
        const type = file.type as DocumentUploadInputContentType;
        if (!TYPES.includes(type)) throw new Error("Scan must be PDF or image.");
        if (file.size < 1 || file.size > 20971520) throw new Error("Scan must be under 20 MB.");
        setBusy("Uploading scan…");
        const slot = await request.mutateAsync({ id, data: { filename: file.name.slice(0, 200), contentType: type, size: file.size } });
        const put = await fetch(slot.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": type } });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
        setBusy("Sealing scan…");
        const doc = await attach.mutateAsync({ id, data: { uploadId: slot.uploadId } });
        documentId = doc.id;
      }
      setBusy("Recording…");
      await rec.mutateAsync({ id, data: { personId: row.personId, amountCents: cents, receivedDate: date, ...(documentId ? { documentId } : {}), ...(note.trim() ? { note: note.trim() } : {}) } });
      inval();
      toast({ title: "Paper direction recorded", description: row.displayName });
      onDone();
    } catch (e) { setErr(errMessage(e)); inval(); } finally { setBusy(null); }
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">Record paper direction</DialogTitle>
        <DialogDescription>{row.displayName} returned a signed paper document.</DialogDescription>
      </DialogHeader>
      <Field label="Amount retained (USD)" hint={max ? `Up to ${fmtCents(max)}` : undefined} error={amountOk ? null : "Enter a valid amount within the distribution."}>
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-paper-amount" />
      </Field>
      <Field label="Received date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-paper-date" /></Field>
      <Field label="Signed scan (optional)" hint="PDF or image, sealed into the year's documents.">
        <input ref={fileRef} type="file" accept={TYPES.join(",")} className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-paper-scan" />
      </Field>
      <Field label="Note (optional)"><textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-paper-note" /></Field>
      {busy && <div className="animate-pulse rounded-md bg-accent/60 px-3 py-2 text-xs text-accent-foreground">{busy}</div>}
      {err && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-paper-error">{err}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" disabled={!valid} disabledReason={busy ?? "Check the amount and date."} data-testid="button-submit-paper">Record</Btn>
      </div>
    </form>
  );
}
