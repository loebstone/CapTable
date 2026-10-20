import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListYears, useOpenYear, useListSnapshots, useGetHoldings, useFetchHoldings, useTakeSnapshot, useListRates, useCopyRates,
  getListYearsQueryKey, getListSnapshotsQueryKey, getGetHoldingsQueryKey, getListRatesQueryKey, getListAuditQueryKey,
  type YearSummaryStatus,
} from "@workspace/api-client-react";
import { Plus, ArrowRight, RefreshCw, Camera, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, inputCls, Tag } from "@/components/bits";
import { fmtDate, errMessage } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function StatusTag({ status }: { status: YearSummaryStatus }) {
  return <Tag tone={status === "draft" ? "amber" : status === "finalized" ? "lichen" : "rust"}>{status === "draft" ? "Draft" : status === "finalized" ? "Finalized" : "Corrected"}</Tag>;
}

export default function YearsPage() {
  const q = useListYears();
  const [open, setOpen] = useState(false);
  const list = [...(q.data ?? [])].sort((a, b) => b.calendarYear - a.calendarYear);
  return (
    <div className="space-y-8">
      <PageHeader kicker="Timber income" title="Distribution years" actions={<Btn onClick={() => setOpen(true)} data-testid="button-open-year"><Plus className="h-4 w-4" /> Open a year</Btn>}>
        Each year is fixed to one holdings snapshot. Figures are entered with source documents and a per-share amount is declared. Finalization freezes the figures, rates and residences; later changes are noted corrections.
      </PageHeader>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title="No distribution years yet." action={<Btn variant="ghost" onClick={() => setOpen(true)}>Open the first year</Btn>}>
          Opening a year needs a holdings snapshot and that year's rate table.
        </Empty>
      ) : (
        <div className="space-y-2">
          {list.map((y, i) => (
            <Link key={y.id} href={`/years/${y.id}`} className="rise group flex items-center gap-5 rounded-lg border border-border bg-card px-5 py-4 transition-colors hover:border-primary/40" style={{ animationDelay: `${i * 40}ms` }} data-testid={`link-year-${y.id}`}>
              <div className="font-display text-3xl tabular-nums">{y.calendarYear}</div>
              <StatusTag status={y.status} />
              <div className="text-xs text-muted-foreground">Snapshot <span className="num">#{y.snapshotId}</span> · opened {fmtDate(y.createdAt)} by {y.createdBy}</div>
              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-2xl">{open && <OpenYearForm existing={list.map((y) => y.calendarYear)} onDone={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function OpenYearForm({ existing, onDone }: { existing: number[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [snapId, setSnapId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [snapNote, setSnapNote] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const snaps = useListSnapshots();
  const holdings = useGetHoldings();
  const rates = useListRates();
  const inv = () => { qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); };
  const fetchH = useFetchHoldings({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetHoldingsQueryKey() }); inv(); } } });
  const take = useTakeSnapshot({ mutation: { onSuccess: (s) => { qc.invalidateQueries({ queryKey: getListSnapshotsQueryKey() }); inv(); setSnapId(s.id); setSnapNote(""); toast({ title: `Snapshot #${s.id} taken` }); } } });
  const copy = useCopyRates({ mutation: { onSuccess: (t) => { qc.invalidateQueries({ queryKey: getListRatesQueryKey() }); inv(); setCopyNote(""); toast({ title: `Rates copied into ${t.taxYear}`, description: "Review them on Annual rates." }); } } });
  const openY = useOpenYear({ mutation: { onSuccess: (y) => { qc.invalidateQueries({ queryKey: getListYearsQueryKey() }); inv(); toast({ title: `${y.calendarYear} opened` }); onDone(); nav(`/years/${y.id}`); } } });

  const y = Number(year);
  const yearOk = Number.isInteger(y) && y >= 1900 && y <= 9999;
  const dup = existing.includes(y);
  const rateYears = (rates.data ?? []).map((r) => r.taxYear).sort((a, b) => b - a);
  const hasRates = rateYears.includes(y);
  const prior = rateYears.find((r) => r < y) ?? rateYears[0];
  const snapList = [...(snaps.data ?? [])].sort((a, b) => b.id - a.id);
  const current = holdings.data?.holdings;
  const valid = yearOk && !dup && hasRates && snapId && note.trim();

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (valid) openY.mutate({ data: { calendarYear: y, snapshotId: snapId!, note: note.trim() } }); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">Open a distribution year</DialogTitle>
        <DialogDescription>The snapshot is fixed when you open the year. Rates and residences are frozen when you finalize it.</DialogDescription>
      </DialogHeader>
      <Field label="Calendar year" error={dup ? "This year is already open." : !yearOk && year ? "Year 1900–9999" : null}>
        <input className={inputCls + " num w-32"} value={year} maxLength={4} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} data-testid="input-calendar-year" />
      </Field>

      <section className="space-y-2">
        <div className="text-xs font-medium">1 · Rate table</div>
        {rates.isLoading ? <div className="h-10 animate-pulse rounded-md bg-muted" /> : rates.isError ? <ErrorPanel error={rates.error} onRetry={() => rates.refetch()} /> : hasRates ? (
          <div className="rounded-md border border-accent-foreground/20 bg-accent/50 px-3 py-2 text-sm text-accent-foreground" data-testid="status-rates-ok">{y} rates are on file.</div>
        ) : (
          <div className="space-y-3 rounded-md border border-[hsl(38_60%_70%)] bg-[hsl(38_70%_94%)] px-3 py-3 text-sm" data-testid="status-rates-missing">
            <div><b className="font-medium">No {yearOk ? y : ""} rate table.</b> Rates are required before a year can open. <Link href="/rates" className="text-primary underline underline-offset-2" data-testid="link-rates">Enter them on Annual rates</Link>{prior ? <> or copy from {prior}.</> : "."}</div>
            {prior && yearOk && (
              <div className="flex flex-wrap items-end gap-2">
                <input className={inputCls + " flex-1"} placeholder="Note for the copy (required)" value={copyNote} onChange={(e) => setCopyNote(e.target.value)} data-testid="input-copy-rates-note" />
                <Btn type="button" variant="ghost" disabled={!copyNote.trim() || copy.isPending} onClick={() => copy.mutate({ data: { fromYear: prior, toYear: y, note: copyNote.trim() } })} data-testid="button-copy-prior-rates"><Copy className="h-3.5 w-3.5" /> {copy.isPending ? "Copying…" : `Copy ${prior} → ${y}`}</Btn>
              </div>
            )}
            {copy.isError && <div className="text-xs text-destructive">{errMessage(copy.error)}</div>}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs font-medium">2 · Holdings snapshot</div>
        {snaps.isLoading ? <div className="h-24 animate-pulse rounded-md bg-muted" /> : snaps.isError ? <ErrorPanel error={snaps.error} onRetry={() => snaps.refetch()} /> : snapList.length === 0 ? (
          <div className="rounded-md border border-dashed border-input px-3 py-3 text-xs text-muted-foreground">No snapshots yet. Take one below.</div>
        ) : (
          <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {snapList.map((s) => (
              <button type="button" key={s.id} onClick={() => setSnapId(s.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors", snapId === s.id ? "bg-primary/10" : "hover:bg-secondary/60")} data-testid={`button-select-snapshot-${s.id}`}>
                <span className={cn("h-3 w-3 shrink-0 rounded-full border", snapId === s.id ? "border-primary bg-primary" : "border-input")} />
                <span className="num">#{s.id}</span>
                <span className="text-xs text-muted-foreground">as of {fmtDate(s.asOf)} · {s.rowCount} rows · <span className="num">{s.grandTotal}</span> shares</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{s.note}</span>
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2 rounded-md bg-secondary/50 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {holdings.isLoading ? "Checking current holdings…" : current ? <>Latest fetch <span className="num">#{current.id}</span> as of {fmtDate(current.asOf)}, fetched {fmtDate(current.fetchedAt, true)}</> : "No holdings fetched yet."}
            <Btn type="button" variant="quiet" className="ml-auto py-1 text-xs" disabled={fetchH.isPending} onClick={() => fetchH.mutate()} data-testid="button-fetch-holdings"><RefreshCw className={cn("h-3.5 w-3.5", fetchH.isPending && "animate-spin")} /> Fetch fresh</Btn>
          </div>
          {current && (
            <div className="flex flex-wrap gap-2">
              <input className={inputCls + " flex-1"} placeholder="Snapshot note (required)" value={snapNote} onChange={(e) => setSnapNote(e.target.value)} data-testid="input-snapshot-note" />
              <Btn type="button" variant="ghost" disabled={!snapNote.trim() || take.isPending} onClick={() => take.mutate({ data: { fetchId: current.id, note: snapNote.trim() } })} data-testid="button-take-snapshot"><Camera className="h-3.5 w-3.5" /> {take.isPending ? "Taking…" : "Take new snapshot"}</Btn>
            </div>
          )}
          {(fetchH.isError || take.isError) && <div className="text-xs text-destructive">{errMessage(fetchH.error ?? take.error)}</div>}
        </div>
      </section>

      <Field label="Note (required)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-open-note" /></Field>
      {openY.isError && <div className="text-xs text-destructive">{errMessage(openY.error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" disabled={!valid || openY.isPending} data-testid="button-confirm-open-year">{openY.isPending ? "Opening…" : "Open year"}</Btn>
      </div>
    </form>
  );
}
