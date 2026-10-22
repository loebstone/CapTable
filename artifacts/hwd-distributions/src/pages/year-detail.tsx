import { formatShares } from "@workspace/display";
import { useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetYear, useSaveYearFigures, useDeclareYear, useFinalizeYear, useCorrectYear, useRecordPayment, useReversePayment,
  useSetYearHold, useRequestYearUpload, useAttachYearDocument,
  getGetYearQueryKey, getListYearsQueryKey, getListPracticeYearsQueryKey, getListAuditQueryKey,
  type YearDetail, type YearCalculation, type YearHolder, type YearDocument, type PaymentEntry, type CostLineInput,
  type YearCorrectionInputKind, type DocumentUploadInputContentType,
} from "@workspace/api-client-react";
import { ArrowLeft, FileUp, FileText, Download, Plus, Trash2, Lock, PencilLine, Stamp, Undo2, Hand, Banknote, Landmark, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, inputCls, Tag } from "@/components/bits";
import { StatusTag } from "@/pages/years";
import { YearExports } from "@/components/year-exports";
import { PracticeReset } from "@/components/practice-reset";
import { fmtDate, errMessage, ratePct } from "@/lib/format";
import { fmtCents, parseDollars, centsToInput, isNeg, todayISO, fmtBytes, sumCents } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Modal =
  | { k: "figures" } | { k: "declare" } | { k: "finalize" } | { k: "correct" }
  | { k: "pay"; holder: YearHolder; kind: "cash" | "apic" }
  | { k: "hold"; holder: YearHolder }
  | { k: "reverse"; entry: PaymentEntry }
  | null;

function useYearInval(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetYearQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListYearsQueryKey() });
    qc.invalidateQueries({ queryKey: getListPracticeYearsQueryKey() });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
}

export default function YearDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const q = useGetYear(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetYearQueryKey(id) } });
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);

  if (!Number.isInteger(id) || id <= 0) return <Empty title="No such year." action={<Link href="/years" className="text-sm text-primary">Back to years</Link>} />;
  if (q.isLoading) return <div className="space-y-6"><div className="h-20 animate-pulse rounded-lg bg-muted" /><SkeletonRows rows={6} /></div>;
  if (q.isError || !q.data) return <ErrorPanel error={q.error} onRetry={() => q.refetch()} />;
  const y = q.data;
  const draft = y.status === "draft";

  return (
    <div className="space-y-8">
      <Link href="/years" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary" data-testid="link-back-years"><ArrowLeft className="h-3.5 w-3.5" /> All years</Link>
      <PageHeader
        kicker={`Distribution year · snapshot #${y.snapshotId} · rate table #${y.rateTableId}`}
        title={`${y.calendarYear}${y.isPractice ? " — Practice" : " timber distribution"}`}
        actions={draft ? <>
          <Btn variant="ghost" onClick={() => setModal({ k: "figures" })} data-testid="button-edit-figures"><PencilLine className="h-4 w-4" /> {y.figures ? "Revise figures" : "Enter figures"}</Btn>
          <Btn variant="ghost" onClick={() => setModal({ k: "declare" })} disabled={!y.calculation} disabledReason="Enter the year's figures before declaring an amount." data-testid="button-declare"><Stamp className="h-4 w-4" /> Declare</Btn>
          <Btn onClick={() => setModal({ k: "finalize" })} data-testid="button-finalize"><Lock className="h-4 w-4" /> Finalize</Btn>
        </> : <Btn variant="ghost" onClick={() => setModal({ k: "correct" })} data-testid="button-correct-year"><PencilLine className="h-4 w-4" /> Record correction</Btn>}
      >
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusTag status={y.status} />
          <span>Opened {fmtDate(y.createdAt)} by {y.createdBy}{y.finalizedAt && <> · finalized {fmtDate(y.finalizedAt, true)}</>}</span>
          <Link href={`/snapshots/${y.snapshotId}`} className="text-primary underline-offset-2 hover:underline" data-testid="link-year-snapshot">View snapshot</Link>
        </span>
      </PageHeader>

      {y.isPractice && <div role="note" className="sticky top-0 z-20 rounded-md border border-amber-600 bg-amber-100 px-4 py-3 font-medium text-amber-950" data-testid="banner-practice-year">Practice year — nothing here is a real distribution</div>}
      {y.isPractice && <PracticeReset y={y} />}
      {y.blockers.length > 0 && <Blockers y={y} />}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <section className="rise rise-d1 space-y-3">
          <SectionTitle>Worked calculation{y.status === "corrected" && " · effective"}</SectionTitle>
          {y.calculation ? <WorkedTable c={y.calculation} declared={y.declaredPerShareCents} date={y.declarationDate} /> : (
            <Empty title="No figures yet.">Enter the gross timber income and each cost line, each tied to a source document. Net profit is computed on the server.</Empty>
          )}
          {y.status === "corrected" && y.originalCalculation && (
            <details className="rounded-lg border border-border bg-secondary/30">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted-foreground" data-testid="toggle-original-calculation">Original finalized calculation (frozen)</summary>
              <div className="p-3 pt-0"><WorkedTable c={y.originalCalculation} declared={null} date={null} muted /></div>
            </details>
          )}
        </section>
        <section className="rise rise-d2 space-y-6">
          <FiguresCard y={y} />
          <Documents y={y} />
        </section>
      </div>

      <Holders y={y} onAction={setModal} />
      {(!draft || y.isPractice) && <Ledger y={y} onReverse={(entry) => setModal({ k: "reverse", entry })} />}
      <YearExports y={y} />
      <History y={y} />

      <Dialog open={!!modal} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-2xl">
          {modal?.k === "figures" && <FiguresForm y={y} onDone={close} />}
          {modal?.k === "declare" && <DeclareForm y={y} onDone={close} />}
          {modal?.k === "finalize" && <FinalizeForm y={y} onDone={close} />}
          {modal?.k === "correct" && <CorrectionForm y={y} onDone={close} />}
          {modal?.k === "pay" && <PaymentForm y={y} holder={modal.holder} kind={modal.kind} onDone={close} />}
          {modal?.k === "hold" && <HoldForm y={y} holder={modal.holder} onDone={close} />}
          {modal?.k === "reverse" && <ReverseForm y={y} entry={modal.entry} onDone={close} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-display text-xl">{children}</h2>
      {right}
    </div>
  );
}

