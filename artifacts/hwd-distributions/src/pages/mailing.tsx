import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMailing, useSaveMailing, useSendMailing, useSavePaperPreference, useFetchHoldings,
  useRequestYearUpload, useAttachYearDocument,
  getGetMailingQueryKey, getGetYearQueryKey, getGetHoldingsQueryKey, getListAuditQueryKey,
  type MailingContent, type MailingView, type MailingViewRecipientsItem, type SendMailing200,
} from "@workspace/api-client-react";
import { ArrowLeft, Save, Send, Eye, Printer, RefreshCw, FileUp, FileText, Mail, AlertTriangle, RotateCw } from "lucide-react";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, inputCls, Tag } from "@/components/bits";
import { fmtDate, errMessage } from "@/lib/format";
import { fmtBytes } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Att = "notice" | "statement" | "none";
const ATT_LABEL: Record<Att, string> = { notice: "Notice", statement: "Statement", none: "None" };
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function same(a: MailingContent, b: MailingContent) {
  const norm = (c: MailingContent) => JSON.stringify({ ...c, documentIds: [...c.documentIds].sort((x, y) => x - y), choices: Object.fromEntries(Object.entries(c.choices).sort()) });
  return norm(a) === norm(b);
}

export default function MailingPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const ok = Number.isInteger(id) && id > 0;
  const q = useGetMailing(id, { query: { enabled: ok, queryKey: getGetMailingQueryKey(id) } });
  if (!ok) return <Empty title="No such year." action={<Link href="/years" className="text-sm text-primary">Back to years</Link>} />;
  if (q.isLoading) return <div className="space-y-6"><div className="h-20 animate-pulse rounded-lg bg-muted" /><SkeletonRows rows={8} /></div>;
  if (q.isError || !q.data) return <ErrorPanel error={q.error} onRetry={() => q.refetch()} />;
  return <Mailing id={id} m={q.data} />;
}

