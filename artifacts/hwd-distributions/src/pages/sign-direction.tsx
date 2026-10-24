import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSigningSession, useSignDirection, getGetSigningSessionQueryKey, type SigningSession } from "@workspace/api-client-react";
import { fmtCents, parseDollars, centsToInput } from "@/lib/money";
import { errMessage } from "@/lib/format";
import { inputCls } from "@/components/bits";
import { cn } from "@/lib/utils";

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function fill(text: string, s: SigningSession, name: string, amountCents: string | null) {
  const map: Record<string, string> = {
    "[Full name]": s.holderName,
    "[amount]": amountCents === null ? "[amount]" : fmtCents(amountCents).replace(/^\$/, ""),
    "[board approval date]": s.boardApprovalDate,
    "[Typed full name]": name.trim() || "[Typed full name]",
    "[date of signing]": nyToday(),
  };
  return text.replace(/\[(Full name|amount|board approval date|Typed full name|date of signing)\]/g, (m) => map[m] ?? m);
}

const PRACTICE = <div role="note" className="rounded-md border border-amber-600 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950" data-testid="banner-practice-signing">Practice year — nothing here is a real distribution</div>;

export default function SignDirectionPage() {
  const q = useGetSigningSession({ query: { queryKey: getGetSigningSessionQueryKey(), retry: false } });
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-5 sm:py-10">
      <div className="mx-auto max-w-2xl">
        {q.isLoading ? <div className="space-y-3"><div className="h-8 w-2/3 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>
          : q.isError || !q.data ? <p className="py-20 text-center text-base text-muted-foreground" data-testid="text-session-invalid">This signing link is no longer valid.</p>
          : <Doc s={q.data} />}
      </div>
    </main>
  );
}

function Doc({ s }: { s: SigningSession }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(centsToInput(s.amountCents));
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const sign = useSignDirection({ mutation: { onSuccess: (r) => qc.setQueryData(getGetSigningSessionQueryKey(), r) } });
  const cents = parseDollars(amount);
  const amountOk = cents !== null && BigInt(cents) <= BigInt(s.maxAmountCents);
  const can = amountOk && name.trim().length > 0 && consent && !sign.isPending;

  if (s.state === "signed") return (
    <div className="space-y-4">
      {s.isPractice && PRACTICE}
      <div className="rounded-lg border border-border bg-card p-5" data-testid="panel-signed">
        <div className="font-display text-2xl">Signed</div>
        <div className="mt-1 text-sm"><span className="num">{s.signedAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(s.signedAt)) : ""}</span> · <span className="num">{fmtCents(s.amountCents)}</span></div>
        {s.receiptResult !== undefined && s.receiptResult !== "sent" && <p className="mt-3 text-sm text-muted-foreground" role="note" data-testid="text-receipt-notice">Your signature is recorded, but we could not confirm that the receipt email was delivered. You may request a copy from the Corporation.</p>}
      </div>
    </div>
  );

  const filled = fill(s.templateText, s, name, amountOk ? cents : null);
  const split = filled.indexOf("\n\n");
  const head = (split >= 0 ? filled.slice(0, split) : "").split("\n");
  const body = split >= 0 ? filled.slice(split + 2) : filled;
  const [issuer, heading, ...sub] = head;

  return (
    <article className="space-y-4">
      {s.isPractice && PRACTICE}
      {split >= 0 && (
        <header>
          {issuer && <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground" data-testid="text-issuer">{issuer}</div>}
          {heading && <h1 className="font-display text-2xl leading-tight sm:text-3xl">{heading}</h1>}
          {sub.length > 0 && <p className="text-sm text-muted-foreground">{sub.join("\n")}</p>}
        </header>
      )}
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 font-serif text-[15px] leading-relaxed" data-testid="text-document">{body}</div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (can && cents) sign.mutate({ data: { amountCents: cents, fullName: name.trim(), consent: true } }); }}>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
          <label className="block space-y-1 text-xs"><span className="font-medium">Amount (USD)</span>
            <input className={cn(inputCls, "num text-base")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-amount" />
          </label>
          <label className="block space-y-1 text-xs"><span className="font-medium">Full name</span>
            <input className={cn(inputCls, "text-base")} maxLength={160} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-full-name" />
          </label>
        </div>
        {!amountOk && <div className="text-xs text-destructive">Enter a valid amount up to your distribution.</div>}
        <label className="flex items-start gap-3 text-sm leading-snug">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="checkbox-consent" />
          <span>{s.consentText}</span>
        </label>
        {sign.isError && <div className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-sign-error">{errMessage(sign.error)}</div>}
        <button type="submit" disabled={!can} aria-describedby={!can ? "sign-disabled-reason" : undefined} className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-sign">{sign.isPending ? "Signing…" : "Sign"}</button>
        {!can && <p id="sign-disabled-reason" className="text-xs text-muted-foreground">{sign.isPending ? "Signing; please wait." : !amountOk ? "Enter a valid amount." : !name.trim() ? "Enter your full name." : "Check the electronic signature consent box."}</p>}
      </form>
    </article>
  );
}
