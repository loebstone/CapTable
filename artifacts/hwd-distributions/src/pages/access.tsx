import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAccess, useAddAccess, useRemoveAccess, getListAccessQueryKey, getListAuditQueryKey, type AccessEntry } from "@workspace/api-client-react";
import { UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, SkeletonRows, ErrorPanel, Empty, Btn, Field, Tag, inputCls } from "@/components/bits";
import { fmtDate, errMessage } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export default function AccessPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListAccess();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState<AccessEntry | null>(null);
  const inval = () => {
    qc.invalidateQueries({ queryKey: getListAccessQueryKey() });
    qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  };
  const add = useAddAccess({ mutation: { onSuccess: (a) => { inval(); setEmail(""); setNote(""); toast({ title: "Access granted", description: a.displayName }); } } });

  const list = [...(q.data ?? [])].sort((a, b) => Number(!!a.removedAt) - Number(!!b.removedAt) || a.displayName.localeCompare(b.displayName));
  const active = list.filter((a) => !a.removedAt);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && note.trim();

  return (
    <div className="space-y-8">
      <PageHeader kicker="Who can sign in" title="Access">
        Add a family member by email; the server matches the address against the roster. The last person with access cannot be removed.
      </PageHeader>

      <form className="rise grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); if (valid) add.mutate({ data: { email: email.trim(), note: note.trim() } }); }}>
        <Field label="Email"><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-access-email" /></Field>
        <Field label="Note (required)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why access is being given" data-testid="input-access-note" /></Field>
        <Btn type="submit" disabled={!valid || add.isPending} data-testid="button-add-access"><UserPlus className="h-4 w-4" /> {add.isPending ? "Adding…" : "Add"}</Btn>
        {add.isError && <div className="text-xs text-destructive md:col-span-3">{errMessage(add.error)}</div>}
      </form>

      {q.isLoading ? <SkeletonRows rows={4} /> : q.isError ? <ErrorPanel error={q.error} onRetry={() => q.refetch()} /> : list.length === 0 ? (
        <Empty title="No access entries.">No one is listed yet.</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {list.map((a) => (
            <li key={a.id} className={"flex flex-wrap items-center gap-3 px-4 py-3 " + (a.removedAt ? "opacity-60" : "")} data-testid={`row-access-${a.id}`}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">{a.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.displayName}</div>
                <div className="text-xs text-muted-foreground">Added {fmtDate(a.addedAt)} by {a.addedBy} · {a.note}</div>
              </div>
              {a.removedAt ? <Tag>Removed {fmtDate(a.removedAt)}</Tag> : (
                <Btn variant="quiet" className="py-1 text-xs" disabled={active.length <= 1} title={active.length <= 1 ? "The last person with access cannot be removed" : undefined} onClick={() => setRemoving(a)} data-testid={`button-remove-access-${a.id}`}>Remove</Btn>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="bg-card">{removing && <RemoveForm entry={removing} onDone={() => { setRemoving(null); }} onSuccess={inval} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveForm({ entry, onDone, onSuccess }: { entry: AccessEntry; onDone: () => void; onSuccess: () => void }) {
  const [note, setNote] = useState("");
  const { toast } = useToast();
  const rm = useRemoveAccess({ mutation: { onSuccess: () => { onSuccess(); toast({ title: "Access removed", description: entry.displayName }); onDone(); } } });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (note.trim()) rm.mutate({ data: { personId: entry.personId, note: note.trim() } }); }}>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">Remove {entry.displayName}?</DialogTitle>
        <DialogDescription>They will no longer be able to sign in. The entry stays on record with its removal date.</DialogDescription>
      </DialogHeader>
      <Field label="Note (required)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-remove-note" /></Field>
      {rm.isError && <div className="text-xs text-destructive">{errMessage(rm.error)}</div>}
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="quiet" onClick={onDone}>Cancel</Btn>
        <Btn type="submit" variant="danger" disabled={!note.trim() || rm.isPending} data-testid="button-confirm-remove">{rm.isPending ? "Removing…" : "Remove access"}</Btn>
      </div>
    </form>
  );
}