function Mailing({ id, m }: { id: number; m: MailingView }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const locked = m.status === "sent";
  const [c, setC] = useState<MailingContent>({ ...m.content, includeSigningLink: m.content.includeSigningLink ?? false });
  const initFor = useRef<string>("");
  const serverKey = `${m.draftId}:${JSON.stringify(m.content)}`;
  useEffect(() => { if (initFor.current !== serverKey) { initFor.current = serverKey; setC({ ...m.content, includeSigningLink: m.content.includeSigningLink ?? false }); } }, [serverKey, m.content]);
  const dirty = !same(c, { ...m.content, includeSigningLink: m.content.includeSigningLink ?? false });
  const saved = m.draftId !== null && !dirty;
  const [results, setResults] = useState<{ kind: string; r: SendMailing200 } | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [previewPid, setPreviewPid] = useState<string>(m.recipients[0]?.personId ?? "");

  const inval = () => {
    qc.invalidateQueries({ queryKey: getGetMailingQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetYearQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
  const save = useSaveMailing({ mutation: { onSuccess: () => { inval(); toast({ title: "Draft saved" }); } } });
  const send = useSendMailing();
  const paper = useSavePaperPreference({ mutation: { onSuccess: inval } });
  const refresh = useFetchHoldings({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetHoldingsQueryKey() }); inval(); toast({ title: "Addresses refreshed" }); } } });

  const emailList = m.recipients.filter((r) => r.channel === "Email");
  const paperList = m.recipients.filter((r) => r.channel !== "Email");
  const unsavedReason = m.draftId === null ? "Save the draft first; sending uses the saved draft." : dirty ? "You have unsaved changes. Save the draft before sending." : null;
  const sendReason = m.isPractice ? "Practice year: real sending is disabled. Use Preview to send a copy to yourself." : locked ? "This mailing has already been sent; the draft is locked." : unsavedReason ?? (emailList.length === 0 ? "No holders will receive email." : null);
  const subjectOk = c.subject.trim().length > 0 && c.body.trim().length > 0;

  function run(kind: "preview" | "send" | "resend", personId?: string) {
    if (m.draftId === null) return;
    setSendErr(null);
    send.mutate({ id, data: { kind, draftId: m.draftId, ...(personId ? { personId } : {}) } }, {
      onSuccess: (r) => {
        setResults({ kind, r }); inval();
        const failed = r.results.filter((result) => result.result !== "sent").length;
        toast({
          title: failed ? "Sending needs attention" : kind === "preview" ? "Preview accepted by Resend" : kind === "resend" ? "Resend accepted" : "Mailing accepted by Resend",
          description: `${r.results.length - failed} accepted${failed ? `; ${failed} failed or uncertain — review the results below` : ""}`,
          ...(failed ? { variant: "destructive" as const } : {}),
        });
      },
      onError: (e) => { setSendErr(errMessage(e)); toast({ title: "Sending failed", description: errMessage(e), variant: "destructive" }); },
    });
  }

  const setChoice = (pid: string, a: Att) => setC((p) => ({ ...p, choices: { ...p.choices, [pid]: a } }));

  return (
    <div className="space-y-8">
      <Link href={`/years/${id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary" data-testid="link-back-year"><ArrowLeft className="h-3.5 w-3.5" /> Back to year</Link>
      {m.isPractice && <div role="note" className="sticky top-0 z-20 rounded-md border border-amber-600 bg-amber-100 px-4 py-3 font-medium text-amber-950" data-testid="banner-practice-mailing">Practice year — nothing here is a real distribution</div>}
      <PageHeader kicker={`${m.calendarYear} · holder mailing`} title="Mailing" actions={<>
        <Btn variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending} disabledReason="Refreshing addresses; please wait." data-testid="button-refresh-addresses"><RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} /> Refresh addresses</Btn>
        <a href={`${BASE}/api/years/${id}/mailing/paper.pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3.5 py-2 text-sm font-medium hover:bg-secondary" data-testid="link-print-letters"><Printer className="h-4 w-4" /> Print letters</a>
      </>}>
        <span className="inline-flex flex-wrap items-center gap-2">
          <Tag tone={locked ? "lichen" : "plain"}>{locked ? "Sent" : "Draft"}</Tag>
          <span data-testid="text-draft-state">{m.draftId === null ? "Not saved yet" : `Draft #${m.draftId}`}{dirty && !locked && " · unsaved changes"}</span>
          <span>Reply-to: <span className="num" data-testid="text-reply-to">{m.replyTo || "not set"}</span></span>
        </span>
      </PageHeader>
      {refresh.isError && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-refresh-error">{errMessage(refresh.error)}</div>}
      {paper.isError && <div role="alert" className="text-sm text-destructive">{errMessage(paper.error)}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="section-compose">
          <h2 className="font-display text-xl">Message</h2>
          {locked && <p className="text-xs text-muted-foreground" role="note">Sent mailings are locked and cannot be edited.</p>}
          <p className="text-xs text-muted-foreground">Write one subject and message for everyone. Personal figures appear only in each holder’s selected PDF attachment.</p>
          <Field label="Subject"><input className={inputCls} value={c.subject} disabled={locked} maxLength={300} onChange={(e) => setC({ ...c, subject: e.target.value })} data-testid="input-subject" /></Field>
          <Field label="Body (plain text)" hint="Identical for every recipient. Do not include names, shares, or amounts.">
            <textarea className={cn(inputCls, "font-mono text-[13px]")} rows={12} value={c.body} disabled={locked} onChange={(e) => setC({ ...c, body: e.target.value })} data-testid="input-body" />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={c.includeSigningLink ?? false} disabled={locked} onChange={(e) => setC({ ...c, includeSigningLink: e.target.checked })} data-testid="checkbox-include-signing-link" />
            <span>Include signing link<span className="block text-xs text-muted-foreground">Each holder's private Tax &amp; Reinvestment link is the only personalized text added to the email.</span></span>
          </label>
          <Field label="Default attachment for every holder">
            <select className={inputCls} value={c.attachment} disabled={locked} onChange={(e) => setC({ ...c, attachment: e.target.value as Att })} data-testid="select-default-attachment">
              {(Object.keys(ATT_LABEL) as Att[]).map((a) => <option key={a} value={a}>{ATT_LABEL[a]}</option>)}
            </select>
          </Field>
          {save.isError && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-save-error">{errMessage(save.error)}</div>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <Btn onClick={() => save.mutate({ id, data: c })} disabled={locked || !dirty && m.draftId !== null || save.isPending || !subjectOk}
              disabledReason={locked ? "Sent mailings are locked." : save.isPending ? "Saving; please wait." : !subjectOk ? "Enter a subject and body." : "No changes to save."} data-testid="button-save-draft"><Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save draft"}</Btn>
          </div>
        </section>

        <section className="space-y-4">
          <Docs id={id} m={m} c={c} setC={setC} locked={locked} onDone={inval} />
          <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="section-send">
            <h2 className="font-display text-xl">Preview and send</h2>
            {unsavedReason && <p className="flex gap-2 text-xs text-[hsl(30_60%_32%)]" role="note" data-testid="text-unsaved-reason"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {unsavedReason}</p>}
            <Field label="Preview as holder" hint="Delivered to your own signed-in email address, never to the holder.">
              <select className={inputCls} value={previewPid} onChange={(e) => setPreviewPid(e.target.value)} data-testid="select-preview-holder">
                {m.recipients.map((r) => <option key={r.personId} value={r.personId}>{r.displayName}</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Btn variant="ghost" onClick={() => run("preview", previewPid)} disabled={!!unsavedReason || !previewPid || send.isPending}
                disabledReason={send.isPending ? "Sending; please wait." : unsavedReason ?? "Choose a holder to preview."} data-testid="button-preview"><Eye className="h-4 w-4" /> Send to me first</Btn>
              <Btn onClick={() => { if (window.confirm(`Send this mailing to ${emailList.length} holder${emailList.length === 1 ? "" : "s"} by email? ${paperList.length} will need paper letters.`)) run("send"); }}
                disabled={!!sendReason || send.isPending} disabledReason={send.isPending ? "Sending; please wait." : sendReason ?? undefined} data-testid="button-send"><Send className="h-4 w-4" /> Send to {emailList.length}</Btn>
            </div>
            {sendReason && <p className="text-xs text-muted-foreground" role="note" data-testid="text-send-disabled-reason">{sendReason}</p>}
            {sendErr && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-send-error">{sendErr}</div>}
            {results && (
              <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs" data-testid="panel-send-results">
                <div className="mb-1 font-medium capitalize">{results.kind} results</div>
                {results.r.results.length === 0 ? <div className="text-muted-foreground">No messages were sent.</div> : (
                  <ul className="space-y-1">{results.r.results.map((x, i) => (
                    <li key={i} data-testid={`text-result-${x.personId}`}><span className="font-medium">{m.recipients.find((r) => r.personId === x.personId)?.displayName ?? x.personId}</span> · {x.result}
                      {x.messageId && <span className="num text-muted-foreground"> · ID {x.messageId}</span>}{x.detail && <span className="text-destructive"> · {x.detail}</span>}</li>
                  ))}</ul>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <RecipientTable title="Email" list={emailList} c={c} locked={locked} setChoice={setChoice} paper={paper} onResend={(pid) => run("resend", pid)}
        resendReason={m.isPractice ? "Practice year: resending is disabled." : unsavedReason} sending={send.isPending} />
      <RecipientTable title="Paper" list={paperList} c={c} locked={locked} setChoice={setChoice} paper={paper} />
      {paper.isError && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-paper-error">{errMessage(paper.error)}</div>}
    </div>
  );
}

function RecipientTable({ title, list, c, locked, setChoice, paper, onResend, resendReason, sending }: {
  title: string; list: MailingViewRecipientsItem[]; c: MailingContent; locked: boolean; setChoice: (pid: string, a: Att) => void;
  paper: ReturnType<typeof useSavePaperPreference>; onResend?: (pid: string) => void; resendReason?: string | null; sending?: boolean;
}) {
  return (
    <section className="space-y-3" data-testid={`section-${title.toLowerCase()}-list`}>
      <div className="flex items-end justify-between"><h2 className="font-display text-xl">{title} list</h2><span className="num text-xs text-muted-foreground">{list.length} holder{list.length === 1 ? "" : "s"}</span></div>
      {list.length === 0 ? <div className="rounded-lg border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">No holders in this list.</div> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-secondary/50 text-[11px] tracking-wider text-muted-foreground">
              <tr className="text-left"><th className="px-3 py-2 font-medium">Holder</th><th className="px-2 py-2 font-medium">Email</th><th className="px-2 py-2 font-medium">Channel</th><th className="px-2 py-2 font-medium">Attachment</th><th className="px-2 py-2 font-medium">Prefers paper</th><th className="px-2 py-2 font-medium">Status</th>{onResend && <th className="px-3 py-2" />}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((r) => {
                const bounced = /bounce|fail|reject|complain/i.test(r.status);
                return (
                  <tr key={r.personId} className="align-top hover:bg-secondary/30" data-testid={`row-recipient-${r.personId}`}>
                    <td className="px-3 py-2 font-medium">{r.displayName}</td>
                    <td className="num px-2 py-2 text-xs" data-testid={`text-email-${r.personId}`}>{r.email ?? <span className="text-muted-foreground">No email</span>}</td>
                    <td className="px-2 py-2"><Tag tone={r.channel === "Email" ? "lichen" : r.channel === "Paper" ? "plain" : "amber"}>{r.channel}</Tag></td>
                    <td className="px-2 py-2">
                      <select className={cn(inputCls, "py-1 text-xs")} value={c.choices[r.personId] ?? c.attachment} disabled={locked} title={locked ? "Sent mailings are locked." : undefined}
                        onChange={(e) => setChoice(r.personId, e.target.value as Att)} data-testid={`select-attachment-${r.personId}`}>
                        {(Object.keys(ATT_LABEL) as Att[]).map((a) => <option key={a} value={a}>{ATT_LABEL[a]}{a === c.attachment ? " (default)" : ""}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={r.prefersPaper} disabled={paper.isPending} onChange={(e) => paper.mutate({ data: { personId: r.personId, prefersPaper: e.target.checked } })} data-testid={`checkbox-paper-${r.personId}`} />
                        Paper
                      </label>
                    </td>
                    <td className="px-2 py-2 text-xs" data-testid={`text-status-${r.personId}`}>
                      <div className={cn(bounced && "text-destructive")}>{r.status}</div>
                      {r.sentAt && <div className="text-muted-foreground">{fmtDate(r.sentAt, true)}</div>}
                      {r.messageId && <div className="num text-[10px] text-muted-foreground">ID {r.messageId}</div>}
                      {r.detail && <div className="text-muted-foreground">{r.detail}</div>}
                      {bounced && <div className="mt-1 text-destructive" role="note">Fix this address in the Roster, then refresh addresses.</div>}
                      {r.channel === "No email" && <div className="mt-1 text-muted-foreground">No email on file; a paper letter is needed.</div>}
                    </td>
                    {onResend && (
                      <td className="px-3 py-2 text-right">
                        <Btn variant="quiet" className="px-2 py-1 text-xs" disabled={!r.canResend || !!resendReason || sending} onClick={() => { if (window.confirm(`Resend to ${r.displayName}?`)) onResend(r.personId); }}
                          disabledReason={sending ? "Sending; please wait." : resendReason ?? "Resend is only available after this holder's email was sent or failed."} data-testid={`button-resend-${r.personId}`}><RotateCw className="h-3.5 w-3.5" /> Resend</Btn>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Docs({ id, m, c, setC, locked, onDone }: { id: number; m: MailingView; c: MailingContent; setC: (f: (p: MailingContent) => MailingContent) => void; locked: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const request = useRequestYearUpload();
  const attach = useAttachYearDocument();
  const sel = useMemo(() => new Set(c.documentIds), [c.documentIds]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    for (const file of Array.from(files)) {
      if (file.type !== "application/pdf") { setErr(`${file.name}: only PDF can be shared.`); continue; }
      if (file.size < 1 || file.size > 20971520) { setErr(`${file.name}: must be under 20 MB.`); continue; }
      try {
        setBusy(`Uploading ${file.name}…`);
        const slot = await request.mutateAsync({ id, data: { filename: file.name.slice(0, 200), contentType: "application/pdf", size: file.size } });
        const put = await fetch(slot.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
        setBusy(`Sealing ${file.name}…`);
        await attach.mutateAsync({ id, data: { uploadId: slot.uploadId } });
        toast({ title: "Document attached", description: file.name });
      } catch (e) { setErr(`${file.name}: ${errMessage(e)}`); }
    }
    setBusy(null);
    onDone();
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="section-shared-documents">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-xl">Shared documents</h2>
        <input ref={input} type="file" multiple accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="input-upload-shared" />
        <Btn variant="ghost" className="py-1 text-xs" disabled={!!busy || locked} disabledReason={locked ? "Sent mailings are locked." : "Upload in progress."} onClick={() => input.current?.click()} data-testid="button-upload-shared"><FileUp className="h-3.5 w-3.5" /> Upload PDFs</Btn>
      </div>
      {busy && <div className="animate-pulse rounded-md bg-accent/60 px-3 py-2 text-xs text-accent-foreground" data-testid="status-uploading">{busy}</div>}
      {err && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-upload-error">{err}</div>}
      {m.documents.length === 0 ? <div className="text-sm text-muted-foreground">No sealed documents for this year.</div> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {m.documents.map((d) => {
            const pdf = d.contentType === "application/pdf";
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`row-shared-doc-${d.id}`}>
                <input type="checkbox" checked={sel.has(d.id)} disabled={!pdf || locked} title={!pdf ? "Only PDF documents can be attached to email." : locked ? "Sent mailings are locked." : undefined}
                  onChange={(e) => setC((p) => ({ ...p, documentIds: e.target.checked ? [...p.documentIds, d.id] : p.documentIds.filter((x) => x !== d.id) }))} data-testid={`checkbox-doc-${d.id}`} />
                <FileText className="h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0 flex-1"><div className="truncate">{d.filename}</div><div className="text-xs text-muted-foreground">#{d.id} · {fmtBytes(d.size)}{!pdf && " · not PDF, cannot attach"}</div></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MailingLink({ id }: { id: number }): ReactNode {
  return <Link href={`/years/${id}/mailing`} className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3.5 py-2 text-sm font-medium hover:bg-secondary" data-testid="link-year-mailing"><Mail className="h-4 w-4" /> Mailing</Link>;
}
