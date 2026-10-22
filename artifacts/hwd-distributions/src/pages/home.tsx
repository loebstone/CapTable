import { formatShares } from "@workspace/display";
import { Link } from "wouter";
import { useGetHoldings, useListYears, useListPracticeYears, getGetHoldingsQueryKey, getListYearsQueryKey } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { PageHeader, SkeletonRows, ErrorPanel, Empty } from "@/components/bits";
import { StatusTag } from "@/pages/years";
import { fmtDate } from "@/lib/format";

const LINKS = [
  { href: "/holdings", label: "Holdings" },
  { href: "/residences", label: "Tax residence" },
  { href: "/rates", label: "Annual rates" },
  { href: "/access", label: "Access list" },
  { href: "/audit", label: "Audit log" },
];

export default function HomePage() {
  const hq = useGetHoldings({ query: { queryKey: getGetHoldingsQueryKey() } });
  const yq = useListYears({ query: { queryKey: getListYearsQueryKey() } });
  const pq = useListPracticeYears();
  const h = hq.data?.holdings ?? null;
  const years = [...(yq.data ?? [])].sort((a, b) => b.calendarYear - a.calendarYear);

  return (
    <div className="space-y-8">
      <PageHeader kicker="HWD Farm" title="Overview" />

      <section className="space-y-3">
        <h2 className="font-display text-xl">Current holdings</h2>
        {hq.isLoading ? <SkeletonRows rows={3} /> : hq.isError ? <ErrorPanel error={hq.error} onRetry={() => hq.refetch()} /> : !h ? (
          <Empty title="No holdings fetched yet." action={<Link href="/holdings" className="text-sm text-primary" data-testid="link-home-fetch">Go to Holdings</Link>} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm" data-testid="table-home-classes">
              <thead className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="text-left"><th className="px-4 py-2 font-medium">Class</th><th className="px-4 py-2 text-right font-medium">Shares</th><th className="px-4 py-2 text-right font-medium">Holders</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...h.classes].sort((a, b) => a.shareClass.localeCompare(b.shareClass)).map((c) => (
                  <tr key={c.shareClass} data-testid={`row-home-class-${c.shareClass}`}>
                    <td className="px-4 py-2">Class {c.shareClass}</td>
                    <td className="num px-4 py-2 text-right">{formatShares(c.totalShares)}</td>
                    <td className="num px-4 py-2 text-right">{c.holderCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-double border-border bg-secondary/40 font-medium">
                <tr><td className="px-4 py-2">Total</td><td className="num px-4 py-2 text-right" data-testid="text-home-total">{formatShares(h.grandTotal)}</td><td className="num px-4 py-2 text-right" title="Distinct holders across Classes" data-testid="text-home-holder-total">{new Set(h.holdings.map((holder) => holder.personId)).size}</td></tr>
              </tfoot>
            </table>
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">As of {fmtDate(h.asOf)} · fetched {fmtDate(h.fetchedAt, true)} · fetch #{h.id}</div>
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="section-home-real-years">
        <h2 className="font-display text-xl">Distribution years</h2>
        {yq.isLoading ? <SkeletonRows rows={3} /> : yq.isError ? <ErrorPanel error={yq.error} onRetry={() => yq.refetch()} /> : years.length === 0 ? (
          <Empty title="No distribution years yet." action={<Link href="/years" className="text-sm text-primary" data-testid="link-home-years">Go to Distribution years</Link>} />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {years.map((y) => (
              <li key={y.id}>
                <Link href={`/years/${y.id}`} className="group flex items-center gap-4 px-4 py-3 hover:bg-secondary/40" data-testid={`link-home-year-${y.id}`}>
                  <span className="font-display text-xl tabular-nums">{y.calendarYear}</span>
                  <StatusTag status={y.status} />
                  <span className="text-xs text-muted-foreground">Opened {fmtDate(y.createdAt)}</span>
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-testid="section-home-practice-years">
        <h2 className="font-display text-xl">Practice years</h2>
        {pq.isLoading ? <SkeletonRows rows={2} /> : pq.isError ? <ErrorPanel error={pq.error} onRetry={() => pq.refetch()} /> : !pq.data?.length ? <Empty title="No practice years yet." /> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {pq.data.map((y) => <li key={y.id}><Link href={`/years/${y.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/40" data-testid={`link-home-practice-${y.id}`}><span className="font-display text-xl">{y.calendarYear} — Practice</span><StatusTag status={y.status} /><ArrowRight className="ml-auto h-4 w-4" /></Link></li>)}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-xl">Records</h2>
        <div className="flex flex-wrap gap-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md border border-input bg-card px-3.5 py-2 text-sm hover:bg-secondary" data-testid={`link-home-${l.href.slice(1)}`}>{l.label}</Link>
          ))}
        </div>
      </section>
    </div>
  );
}
