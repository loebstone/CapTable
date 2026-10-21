import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetHoldings, useFetchHoldings, useTakeSnapshot,
  getGetHoldingsQueryKey, getListSnapshotsQueryKey, getListAuditQueryKey,
} from "@workspace/api-client-react";
import { DownloadCloud, Archive } from "lucide-react";
import { PageHeader, Btn, SkeletonRows, ErrorPanel, Empty, inputCls } from "@/components/bits";
import { HoldingsView } from "@/components/holdings-table";
import { errMessage } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export default function HoldingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetHoldings();
  const [note, setNote] = useState("");

  const fetchH = useFetchHoldings({
    mutation: {
      onSuccess: (h) => {
        qc.setQueryData(getGetHoldingsQueryKey(), { holdings: h });
        qc.invalidateQueries({ queryKey: getGetHoldingsQueryKey() });
        qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
        toast({ title: "Holdings fetched", description: `Fetch #${h.id}, ${h.holdings.length} rows.` });
      },
      onError: (e) => toast({ title: "Fetch failed", description: errMessage(e), variant: "destructive" }),
    },
  });
  const snap = useTakeSnapshot({
    mutation: {
      onSuccess: (s) => {
        setNote("");
        qc.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
        qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
        toast({ title: `Snapshot #${s.id} recorded`, description: `${s.rowCount} rows, total ${s.grandTotal}.` });
      },
      onError: (e) => toast({ title: "Snapshot not saved", description: errMessage(e), variant: "destructive" }),
    },
  });

  const h = q.data?.holdings ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Current shareholdings"
        title="Holdings"
        actions={
          <Btn onClick={() => fetchH.mutate()} disabled={fetchH.isPending} data-testid="button-fetch-holdings">
            <DownloadCloud className="h-4 w-4" /> {fetchH.isPending ? "Fetching…" : "Fetch current holdings"}
          </Btn>
        }
      >
        Holdings are only read from the share register when someone asks. Review a fetch, then record it as an immutable snapshot.
      </PageHeader>

      {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : !h ? (
        <Empty title="Nothing fetched yet." action={<Btn variant="ghost" onClick={() => fetchH.mutate()} disabled={fetchH.isPending} data-testid="button-fetch-empty">Fetch now</Btn>}>
          No holdings have been read from the register on this server. Fetching records who asked and when.
        </Empty>
      ) : (
        <>
          <HoldingsView data={h} />
          <form
            className="rise rise-d3 flex flex-col gap-3 rounded-lg border border-border bg-secondary/50 p-4 md:flex-row md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!snap.isPending) snap.mutate({ data: { fetchId: h.id, note: note.trim() } });
            }}
          >
            <div className="flex-1">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium"><Archive className="h-3.5 w-3.5 text-primary" /> Record fetch #{h.id} as a snapshot</div>
              <input className={inputCls} placeholder="Snapshot note (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-snapshot-note" />
            </div>
            <Btn type="submit" disabled={snap.isPending} data-testid="button-take-snapshot">{snap.isPending ? "Recording…" : "Record snapshot"}</Btn>
          </form>
          <p className="text-xs text-muted-foreground">Snapshots cannot be edited once recorded. <Link href="/snapshots" className="text-primary hover:underline">See history</Link>.</p>
        </>
      )}
    </div>
  );
}
