import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDirections, useIssueDirectionLink, useRemindDirections, useConfirmDirection, useRecordPaperDirection,
  useRequestYearUpload, useAttachYearDocument, useResendDirectionEnvelope,
  getGetDirectionsQueryKey, getGetMailingQueryKey, getGetYearQueryKey, getListAuditQueryKey,
  type DirectionView, type DirectionStatusRow, type DocumentUploadInputContentType,
} from "@workspace/api-client-react";
import { Send, RotateCw, BellRing, CheckCircle2, FileText, PenLine, Printer } from "lucide-react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Btn, Field, inputCls, Tag } from "@/components/bits";
import { fmtDate, errMessage } from "@/lib/format";
import { fmtCents, parseDollars, centsToInput, todayISO } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useDirectionsInval(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetDirectionsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetYearQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetMailingQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
}

export function useDirections(id: number) {
  return useGetDirections(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetDirectionsQueryKey(id) } });
}

/** Backward compatibility: the separate list now lives in the year's Holders table. */
export default function DirectionsRedirect() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  useEffect(() => { navigate(`/years/${params.id}#holders`, { replace: true }); }, [params.id, navigate]);
  return null;
}

/** Table-level controls placed above the Holders table. */
export function DirectionsToolbar({ id, v }: { id: number; v: DirectionView }) {
  const inval = useDirectionsInval(id);
  const { toast } = useToast();
  const remind = useRemindDirections({ mutation: {
    onSuccess: (r) => { inval(); toast({ title: `${r.sentCount ?? 0} reminder${r.sentCount === 1 ? "" : "s"} accepted by provider`,
      description: `${r.count} attempted · ${r.failedCount ?? 0} failed · ${r.unknownCount ?? 0} uncertain`,
      ...((r.failedCount ?? 0) + (r.unknownCount ?? 0) > 0 ? { variant: "destructive" as const } : {}) }); },
    onError: (e) => { inval(); toast({ title: "Reminders failed", description: errMessage(e), variant: "destructive" }); } } });
  const remindable = v.rows.filter((r) => r.canRemind).length;
  const reason = v.isPractice ? "Practice year: reminders are disabled." : remind.isPending ? "Sending; please wait." : remindable === 0 ? "No unsigned email holders need a reminder." : null;
  const hasPaper = v.rows.some((r) => r.channel !== "Email");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3" data-testid="toolbar-directions">
      <div className="text-sm"><span className="font-medium">Tax &amp; Reinvestment</span> <span className="text-muted-foreground">· direction to retain as additional paid-in capital</span></div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Btn variant="ghost" className="py-1 text-xs" disabled={!!reason} disabledReason={reason ?? undefined}
          onClick={() => { if (window.confirm(`Send a reminder to ${remindable} unsigned holder${remindable === 1 ? "" : "s"}?`)) remind.mutate({ id }); }} data-testid="button-remind"><BellRing className="h-3.5 w-3.5" /> Remind unsigned ({remindable})</Btn>
        {hasPaper
          ? <a href={`${BASE}/api/years/${id}/directions/paper.pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1 text-xs font-medium hover:bg-secondary" data-testid="link-print-paper-directions"><Printer className="h-3.5 w-3.5" /> Print paper directions</a>
          : <span className="text-xs text-muted-foreground" data-testid="text-print-paper-disabled">Print paper directions: no paper holders.</span>}
      </div>
      {reason && !remind.isPending && <p className="basis-full text-xs text-muted-foreground" role="note" data-testid="text-remind-disabled-reason">Remind unsigned: {reason}</p>}
    </div>
  );
}

export function DirectionChannelCell({ r }: { r?: DirectionStatusRow }) {
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  return <div data-testid={`text-channel-${r.personId}`}><Tag tone={r.channel === "Email" ? "lichen" : "plain"}>{r.channel}</Tag>{r.email && <div className="num mt-1 max-w-48 truncate text-xs" title={r.email}>{r.email}</div>}</div>;
}

export function DirectionMailingCell({ r }: { r?: DirectionStatusRow }) {
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  return <div className={cn("max-w-48 whitespace-normal text-xs", /bounce|fail/i.test(r.mailingStatus) && "text-destructive")} data-testid={`text-mailing-${r.personId}`}>{r.mailingStatus}</div>;
}

export function DirectionDocumentCell({ r }: { r?: DirectionStatusRow }) {
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="max-w-56 whitespace-normal text-xs" data-testid={`text-document-${r.personId}`}>
      <div>{r.documentStatus}</div>
      {r.amountCents && <div className="num">{fmtCents(r.amountCents)}</div>}
      {r.expiresAt && <div className="text-muted-foreground">Link expires {fmtDate(r.expiresAt, true)}</div>}
      {r.pdfUrl && <a href={`${BASE}${r.pdfUrl}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" data-testid={`link-direction-pdf-${r.personId}`}><FileText className="h-3.5 w-3.5" /> Download</a>}
      {(r.history?.length ?? 0) > 1 && <details className="mt-1"><summary className="cursor-pointer text-primary" data-testid={`toggle-direction-history-${r.personId}`}>History</summary>
        <ul className="mt-1 space-y-1">{r.history?.map((d) => <li key={d.id}>#{d.id} · {fmtCents(d.amountCents)} · {d.kind} · {d.confirmed ? "confirmed" : "not confirmed"}{d.pdfUrl && <> · <a className="underline" href={`${BASE}${d.pdfUrl}`} target="_blank" rel="noreferrer">Download</a></>}</li>)}</ul>
      </details>}
    </div>
  );
}

export function DirectionActionsCell({ id, r, isPractice, onPaper }: { id: number; r?: DirectionStatusRow; isPractice: boolean; onPaper: (r: DirectionStatusRow) => void }) {
  const inval = useDirectionsInval(id);
  const { toast } = useToast();
  const issue = useIssueDirectionLink({ mutation: {
    onSuccess: (x) => { inval(); toast({ title: x.result === "sent" ? (isPractice ? "Preview accepted by provider" : "Signing link accepted by provider") : "Link email not confirmed",
      description: `${x.result} · expires ${fmtDate(x.expiresAt, true)}${x.result === "unknown" ? " · check the provider before retrying" : ""}`,
      ...(x.result !== "sent" ? { variant: "destructive" as const } : {}) }); },
    onError: (e) => { inval(); toast({ title: "Could not send link", description: errMessage(e), variant: "destructive" }); } } });
  const resend = useResendDirectionEnvelope({ mutation: {
    onSuccess: (x) => {
      inval();
      const bad = x.results.filter((y) => y.result !== "sent");
      toast({
        title: bad.length ? "Resend failed or uncertain" : isPractice ? "Preview accepted by provider" : "Resend accepted by provider",
        description: x.results.map((y) => `${y.result}${y.messageId ? ` · ID ${y.messageId}` : ""}${y.detail ? ` · ${y.detail}` : ""}`).join("; ") || "No message was sent.",
        ...(bad.length || x.results.length === 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (e) => { inval(); toast({ title: "Resend failed", description: errMessage(e), variant: "destructive" }); } } });
  if (!r) return <span className="text-xs text-muted-foreground">Directions unavailable.</span>;
  const busy = issue.isPending || resend.isPending;
  const resendReason = resend.isPending ? "Sending; please wait." : !r.canResendEnvelope ? r.resendBlocked ?? "Resend is not available for this holder." : null;
  const issueReason = issue.isPending ? "Sending; please wait." : !r.canIssue ? "A link cannot be issued for this holder." : null;
  return (
    <div className="flex w-40 flex-col sm:w-56 items-start gap-1 whitespace-normal text-xs" data-testid={`cell-direction-actions-${r.personId}`}>
      <div className="flex items-center gap-2">
        <Btn variant="quiet" className="px-2 py-1 text-xs" disabled={!!resendReason || busy} disabledReason={resendReason ?? "Sending; please wait."}
          onClick={() => { if (window.confirm(isPractice
            ? `Practice: send a copy of ${r.displayName}'s complete original mailing (message and shared attachments), a regenerated notice, and a fresh signing link ONLY to you, the signed-in person. Nothing is sent to the holder. Any unused link is replaced.`
            : `Resend ${r.displayName}'s complete original mailing (same message and shared attachments) with a regenerated notice and a fresh signing link? The fresh link replaces any unused link.`)) resend.mutate({ id, data: { personId: r.personId } }); }}
          data-testid={`button-resend-${r.personId}`}><RotateCw className="h-3.5 w-3.5" /> Resend</Btn>
        <span className="num text-[11px] text-muted-foreground" data-testid={`text-resend-count-${r.personId}`}>Resends: {r.resendCount ?? 0}</span>
      </div>
      {resendReason && !resend.isPending && <p className="text-muted-foreground" role="note" data-testid={`text-resend-blocked-${r.personId}`}>Resend: {resendReason}</p>}
      <Btn variant="quiet" className="px-2 py-1 text-xs" disabled={!!issueReason || busy} disabledReason={issueReason ?? "Sending; please wait."}
        onClick={() => { if (window.confirm(isPractice ? `Re-issue a preview of ${r.displayName}'s signing link to yourself?` : `Re-issue a signing link to ${r.displayName}?`)) issue.mutate({ id, data: { personId: r.personId } }); }} data-testid={`button-issue-${r.personId}`}><Send className="h-3.5 w-3.5" /> {isPractice ? "Re-issue preview link" : "Re-issue link"}</Btn>
      {issueReason && !issue.isPending && <p className="text-muted-foreground" role="note" data-testid={`text-issue-blocked-${r.personId}`}>Re-issue: {issueReason}</p>}
      <Btn variant="quiet" className="px-2 py-1 text-xs" onClick={() => onPaper(r)} data-testid={`button-paper-${r.personId}`}><PenLine className="h-3.5 w-3.5" /> Record paper direction</Btn>
      {r.directionId && (r.canConfirm || r.confirmationBlocked) && <ConfirmBtn yearId={id} row={r} />}
    </div>
  );
}

function ConfirmBtn({ yearId, row }: { yearId: number; row: DirectionStatusRow }) {
  const inval = useDirectionsInval(yearId);
  const [note, setNote] = useState(""), [noteOpen, setNoteOpen] = useState(false);
  const { toast } = useToast();
  const m = useConfirmDirection({ mutation: { onSuccess: () => { inval(); setNote(""); setNoteOpen(false); toast({ title: "Direction confirmed" }); }, onError: (e) => toast({ title: "Confirm failed", description: errMessage(e), variant: "destructive" }) } });
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Btn variant="ghost" className="px-2 py-1 text-xs" disabled={!row.canConfirm || !!row.confirmationBlocked || m.isPending}
          disabledReason={row.confirmationBlocked ?? (m.isPending ? "Confirming; please wait." : "Nothing to confirm.")}
          onClick={() => { if (row.directionId) m.mutate({ id: yearId, directionId: row.directionId, data: note.trim() ? { note: note.trim() } : {} }); }}
          data-testid={`button-confirm-direction-${row.personId}`}><CheckCircle2 className="h-3.5 w-3.5" /> Confirm</Btn>
        {row.canConfirm && !row.confirmationBlocked && <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setNoteOpen(!noteOpen)} data-testid={`button-confirm-note-${row.personId}`}>Optional note</button>}
      </div>
      {row.confirmationBlocked && <p className="text-muted-foreground" role="note" data-testid={`text-confirm-blocked-${row.personId}`}>Confirm: {row.confirmationBlocked}</p>}
      {noteOpen && <label className="block">Note (optional)<textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-confirm-note-${row.personId}`} /></label>}
    </div>
  );
}

const TYPES: DocumentUploadInputContentType[] = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];

export function PaperDirectionForm({ id, row, onDone }: { id: number; row: DirectionStatusRow; onDone: () => void }) {
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
