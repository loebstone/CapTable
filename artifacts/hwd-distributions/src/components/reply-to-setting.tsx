import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMailSettings, useSaveMailSettings, getGetMailSettingsQueryKey, getListAuditQueryKey } from "@workspace/api-client-react";
import { Btn, Field, inputCls, SkeletonRows, ErrorPanel } from "@/components/bits";
import { errMessage } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export function ReplyToSetting() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetMailSettings({ query: { queryKey: getGetMailSettingsQueryKey() } });
  const [v, setV] = useState("");
  const server = q.data?.replyTo ?? "";
  useEffect(() => { setV(server); }, [server]);
  const save = useSaveMailSettings({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetMailSettingsQueryKey() }); qc.invalidateQueries({ queryKey: getListAuditQueryKey() }); toast({ title: "Reply-to saved" }); } } });
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const changed = v.trim() !== server;
  if (q.isLoading) return <SkeletonRows rows={1} />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => q.refetch()} />;
  return (
    <form className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); if (valid && changed) save.mutate({ data: { replyTo: v.trim() } }); }} data-testid="form-reply-to">
      <Field label="Mailing reply-to address" hint="Holder replies to distribution emails go here." error={v && !valid ? "Enter a valid email address." : null}>
        <input type="email" className={inputCls} value={v} onChange={(e) => setV(e.target.value)} data-testid="input-reply-to" />
      </Field>
      <Btn type="submit" disabled={!valid || !changed || save.isPending} disabledReason={save.isPending ? "Saving; please wait." : !valid ? "Enter a valid email address." : "No changes to save."} data-testid="button-save-reply-to">{save.isPending ? "Saving…" : "Save"}</Btn>
      {save.isError && <div className="text-xs text-destructive md:col-span-2" data-testid="text-reply-to-error">{errMessage(save.error)}</div>}
    </form>
  );
}