function Blockers({ y }: { y: YearDetail }) {
  return (
    <div className="rise rounded-lg border border-[hsl(38_60%_70%)] bg-[hsl(38_70%_94%)] p-4" data-testid="panel-blockers">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[hsl(30_60%_28%)]"><AlertTriangle className="h-4 w-4" /> {y.blockers.length} item{y.blockers.length === 1 ? "" : "s"} block finalization</div>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {y.blockers.map((b, i) => (
          <li key={i} className="flex gap-2" data-testid={`text-blocker-${i}`}><span className="font-medium">{b.displayName}</span><span className="text-[hsl(30_30%_35%)]">{b.reason}</span></li>
        ))}
      </ul>
    </div>
  );
}

function WorkedTable({ c, declared, date, muted }: { c: YearCalculation; declared: string | null; date: string | null; muted?: boolean }) {
  const Row = ({ label, op, value, strong, test }: { label: ReactNode; op?: string; value: ReactNode; strong?: boolean; test?: string }) => (
    <tr className={cn(strong && "bg-secondary/50")}>
      <td className="w-6 py-1.5 pl-4 text-center font-mono text-xs text-muted-foreground">{op}</td>
      <td className="py-1.5 pr-3 text-sm">{label}</td>
      <td className={cn("num py-1.5 pr-4 text-right text-sm", strong && "font-medium")} data-testid={test}>{value}</td>
    </tr>
  );
  const rate = (r: string | null) => (r ? <>{r} <span className="text-xs text-muted-foreground">({ratePct(r)})</span></> : "—");
  const residual = c.residualCents;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", muted && "opacity-80")} data-testid={muted ? "table-original-calculation" : "table-worked"}>
      <table className="w-full">
        <tbody className="divide-y divide-border/70">
          <Row label="Gross timber income" value={fmtCents(c.grossCents)} test="text-gross" />
          <Row op="−" label="Costs" value={fmtCents(c.costTotalCents)} test="text-costs" />
          <Row op="=" label="Net profit" value={fmtCents(c.netProfitCents)} strong test="text-net-profit" />
          <Row label="Federal rate" value={rate(c.federalRate)} />
          <Row op="+" label={<>Highest state rate {c.highestState && <span className="num ml-1 rounded bg-secondary px-1 text-xs">{c.highestState}</span>}</>} value={rate(c.highestStateRate)} />
          <Row op="=" label="Combined rate" value={rate(c.combinedRate)} strong />
          <Row op="×" label="Distribution pool (net × combined)" value={fmtCents(c.poolCents)} test="text-pool" />
          <Row op="÷" label="Shares" value={<span>400</span>} />
          <Row op="=" label="Proposed per share" value={fmtCents(c.proposedPerShareCents)} strong test="text-proposed" />
        </tbody>
      </table>
      {!muted && (
        <div className="border-t-2 border-double border-border bg-[hsl(166_22%_95%)] px-4 py-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-accent-foreground">Reconciliation</div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>Declared per share {date && <span className="text-xs text-muted-foreground">· {fmtDate(date)}</span>}</dt><dd className="num text-right font-medium" data-testid="text-declared">{declared ? fmtCents(declared) : "Not declared"}</dd>
            <dt>Declared × 400</dt><dd className="num text-right">{fmtCents(c.declaredPoolCents)}</dd>
            <dt>Sum of distributions</dt><dd className="num text-right" data-testid="text-sum-distribution">{fmtCents(c.sumNominalCents)}</dd>
            <dt>Residual</dt><dd className={cn("num text-right", residual && residual !== "0" && "text-primary")} data-testid="text-residual">{fmtCents(residual, { signed: true })}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function docName(y: YearDetail, id: number | null | undefined) {
  return y.documents.find((d) => d.id === id)?.filename ?? (id ? `Document #${id}` : y.isPractice ? "no source document (practice)" : "—");
}

function FiguresCard({ y }: { y: YearDetail }) {
  const f = y.figures;
  return (
    <div className="space-y-3">
      <SectionTitle>Source figures</SectionTitle>
      {!f ? <div className="rounded-lg border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">Nothing entered.</div> : (
        <div className="overflow-hidden rounded-lg border border-border bg-card text-sm" data-testid="card-figures">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            <div><div>Gross</div><div className="truncate text-xs text-muted-foreground">{docName(y, f.grossDocumentId)}</div></div>
            <div className="num font-medium">{fmtCents(f.grossCents)}</div>
          </div>
          {f.costs.length === 0 && <div className="px-4 py-2 text-xs text-muted-foreground">No cost lines.</div>}
          {f.costs.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 last:border-0" data-testid={`row-cost-${i}`}>
              <div className="min-w-0"><div className="truncate">{c.label}</div><div className="truncate text-xs text-muted-foreground">{docName(y, c.documentId)}</div></div>
              <div className="num text-muted-foreground">−{fmtCents(c.amountCents)}</div>
            </div>
          ))}
          <div className="bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">Note: {f.note}</div>
        </div>
      )}
    </div>
  );
}

const TYPES: DocumentUploadInputContentType[] = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX = 20971520;

function Documents({ y }: { y: YearDetail }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const request = useRequestYearUpload();
  const attach = useAttachYearDocument();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    for (const file of Array.from(files)) {
      const type = file.type as DocumentUploadInputContentType;
      if (!TYPES.includes(type)) { setErr(`${file.name}: only PDF, PNG, JPEG, WebP or GIF.`); continue; }
      if (file.size < 1 || file.size > MAX) { setErr(`${file.name}: must be under 20 MB.`); continue; }
      try {
        setBusy(`Requesting slot for ${file.name}…`);
        const slot = await request.mutateAsync({ id: y.id, data: { filename: file.name.slice(0, 200), contentType: type, size: file.size } });
        setBusy(`Uploading ${file.name}…`);
        const put = await fetch(slot.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": type } });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
        setBusy(`Sealing ${file.name}…`);
        await attach.mutateAsync({ id: y.id, data: { uploadId: slot.uploadId } });
        toast({ title: "Document attached", description: file.name });
      } catch (e) {
        setErr(`${file.name}: ${errMessage(e)}`);
      }
    }
    setBusy(null);
    inval();
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-3">
      <SectionTitle right={<>
        <input ref={input} type="file" multiple accept={TYPES.join(",")} className="hidden" onChange={(e) => upload(e.target.files)} data-testid="input-upload-document" />
        <Btn variant="ghost" className="py-1 text-xs" disabled={!!busy} onClick={() => input.current?.click()} data-testid="button-upload-document"><FileUp className="h-3.5 w-3.5" /> Upload</Btn>
      </>}>Source documents</SectionTitle>
      {busy && <div className="animate-pulse rounded-md bg-accent/60 px-3 py-2 text-xs text-accent-foreground" data-testid="status-uploading">{busy}</div>}
      {err && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-upload-error">{err}</div>}
      {y.documents.length === 0 ? <div className="rounded-lg border border-dashed border-input px-4 py-5 text-sm text-muted-foreground">No documents. PDF or image, up to 20 MB each.</div> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {y.documents.map((d) => <DocRow key={d.id} d={d} />)}
        </ul>
      )}
    </div>
  );
}

function DocRow({ d }: { d: YearDocument }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm" data-testid={`row-document-${d.id}`}>
      <FileText className="h-4 w-4 shrink-0 text-primary/70" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{d.filename}</div>
        <div className="text-xs text-muted-foreground">#{d.id} · {fmtBytes(d.size)} · {fmtDate(d.uploadedAt, true)} · {d.uploadedBy}</div>
      </div>
      <a href={d.downloadUrl} className="text-muted-foreground transition-colors hover:text-primary" aria-label={`Download ${d.filename}`} data-testid={`link-download-document-${d.id}`}><Download className="h-4 w-4" /></a>
    </li>
  );
}

