import type { Holdings } from "@workspace/api-client-react";
import { formatShares } from "@workspace/display";
import { fmtDate } from "@/lib/format";
import { Tag } from "@/components/bits";

export function HoldingsView({ data }: { data: Holdings }) {
  const rows = [...data.holdings].sort((a, b) => a.shareClass.localeCompare(b.shareClass) || a.displayName.localeCompare(b.displayName));
  return (
    <div className="space-y-6">
      <div className="rise rise-d1 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-6">
        <div className="col-span-2 bg-sidebar p-4 text-sidebar-foreground">
          <div className="text-[11px] uppercase tracking-[0.16em] opacity-70">Total shares outstanding</div>
          <div className="num mt-1 text-2xl text-[hsl(40_40%_97%)]" data-testid="text-grand-total">{formatShares(data.grandTotal)}</div>
          <div className="mt-2 text-xs opacity-70">As of {fmtDate(data.asOf)} · fetched {fmtDate(data.fetchedAt, true)} · fetch #{data.id}</div>
        </div>
        {data.classes.map((c) => (
          <div key={c.shareClass} className="bg-card p-4" data-testid={`card-class-${c.shareClass}`}>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-lg">Class {c.shareClass}</span>
              <span className="text-xs text-muted-foreground">{c.holderCount} {c.holderCount === 1 ? "holder" : "holders"}</span>
            </div>
            <div className="num mt-1 text-sm">{formatShares(c.totalShares)}</div>
          </div>
        ))}
      </div>

      <div className="rise rise-d2 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Shareholder</th>
              <th className="px-3 py-2.5 font-medium">Class</th>
              <th className="px-3 py-2.5 text-right font-medium">Shares</th>
              <th className="px-3 py-2.5 font-medium">Address state</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">This fetch returned no holding rows.</td></tr>
            )}
            {rows.map((h, i) => (
              <tr key={`${h.personId}-${h.shareClass}-${i}`} className="transition-colors hover:bg-secondary/50" data-testid={`row-holding-${h.personId}-${h.shareClass}`}>
                <td className="px-4 py-2.5 font-medium">{h.displayName}</td>
                <td className="px-3 py-2.5"><Tag tone="lichen">{h.shareClass}</Tag></td>
                <td className="num px-3 py-2.5 text-right">{formatShares(h.shares)}</td>
                <td className="num px-3 py-2.5 text-muted-foreground">{h.addressState ?? "—"}</td>
                <td className="px-3 py-2.5">{h.isUnsettled ? <Tag>Unsettled</Tag> : <span className="text-muted-foreground">Settled</span>}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{h.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
