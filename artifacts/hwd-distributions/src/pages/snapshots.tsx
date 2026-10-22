import { formatShares } from "@workspace/display";
import { Link, useParams } from "wouter";
import { useListSnapshots, useGetSnapshot, getGetSnapshotQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, ChevronRight, Lock } from "lucide-react";
import { PageHeader, SkeletonRows, ErrorPanel, Empty } from "@/components/bits";
import { HoldingsView } from "@/components/holdings-table";
import { fmtDate } from "@/lib/format";

export function SnapshotsPage() {
  const q = useListSnapshots();
  const list = [...(q.data ?? [])].sort((a, b) => b.id - a.id);
  return (
    <div className="space-y-8">
      <PageHeader kicker="Immutable history" title="Snapshots">
        Each snapshot freezes one fetch of the share register. They are kept as recorded and never edited.
      </PageHeader>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title="No snapshots recorded." action={<Link href="/holdings" className="text-sm text-primary hover:underline">Go to holdings</Link>}>
          Fetch current holdings, then record an immutable snapshot. A note is optional.
        </Empty>
      ) : (
        <ol className="relative space-y-2 border-l border-input pl-5">
          {list.map((s, i) => (
            <li key={s.id} className="rise relative" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <span className="absolute -left-[25px] top-5 h-2 w-2 rounded-full bg-primary ring-4 ring-background" />
              <Link href={`/snapshots/${s.id}`} className="group flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40" data-testid={`link-snapshot-${s.id}`}>
                <div className="num w-14 text-xs text-muted-foreground">#{s.id}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.note}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">As of {fmtDate(s.asOf)} · recorded {fmtDate(s.createdAt, true)} by {s.createdBy} · fetch #{s.fetchId}</div>
                </div>
                <div className="hidden text-right md:block">
                  <div className="num text-sm">{formatShares(s.grandTotal)}</div>
                  <div className="text-xs text-muted-foreground">{s.rowCount} rows</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const ok = Number.isInteger(id) && id > 0;
  const q = useGetSnapshot(id, { query: { enabled: ok, queryKey: getGetSnapshotQueryKey(id) } });
  const meta = useListSnapshots().data?.find((s) => s.id === id);
  return (
    <div className="space-y-8">
      <Link href="/snapshots" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary" data-testid="link-back-snapshots">
        <ArrowLeft className="h-3.5 w-3.5" /> All snapshots
      </Link>
      <PageHeader kicker={`Snapshot #${params.id}`} title={meta?.note ?? "Recorded snapshot"}>
        <span className="inline-flex items-center gap-1.5"><Lock className="h-3 w-3" /> Read-only.{meta && ` Recorded ${fmtDate(meta.createdAt, true)} by ${meta.createdBy}.`}</span>
      </PageHeader>
      {!ok ? <Empty title="Not a snapshot number." /> : q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : q.data ? <HoldingsView data={q.data} /> : null}
    </div>
  );
}
