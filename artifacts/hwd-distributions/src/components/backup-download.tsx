import { Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getBackupConfirmationUrl, getListAuditQueryKey } from "@workspace/api-client-react";

export function BackupDownload() {
  const qc = useQueryClient();
  return <section className="space-y-3 rounded-lg border border-border bg-card p-5">
    <h2 className="font-display text-xl">On-demand backup</h2>
    <p className="max-w-2xl text-sm text-muted-foreground">Download all database records and attached source documents. This contains private family information: keep it secure. The maximum archive size is 500 MB; nothing is stored by the app.</p>
    <a href={getBackupConfirmationUrl()} target="_blank" rel="noopener noreferrer" onClick={() => qc.removeQueries({ queryKey: getListAuditQueryKey() })} className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm hover:bg-secondary" data-testid="button-download-backup"><Download className="h-4 w-4" /> Download backup</a>
    <p className="text-xs text-muted-foreground">Opens a confirmation page in a new tab. After confirmation, the browser streams the download directly to a file, without loading the ZIP into this page.</p>
  </section>;
}