function statusTag(h: YearHolder) {
  return <Tag tone={h.instruction === "✓" ? "lichen" : h.isOnHold ? "amber" : "plain"}><span aria-label={h.instruction === "✓" ? "Paid in full" : undefined}>{h.instruction}</span></Tag>;
}

function Holders({ y, onAction }: { y: YearDetail; onAction: (m: Modal) => void }) {
  const ledger = y.isPractice || y.status !== "draft";
  const t = y.totals;
  return (
    <section className="rise rise-d3 space-y-3">
      <SectionTitle right={<div className="num flex gap-3 text-xs text-muted-foreground"><span>on hold: {t.heldCount}</span><span>paid in full: {t.completeCount}</span><span>to pay: {t.openCount}</span></div>}>Holders</SectionTitle>
      {y.isPractice && y.status === "draft" && <p className="text-xs text-muted-foreground">Practice payments and APIC entries are available before finalization once a per-share amount is declared. Holds can be changed now.</p>}
      {y.holders.length === 0 ? <Empty title="No holders in this snapshot." /> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1180px] text-sm" data-testid="table-year-holders">
            <thead className="bg-secondary/50 text-[11px] tracking-wider text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Holder</th><th className="px-2 py-2 font-medium">Class</th><th className="px-2 py-2 font-medium">State</th>
                <th className="px-2 py-2 text-right font-medium">Shares</th><th className="px-2 py-2 text-right font-medium">Allocated Profit</th><th className="px-2 py-2 text-right font-medium">Distribution</th>
                <th className="px-2 py-2 text-right font-medium">Estimated Tax</th><th className="px-2 py-2 text-right font-medium">Surplus/Deficit</th><th className="px-2 py-2 text-right font-medium">APIC</th>
                <th className="px-2 py-2 text-right font-medium">Paid</th><th className="px-2 py-2 font-medium">Instruction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {y.holders.map((h) => (
                <tr key={h.personId} className="align-top hover:bg-secondary/30" data-testid={`row-holder-${h.personId}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{h.displayName}</div>
                    {h.isUnsettled && <div className="text-[11px] text-[hsl(30_60%_32%)]">Unsettled</div>}
                    {h.holdNote && <div className="max-w-[200px] text-[11px] text-muted-foreground">Instruction note: {h.holdNote}</div>}
                  </td>
                  <td className="num px-2 py-2">{h.shareClass}</td>
                  <td className="num px-2 py-2">{h.stateCode ?? "—"}{!h.residenceConfirmed && <span className="ml-1 text-[10px] text-primary">unconf.</span>}{h.stateRate && <div className="text-[10px] text-muted-foreground">{h.stateRate}</div>}</td>
                  <td className="num px-2 py-2 text-right">{formatShares(h.shares)}</td>
                  <td className="num px-2 py-2 text-right">{fmtCents(h.shareOfGainCents)}</td>
                  <td className="num px-2 py-2 text-right font-medium" data-testid={`text-distribution-${h.personId}`}>{fmtCents(h.nominalCents)}</td>
                  <td className="num px-2 py-2 text-right">{fmtCents(h.estimatedTaxCents)}</td>
                  <td className={cn("num px-2 py-2 text-right", isNeg(h.surplusCents) && "text-destructive")}>{fmtCents(h.surplusCents)}</td>
                  <td className="num px-2 py-2 text-right">{fmtCents(h.retainedCents)}</td>
                  <td className="num px-2 py-2 text-right">{fmtCents(h.paidCents)}</td>
                  <td className="px-2 py-2">
                    <div data-testid={`text-instruction-${h.personId}`}>{statusTag(h)}</div>
                    {ledger && (
                      <div className="flex justify-end gap-0.5">
                         <IconBtn title={h.nominalCents === null ? "Declare a per-share amount before recording payments" : "Record cash payment"} disabled={h.nominalCents === null || h.instruction === "✓" || h.isOnHold} onClick={() => onAction({ k: "pay", holder: h, kind: "cash" })} test={`button-pay-${h.personId}`}><Banknote className="h-4 w-4" /></IconBtn>
                         <IconBtn title={h.nominalCents === null ? "Declare a per-share amount before recording APIC" : "Record APIC retained"} disabled={h.nominalCents === null || h.instruction === "✓" || h.isOnHold} onClick={() => onAction({ k: "pay", holder: h, kind: "apic" })} test={`button-apic-${h.personId}`}><Landmark className="h-4 w-4" /></IconBtn>
                        <IconBtn title={h.isOnHold ? "Remove hold" : "Put on hold"} onClick={() => onAction({ k: "hold", holder: h })} test={`button-hold-${h.personId}`}><Hand className={cn("h-4 w-4", h.isOnHold && "text-[hsl(30_60%_38%)]")} /></IconBtn>
                      </div>
                    )}
                    {ledger && (h.nominalCents === null || h.instruction === "✓" || h.isOnHold) && <p className="mt-1 max-w-44 whitespace-normal text-xs text-muted-foreground" role="note" data-testid={`text-payment-disabled-reason-${h.personId}`}>{h.isOnHold ? "Remove the hold before recording cash or APIC." : h.nominalCents === null ? "Declare a per-share amount before recording cash or APIC." : "Paid plus APIC already equals this holder's distribution."}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-double border-border bg-secondary/40 text-sm font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Totals</td>
                <td className="num px-2 py-2 text-right">{y.calculation ? fmtCents(sumCents(y.holders.map((h) => h.shareOfGainCents))) : "—"}</td>
                <td className="num px-2 py-2 text-right" data-testid="text-total-distribution">{y.declaredPerShareCents === null ? "—" : fmtCents(t.nominalCents)}</td>
                <td className="num px-2 py-2 text-right">{y.calculation && y.holders.every((h) => h.estimatedTaxCents !== null) ? fmtCents(sumCents(y.holders.map((h) => h.estimatedTaxCents))) : "—"}</td>
                <td className="num px-2 py-2 text-right">{y.holders.every((h) => h.surplusCents !== null) ? fmtCents(sumCents(y.holders.map((h) => h.surplusCents))) : "—"}</td>
                <td className="num px-2 py-2 text-right">{fmtCents(t.retainedCents)}</td>
                <td className="num px-2 py-2 text-right">{fmtCents(t.paidCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function IconBtn({ title, onClick, disabled, test, children }: { title: string; onClick: () => void; disabled?: boolean; test: string; children: ReactNode }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} data-testid={test} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30">{children}</button>;
}

function Ledger({ y, onReverse }: { y: YearDetail; onReverse: (e: PaymentEntry) => void }) {
  const name = (pid: string) => y.holders.find((h) => h.personId === pid)?.displayName ?? pid;
  const reversed = new Set(y.payments.map((p) => p.reversesEntryId).filter((x): x is number => x !== null));
  const list = [...y.payments].sort((a, b) => b.id - a.id);
  return (
    <section className="space-y-3">
      <SectionTitle>Paid and APIC ledger</SectionTitle>
      {list.length === 0 ? <Empty title="No entries yet.">Record a cash payment or retained APIC from a holder's row above.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="text-left"><th className="px-3 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Holder</th><th className="px-2 py-2 font-medium">Kind</th><th className="px-2 py-2 text-right font-medium">Amount</th><th className="px-2 py-2 font-medium">Method / note</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((p) => {
                const neg = isNeg(p.amountCents);
                const canReverse = !neg && !reversed.has(p.id);
                return (
                  <tr key={p.id} className={cn(neg && "bg-destructive/[0.03]")} data-testid={`row-payment-${p.id}`}>
                    <td className="num px-3 py-2 text-xs text-muted-foreground">{p.id}</td>
                    <td className="num px-2 py-2 text-xs">{fmtDate(p.date)}</td>
                    <td className="px-2 py-2">{name(p.personId)}</td>
                    <td className="px-2 py-2"><Tag tone={p.kind === "cash" ? "plain" : "lichen"}>{p.kind === "cash" ? "Cash" : "APIC"}</Tag></td>
                    <td className={cn("num px-2 py-2 text-right", neg && "text-destructive")}>{fmtCents(p.amountCents)}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {p.reversesEntryId && <span className="mr-1 text-destructive">Reverses #{p.reversesEntryId}.</span>}
                      {p.method && <span className="mr-1 text-foreground">{p.method}</span>}{p.note}
                      <div className="text-[10px]">{p.createdBy} · {fmtDate(p.createdAt, true)}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canReverse ? <Btn variant="quiet" className="px-2 py-1 text-xs" onClick={() => onReverse(p)} data-testid={`button-reverse-${p.id}`}><Undo2 className="h-3.5 w-3.5" /> Reverse</Btn>
                        : !neg ? <span className="text-[11px] text-muted-foreground">reversed</span> : null}
                    </td>
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

function History({ y }: { y: YearDetail }) {
  const list = [...y.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="space-y-3">
      <SectionTitle>Year history</SectionTitle>
      {list.length === 0 ? <div className="text-sm text-muted-foreground">No history.</div> : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {list.map((h) => (
            <li key={h.id} className="relative" data-testid={`row-history-${h.id}`}>
              <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-primary/60 ring-4 ring-background" />
              <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium capitalize">{h.kind.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                {h.amountCents && <span className="num text-xs">{fmtCents(h.amountCents, { signed: true })}</span>}
                <span className="text-xs text-muted-foreground">{fmtDate(h.createdAt, true)} · {h.createdBy}</span>
              </div>
              <div className="text-sm text-muted-foreground">{h.note}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------- forms ---------- */

function FormShell({ title, desc, children, error, pending, valid, submit, onDone, onSubmit, danger, disabledReason }: {
  title: string; desc: ReactNode; children: ReactNode; error: unknown; pending: boolean; valid: boolean; submit: string; onDone: () => void; onSubmit: () => void; danger?: boolean; disabledReason?: string;
}) {
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (valid && !pending) onSubmit(); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">{title}</DialogTitle>
        <DialogDescription>{desc}</DialogDescription>
      </DialogHeader>
      {children}
      {!!error && <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-form-error">{errMessage(error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" variant={danger ? "danger" : "primary"} disabled={!valid || pending} disabledReason={pending ? "Saving this record; please wait." : disabledReason} data-testid="button-submit">{pending ? "Saving…" : submit}</Btn>
      </div>
    </form>
  );
}

function DocSelect({ y, value, onChange, test, optionalPractice = false }: { y: YearDetail; value: string; onChange: (v: string) => void; test: string; optionalPractice?: boolean }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} data-testid={test}>
      <option value="">{optionalPractice && y.isPractice ? "no source document (practice)" : "Source document…"}</option>
      {y.documents.map((d) => <option key={d.id} value={d.id}>#{d.id} {d.filename}</option>)}
    </select>
  );
}

function NoteField({ v, set, label = "Note (optional)", hint }: { v: string; set: (s: string) => void; label?: string; hint?: string }) {
  return <Field label={label} hint={hint}><textarea className={inputCls} rows={2} maxLength={5000} value={v} onChange={(e) => set(e.target.value)} data-testid="input-note" /></Field>;
}

type CostDraft = { label: string; amount: string; doc: string };

function FiguresForm({ y, onDone }: { y: YearDetail; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const f = y.figures;
  const [gross, setGross] = useState(centsToInput(f?.grossCents));
  const [grossDoc, setGrossDoc] = useState(f?.grossDocumentId == null ? "" : String(f.grossDocumentId));
  const [costs, setCosts] = useState<CostDraft[]>(f?.costs.map((c) => ({ label: c.label, amount: centsToInput(c.amountCents), doc: c.documentId == null ? "" : String(c.documentId) })) ?? []);
  const [note, setNote] = useState("");
  const save = useSaveYearFigures({ mutation: { onSuccess: () => { inval(); toast({ title: "Figures saved", description: "Previous figures remain in the history." }); onDone(); } } });
  const grossC = parseDollars(gross);
  const parsed: (CostLineInput | null)[] = costs.map((c) => { const a = parseDollars(c.amount); return a && (c.doc || y.isPractice) ? { label: c.label.trim().slice(0, 200) || "Direct cost", amountCents: a, documentId: c.doc ? Number(c.doc) : null } : null; });
  const costTotal = sumCents(parsed.map((p) => p?.amountCents));
  const valid = !!grossC && (!!grossDoc || y.isPractice) && parsed.every(Boolean) && costs.length <= 100;
  const upd = (i: number, p: Partial<CostDraft>) => setCosts((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <FormShell title={f ? "Revise figures" : "Enter figures"} desc={y.isPractice ? "Source documents are optional in practice years only. Saving appends a revision; net profit is computed by the server." : "Each amount is tied to an uploaded document. Saving appends a revision; nothing is deleted. Net profit is computed by the server."} error={save.error} pending={save.isPending} valid={valid} disabledReason={!grossC ? "Enter a valid gross amount." : !grossDoc && !y.isPractice ? "Attach a source document to the gross figure." : costs.length > 100 ? "Use at most 100 cost lines." : "Enter a valid amount for every cost line and, for a real year, select each source document."} submit="Save figures" onDone={onDone}
      onSubmit={() => save.mutate({ id: y.id, data: { grossCents: grossC!, grossDocumentId: grossDoc ? Number(grossDoc) : null, costs: parsed as CostLineInput[], note: note.trim() } })}>
      {!y.isPractice && y.documents.length === 0 && <div className="rounded-md bg-[hsl(38_70%_94%)] px-3 py-2 text-xs text-[hsl(30_60%_28%)]">Upload the source documents first, from the Source documents panel.</div>}
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Gross income ($)" error={gross && !grossC ? "Dollars and cents, e.g. 48213.07" : null} hint={grossC ? fmtCents(grossC) : undefined}>
          <input className={inputCls + " num"} value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" inputMode="decimal" data-testid="input-gross" />
        </Field>
        <Field label="Gross source"><DocSelect y={y} value={grossDoc} onChange={setGrossDoc} test="select-gross-document" optionalPractice /></Field>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Cost lines <span className="num ml-2 text-muted-foreground">total {fmtCents(costTotal)}</span></span>
          <Btn type="button" variant="quiet" className="py-1 text-xs" onClick={() => setCosts((x) => [...x, { label: "", amount: "", doc: "" }])} data-testid="button-add-cost"><Plus className="h-3.5 w-3.5" /> Add cost</Btn>
        </div>
        {costs.length === 0 && <div className="rounded-md border border-dashed border-input px-3 py-3 text-xs text-muted-foreground">No costs. Add forester fees, hauling, road work, and so on.</div>}
        {costs.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_32px] gap-2 sm:grid-cols-[1fr_120px_1fr_32px]" data-testid={`row-cost-input-${i}`}>
            <input className={inputCls} value={c.label} maxLength={200} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Label (optional; defaults to Direct cost)" data-testid={`input-cost-label-${i}`} />
            <input className={cn(inputCls, "num", c.amount && !parseDollars(c.amount) && "border-destructive")} value={c.amount} onChange={(e) => upd(i, { amount: e.target.value })} placeholder="0.00" inputMode="decimal" data-testid={`input-cost-amount-${i}`} />
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"><DocSelect y={y} value={c.doc} onChange={(v) => upd(i, { doc: v })} test={`select-cost-document-${i}`} optionalPractice /></div>
            <button type="button" className="mt-2 text-muted-foreground hover:text-destructive" aria-label="Remove cost line" onClick={() => setCosts((x) => x.filter((_, j) => j !== i))} data-testid={`button-remove-cost-${i}`}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <NoteField v={note} set={setNote} hint="Why these figures, or what changed." />
    </FormShell>
  );
}

function DeclareForm({ y, onDone }: { y: YearDetail; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(y.declarationDate ?? "");
  const [note, setNote] = useState("");
  const decl = useDeclareYear({ mutation: { onSuccess: () => { inval(); toast({ title: "Declaration recorded" }); onDone(); } } });
  const c = parseDollars(amt);
  const proposed = y.calculation?.proposedPerShareCents;
  const valid = !!c && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <FormShell title="Declare per-share amount" desc="The declared amount, not the proposal, governs each holder's distribution." error={decl.error} pending={decl.isPending} valid={valid} disabledReason="Enter a valid per-share amount and declaration date." submit="Record declaration" onDone={onDone}
      onSubmit={() => decl.mutate({ id: y.id, data: { declaredPerShareCents: c!, declarationDate: date, note: note.trim() } })}>
      <div className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2 text-sm">
        <span>Proposed per share <b className="num ml-2 font-medium">{fmtCents(proposed)}</b>{y.declaredPerShareCents && <span className="ml-3 text-xs text-muted-foreground">current: {fmtCents(y.declaredPerShareCents)}</span>}</span>
        {proposed && <Btn type="button" variant="quiet" className="py-1 text-xs" onClick={() => setAmt(centsToInput(proposed))} data-testid="button-use-proposed">Use proposed</Btn>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Declared per share ($)" error={amt && !c ? "Dollars and cents" : null} hint={c ? `× 400 = ${fmtCents((BigInt(c) * 400n).toString())}` : undefined}>
          <input className={inputCls + " num"} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" inputMode="decimal" data-testid="input-declared" />
        </Field>
        <Field label="Declaration date"><input type="date" className={inputCls + " num"} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-declaration-date" /></Field>
      </div>
      <NoteField v={note} set={setNote} />
    </FormShell>
  );
}

function FinalizeForm({ y, onDone }: { y: YearDetail; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const fin = useFinalizeYear({ mutation: { onSuccess: () => { inval(); toast({ title: `${y.calendarYear}${y.isPractice ? " — Practice" : ""} finalized`, description: y.isPractice ? "Inputs are locked until an explicit practice reset; changes go through corrections." : "Figures are now permanent; changes go through corrections." }); onDone(); } } });
  const blocked = y.blockers.length > 0;
  return (
    <FormShell title={`Finalize ${y.calendarYear}${y.isPractice ? " — Practice" : ""}`} desc={y.isPractice ? "Finalizing freezes the figures, snapshot, residences and rates. Later changes are corrections, unless you explicitly reset this practice year." : "Finalizing freezes the figures, snapshot, residences and rates. It cannot be undone; later changes are recorded as corrections."} error={fin.error} pending={fin.isPending} valid={!blocked} disabledReason={y.blockers.map((b) => `${b.displayName}: ${b.reason}`).join("; ")} submit="Finalize year" onDone={onDone}
      onSubmit={() => fin.mutate({ id: y.id, data: { note: note.trim() } })}>
      {blocked ? (
        <ul className="space-y-1 rounded-md border border-[hsl(38_60%_70%)] bg-[hsl(38_70%_94%)] px-3 py-2 text-sm" data-testid="list-finalize-blockers">
          {y.blockers.map((b, i) => <li key={i}><b className="font-medium">{b.displayName}</b> — {b.reason}</li>)}
        </ul>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-accent/60 px-3 py-2 text-sm text-accent-foreground"><CheckCircle2 className="h-4 w-4" /> Nothing blocks finalization. Declared {fmtCents(y.declaredPerShareCents)} per share; distribution total {fmtCents(y.totals.nominalCents)}.</div>
      )}
      <NoteField v={note} set={setNote} />
    </FormShell>
  );
}

const KINDS: { k: YearCorrectionInputKind; label: string }[] = [
  { k: "note", label: "Note only" },
  { k: "grossAdjustment", label: "Gross adjustment" },
  { k: "costAdjustment", label: "Cost adjustment" },
  { k: "declaredPerShareAdjustment", label: "Declared per-share adjustment" },
];

function CorrectionForm({ y, onDone }: { y: YearDetail; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const [kind, setKind] = useState<YearCorrectionInputKind>("note");
  const [amt, setAmt] = useState("");
  const [doc, setDoc] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const corr = useCorrectYear({ mutation: { onSuccess: () => { inval(); toast({ title: "Correction recorded", description: "The original finalization is unchanged." }); onDone(); } } });
  const c = parseDollars(amt, true);
  const needsAmt = kind !== "note";
  const needsDoc = kind === "grossAdjustment" || kind === "costAdjustment";
  const needsDate = kind === "declaredPerShareAdjustment";
  const valid = (!needsAmt || (!!c && c !== "0")) && (!needsDoc || !!doc) && (!needsDate || /^\d{4}-\d{2}-\d{2}$/.test(date));
  return (
    <FormShell title="Record a correction" desc="Corrections adjust effective figures on the frozen snapshot, residences and rates. The original finalization stays visible." error={corr.error} pending={corr.isPending} valid={valid} disabledReason="Enter a nonzero adjustment and select any source document or declaration date required for this correction type." submit="Record correction" onDone={onDone}
      onSubmit={() => corr.mutate({ id: y.id, data: { kind, note: note.trim(), amountCents: needsAmt ? c : null, documentId: needsDoc ? Number(doc) : null, declarationDate: needsDate ? date : null } })}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {KINDS.map((o) => (
          <button type="button" key={o.k} onClick={() => setKind(o.k)} className={cn("rounded-md border px-2 py-2 text-xs transition-colors", kind === o.k ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-secondary")} data-testid={`button-kind-${o.k}`}>{o.label}</button>
        ))}
      </div>
      {needsAmt && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={needsDate ? "Per-share change ($, signed)" : "Amount change ($, signed)"} error={amt && (!c || c === "0") ? "Non-zero, e.g. -125.00 or 310.40" : null} hint={c ? fmtCents(c, { signed: true }) : "Use a minus sign to reduce."}>
            <input className={inputCls + " num"} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="-0.00" data-testid="input-correction-amount" />
          </Field>
          {needsDoc && <Field label="Supporting document" hint={y.documents.length === 0 ? "Upload one first." : undefined}><DocSelect y={y} value={doc} onChange={setDoc} test="select-correction-document" /></Field>}
          {needsDate && <Field label="Declaration date"><input type="date" className={inputCls + " num"} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-correction-date" /></Field>}
        </div>
      )}
      <NoteField v={note} set={setNote} />
    </FormShell>
  );
}

function PaymentForm({ y, holder, kind, onDone }: { y: YearDetail; holder: YearHolder; kind: "cash" | "apic"; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("");
  const [letter, setLetter] = useState(false);
  const [note, setNote] = useState("");
  const pay = useRecordPayment({ mutation: { onSuccess: () => { inval(); toast({ title: kind === "cash" ? "Payment recorded" : "APIC retention recorded", description: holder.displayName }); onDone(); } } });
  const c = parseDollars(amt);
  const valid = !!c && c !== "0" && /^\d{4}-\d{2}-\d{2}$/.test(date) && (kind === "cash" || letter);
  return (
    <FormShell title={kind === "cash" ? `Cash payment to ${holder.displayName}` : `Retain as APIC for ${holder.displayName}`}
      desc={<>Remaining <b className="num">{fmtCents(holder.remainingCents)}</b> of distribution <span className="num">{fmtCents(holder.nominalCents)}</span>. Entries are permanent; mistakes are fixed by reversal.</>}
      error={pay.error} pending={pay.isPending} valid={valid} disabledReason={!c || c === "0" ? "Enter a positive amount." : !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "Enter a valid entry date." : "Confirm that the shareholder's signed direction letter has been received."} submit="Record entry" onDone={onDone}
      onSubmit={() => pay.mutate({ id: y.id, data: { personId: holder.personId, kind, amountCents: c!, date, method: kind === "cash" ? method.trim() : undefined, note: note.trim() || undefined } })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount ($)" error={amt && (!c || c === "0") ? "Positive dollars and cents" : null} hint={c ? fmtCents(c) : undefined}>
          <div className="flex gap-1.5">
            <input className={inputCls + " num"} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" inputMode="decimal" data-testid="input-payment-amount" />
            {holder.remainingCents && !isNeg(holder.remainingCents) && holder.remainingCents !== "0" && <Btn type="button" variant="quiet" className="shrink-0 px-2 text-xs" onClick={() => setAmt(centsToInput(holder.remainingCents))} data-testid="button-fill-remaining">Remaining</Btn>}
          </div>
        </Field>
        <Field label={kind === "apic" ? "Direction letter received date" : "Cash payment date"}><input type="date" className={inputCls + " num"} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-payment-date" /></Field>
      </div>
      {kind === "cash" ? (
        <Field label="Method or check number (optional)" hint="e.g. Check 1184, or how it was paid."><input className={inputCls} maxLength={200} value={method} onChange={(e) => setMethod(e.target.value)} data-testid="input-payment-method" /></Field>
      ) : (
        <label className="flex items-start gap-2 rounded-md bg-accent/50 px-3 py-2 text-sm text-accent-foreground">
          <input type="checkbox" className="mt-1 accent-[hsl(170_32%_28%)]" checked={letter} onChange={(e) => setLetter(e.target.checked)} data-testid="checkbox-direction-letter" />
          A signed direction letter from {holder.displayName} asking that this amount be retained as additional paid-in capital has been received.
        </label>
      )}
      <NoteField v={note} set={setNote} label="Note (optional)" />
    </FormShell>
  );
}

function HoldForm({ y, holder, onDone }: { y: YearDetail; holder: YearHolder; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const held = holder.isOnHold;
  const [note, setNote] = useState("");
  const m = useSetYearHold({ mutation: { onSuccess: () => { inval(); toast({ title: held ? "Remove hold" : "Put on hold", description: holder.displayName }); onDone(); } } });
  return (
    <FormShell title={held ? `Remove hold: ${holder.displayName}` : `Put on hold: ${holder.displayName}`} desc={held ? <>Currently on hold{holder.holdNote ? `: ${holder.holdNote}` : "."}{holder.isUnsettled && " This holding is unsettled."}</> : "Put this holder on hold. A note is optional. Existing entries remain unchanged."}
      error={m.error} pending={m.isPending} valid={true} submit={held ? "Remove hold" : "Put on hold"} onDone={onDone}
      onSubmit={() => m.mutate({ id: y.id, data: { personId: holder.personId, held: !held, note: note.trim() } })}>
      <NoteField v={note} set={setNote} />
    </FormShell>
  );
}

function ReverseForm({ y, entry, onDone }: { y: YearDetail; entry: PaymentEntry; onDone: () => void }) {
  const inval = useYearInval(y.id);
  const { toast } = useToast();
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const m = useReversePayment({ mutation: { onSuccess: () => { inval(); toast({ title: `Entry #${entry.id} reversed` }); onDone(); } } });
  return (
    <FormShell danger title={`Reverse entry #${entry.id}`} desc={<>Creates a new entry of exactly <b className="num">{fmtCents(`-${entry.amountCents}`)}</b>. The original stays in the ledger.</>}
      error={m.error} pending={m.isPending} valid={/^\d{4}-\d{2}-\d{2}$/.test(date)} disabledReason="Enter a valid reversal date." submit="Reverse entry" onDone={onDone}
      onSubmit={() => m.mutate({ id: y.id, data: { entryId: entry.id, date, note: note.trim() } })}>
      <div className="rounded-md bg-secondary/60 px-3 py-2 text-sm">{entry.kind === "cash" ? "Cash" : "APIC"} {fmtCents(entry.amountCents)} on {fmtDate(entry.date)}{entry.method && ` · ${entry.method}`}</div>
      <Field label="Reversal date"><input type="date" className={inputCls + " num w-48"} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-reversal-date" /></Field>
      <NoteField v={note} set={setNote} />
    </FormShell>
  );
}
