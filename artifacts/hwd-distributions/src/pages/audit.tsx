import { useState } from "react";
import { useListAudit } from "@workspace/api-client-react";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Tag, inputCls } from "@/components/bits";
import { fmtDate } from "@/lib/format";

export default function AuditPage() {
  const q = useListAudit();
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const list = [...(q.data ?? [])]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .filter((e) => !f || [e.actor, e.entity, e.operation, e.recordId].some((x) => x.toLowerCase().includes(f)));

  return (
    <div className="space-y-8">
      <PageHeader kicker="Write history" title="Every change, in order">
        A permanent list of writes made through this ledger: who, what, and when.
      </PageHeader>
      <input className={inputCls + " max-w-xs"} placeholder="Filter by person, record, operation" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="input-audit-filter" />
      {q.isLoading ? <SkeletonRows rows={8} /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title={f ? "Nothing matches that filter." : "No writes recorded yet."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Who</th>
                <th className="px-3 py-2.5 font-medium">Record</th>
                <th className="px-3 py-2.5 font-medium">Operation</th>
                <th className="px-4 py-2.5 font-medium">Id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((e) => (
                <tr key={e.id} className="hover:bg-secondary/40" data-testid={`row-audit-${e.id}`}>
                  <td className="num whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{fmtDate(e.occurredAt, true)}</td>
                  <td className="px-3 py-2">{e.actor}</td>
                  <td className="px-3 py-2"><Tag tone="lichen">{e.entity}</Tag></td>
                  <td className="px-3 py-2"><Tag tone="rust">{e.operation}</Tag></td>
                  <td className="num px-4 py-2 text-xs text-muted-foreground">{e.recordId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
