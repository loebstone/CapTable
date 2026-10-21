import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListRates, useSaveRates, useCopyRates, getListRatesQueryKey, getListAuditQueryKey, getDownloadRatesCsvUrl, type RateTable, type StateRate } from "@workspace/api-client-react";
import { Plus, Copy, Trash2, PencilLine } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, inputCls } from "@/components/bits";
import { fmtDate, errMessage, ratePct, RATE_RE, STATE_RE } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { RatesCsvImport } from "@/components/rates-csv-import";
import { DownloadButton } from "@/components/download-button";

type Mode = { kind: "edit"; base: RateTable | null } | { kind: "copy"; from?: number } | { kind: "import"; year?: number } | null;

export default function RatesPage() {
  const q = useListRates();
  const [mode, setMode] = useState<Mode>(null);
  const list = [...(q.data ?? [])].sort((a, b) => b.taxYear - a.taxYear);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Annual rates"
        title="Capital gains rates by tax year"
        actions={<>
          <Btn variant="ghost" onClick={() => setMode({ kind: "import", year: list[0]?.taxYear })} data-testid="button-import-rates-csv">Import CSV</Btn>
          <Btn variant="ghost" onClick={() => setMode({ kind: "copy", from: list[0]?.taxYear })} disabled={list.length === 0} disabledReason="Create a rate table before copying a year." data-testid="button-copy-rates"><Copy className="h-4 w-4" /> Copy a year</Btn>
          <Btn onClick={() => setMode({ kind: "edit", base: null })} data-testid="button-new-rates"><Plus className="h-4 w-4" /> New year</Btn>
        </>}
      >
        Rates are entered as decimal fractions with four places: 0.1500 means 15%. Nothing is filled in for you; each rate needs its source.
      </PageHeader>

      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title="No rate tables yet." action={<Btn variant="ghost" onClick={() => setMode({ kind: "edit", base: null })}>Enter the first year</Btn>}>
          Add a tax year with the federal rate and each state that applies, citing where each number came from.
        </Empty>
      ) : (
        <div className="space-y-4">
          {list.map((t, i) => (
            <article key={t.id} className="rise overflow-hidden rounded-lg border border-border bg-card" style={{ animationDelay: `${i * 50}ms` }} data-testid={`card-rates-${t.taxYear}`}>
              <div className="flex flex-wrap items-center gap-4 border-b border-border bg-secondary/40 px-4 py-3">
                <div className="font-display text-2xl">{t.taxYear}</div>
                <div className="text-xs text-muted-foreground">Saved {fmtDate(t.createdAt, true)} by {t.createdBy} · {t.note}</div>
                <DownloadButton url={getDownloadRatesCsvUrl(t.taxYear)} fallbackName={`HWD_Rates_${t.taxYear}.csv`} variant="quiet" className="py-1 text-xs" testId={`button-download-rates-csv-${t.taxYear}`}>Download CSV</DownloadButton>
                <Btn variant="ghost" className="py-1 text-xs" onClick={() => setMode({ kind: "import", year: t.taxYear })} data-testid={`button-import-rates-csv-${t.taxYear}`}>Import CSV</Btn>
                <Btn variant="ghost" className="ml-auto py-1 text-xs" onClick={() => setMode({ kind: "edit", base: t })} data-testid={`button-correct-rates-${t.taxYear}`}><PencilLine className="h-3.5 w-3.5" /> Correct</Btn>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <RateRow label="Federal" rate={t.federalRate} source={t.federalSourceNote ?? ""} />
                  {t.states.map((s) => <RateRow key={s.stateCode} label={s.stateCode} rate={s.rate} source={s.sourceNote ?? ""} />)}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      )}

      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-2xl">
          {mode?.kind === "edit" && <RateForm base={mode.base} onDone={() => setMode(null)} />}
          {mode?.kind === "copy" && <CopyForm from={mode.from} years={list.map((t) => t.taxYear)} onDone={() => setMode(null)} />}
          {mode?.kind === "import" && <RatesCsvImport initialYear={mode.year} onDone={() => setMode(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RateRow({ label, rate, source }: { label: string; rate: string; source: string }) {
  return (
    <tr className="hover:bg-secondary/40">
      <td className="num w-24 px-4 py-2 font-medium">{label}</td>
      <td className="num w-24 px-3 py-2 text-right">{rate}</td>
      <td className="w-20 px-3 py-2 text-xs text-muted-foreground">{ratePct(rate)}</td>
      <td className="px-4 py-2 text-xs text-muted-foreground">{source}</td>
    </tr>
  );
}

function useRateInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getListRatesQueryKey() });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
}

function RateForm({ base, onDone }: { base: RateTable | null; onDone: () => void }) {
  const { toast } = useToast();
  const inval = useRateInvalidate();
  const [year, setYear] = useState(base ? String(base.taxYear) : "");
  const [fed, setFed] = useState(base?.federalRate ?? "");
  const [fedSrc, setFedSrc] = useState(base?.federalSourceNote ?? "");
  const [states, setStates] = useState<StateRate[]>(base?.states.map((s) => ({ ...s })) ?? []);
  const [note, setNote] = useState("");
  const save = useSaveRates({ mutation: { onSuccess: (t) => { inval(); toast({ title: `${t.taxYear} rates saved` }); onDone(); } } });

  const y = Number(year);
  const yearOk = Number.isInteger(y) && y >= 1900 && y <= 9999;
  const stateErr = (s: StateRate) =>
    !STATE_RE.test(s.stateCode) ? "State code" : !RATE_RE.test(s.rate) ? "Rate format 0.0000" : s.stateCode === "NONE" && s.rate !== "0.0000" ? "NONE must be 0.0000" : null;
  const dupe = new Set(states.map((s) => s.stateCode)).size !== states.length;
  const valid = yearOk && RATE_RE.test(fed) && !dupe && states.every((s) => !stateErr(s));
  const upd = (i: number, p: Partial<StateRate>) => setStates((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      if (valid) save.mutate({ data: { taxYear: y, federalRate: fed, federalSourceNote: fedSrc.trim(), states: states.map((s) => ({ ...s, sourceNote: s.sourceNote?.trim() ?? "" })), note: note.trim() } });
    }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">{base ? `Correct ${base.taxYear} rates` : "New tax year"}</DialogTitle>
        <DialogDescription>Four decimal places as a fraction: 0.1500 = 15.00%. The previous version stays in the write history.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-[110px_130px_1fr]">
        <Field label="Tax year" hint={base ? "The year is fixed when revising its rates." : undefined}><input className={inputCls + " num"} value={year} disabled={!!base} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} maxLength={4} data-testid="input-tax-year" /></Field>
        <Field label="Federal rate" hint={ratePct(fed) ?? undefined} error={fed && !RATE_RE.test(fed) ? "Format 0.0000" : null}>
          <input className={inputCls + " num"} value={fed} onChange={(e) => setFed(e.target.value.trim())} placeholder="0.0000" data-testid="input-federal-rate" />
        </Field>
        <Field label="Federal source (optional)"><input className={inputCls} value={fedSrc} onChange={(e) => setFedSrc(e.target.value)} placeholder="Where this rate comes from (optional)" data-testid="input-federal-source" /></Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">State rates</span>
          <Btn type="button" variant="quiet" className="py-1 text-xs" onClick={() => setStates((x) => [...x, { stateCode: "", rate: "", sourceNote: "" }])} data-testid="button-add-state"><Plus className="h-3.5 w-3.5" /> Add state</Btn>
        </div>
        {states.length === 0 && <div className="rounded-md border border-dashed border-input px-3 py-3 text-xs text-muted-foreground">No states entered. Add each state where a shareholder files, or NONE at 0.0000.</div>}
        {states.map((s, i) => {
          const err = (s.stateCode || s.rate || s.sourceNote) ? stateErr(s) : null;
          return (
            <div key={i} className="grid grid-cols-[70px_100px_1fr_32px] items-start gap-2" data-testid={`row-state-rate-${i}`}>
              <input className={inputCls + " num uppercase"} maxLength={4} value={s.stateCode} onChange={(e) => upd(i, { stateCode: e.target.value.toUpperCase().trim() })} placeholder="ST" data-testid={`input-state-${i}`} />
              <div>
                <input className={inputCls + " num"} value={s.rate} onChange={(e) => upd(i, { rate: e.target.value.trim() })} placeholder="0.0000" data-testid={`input-state-rate-${i}`} />
                <div className="mt-0.5 text-[11px] text-muted-foreground">{ratePct(s.rate) ?? ""}</div>
              </div>
              <div>
                <input className={inputCls} value={s.sourceNote} onChange={(e) => upd(i, { sourceNote: e.target.value })} placeholder="Source (optional)" data-testid={`input-state-source-${i}`} />
                {err && <div className="mt-0.5 text-[11px] text-destructive">{err}</div>}
              </div>
              <button type="button" className="mt-2 text-muted-foreground transition-colors hover:text-destructive" onClick={() => setStates((x) => x.filter((_, j) => j !== i))} aria-label="Remove state" data-testid={`button-remove-state-${i}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
        {dupe && <div className="text-xs text-destructive">Each state may appear once.</div>}
      </div>

      <Field label="Note (optional)" hint="Optional context for this year's table or revision.">
        <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-rates-note" />
      </Field>
      {save.isError && <div className="text-xs text-destructive">{errMessage(save.error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" disabled={!valid || save.isPending} disabledReason={save.isPending ? "Saving rates; please wait." : !yearOk ? "Enter a tax year from 1900 to 9999." : dupe ? "Use only one row for each state code." : "Enter valid rate fractions in 0.0000 format; check each state code and keep NONE at 0.0000."} data-testid="button-save-rates">{save.isPending ? "Saving…" : "Save rates"}</Btn>
      </div>
    </form>
  );
}

function CopyForm({ from, years, onDone }: { from?: number; years: number[]; onDone: () => void }) {
  const { toast } = useToast();
  const inval = useRateInvalidate();
  const [fromY, setFromY] = useState(from ? String(from) : "");
  const [toY, setToY] = useState("");
  const [note, setNote] = useState("");
  const copy = useCopyRates({ mutation: { onSuccess: (t) => { inval(); toast({ title: `Copied into ${t.taxYear}`, description: "Review each rate before relying on it." }); onDone(); } } });
  const f = Number(fromY), t = Number(toY);
  const valid = years.includes(f) && t >= 1900 && t <= 9999 && t > f && !years.includes(t);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) copy.mutate({ data: { fromYear: f, toYear: t, note: note.trim() } }); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">Copy a year's rates</DialogTitle>
        <DialogDescription>Starts a new year from an existing table. Correct anything that changed afterwards.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From year">
          <select className={inputCls + " num"} value={fromY} onChange={(e) => setFromY(e.target.value)} data-testid="select-from-year">
            <option value="">Choose…</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="To year"><input className={inputCls + " num"} value={toY} maxLength={4} onChange={(e) => setToY(e.target.value.replace(/\D/g, ""))} data-testid="input-to-year" /></Field>
      </div>
      <Field label="Note (optional)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-copy-note" /></Field>
      {copy.isError && <div className="text-xs text-destructive">{errMessage(copy.error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" disabled={!valid || copy.isPending} disabledReason={copy.isPending ? "Copying rates; please wait." : !years.includes(f) ? "Select an existing source year." : years.includes(t) ? "The destination already has a rate table." : "Enter a later destination year from 1900 to 9999."} data-testid="button-confirm-copy">{copy.isPending ? "Copying…" : "Copy rates"}</Btn>
      </div>
    </form>
  );
}
