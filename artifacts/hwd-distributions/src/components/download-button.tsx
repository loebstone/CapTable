import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey } from "@workspace/api-client-react";
import { Download, Loader2 } from "lucide-react";
import { Btn } from "@/components/bits";

function filenameFrom(header: string | null, fallback: string) {
  if (!header) return fallback;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m?.[1]?.trim() || fallback;
}

async function readError(res: Response) {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { message?: unknown; error?: unknown };
      if (typeof j.message === "string") return j.message;
      if (typeof j.error === "string") return j.error;
    } catch { /* not JSON */ }
    if (text && text.length < 300 && !/^\s*</.test(text)) return text;
  } catch { /* ignore */ }
  return `Download failed (${res.status}).`;
}

export function DownloadButton({ url, fallbackName, children, busyLabel = "Preparing…", variant = "ghost", className, testId, disabled }: {
  url: string; fallbackName: string; children: ReactNode; busyLabel?: string; variant?: "primary" | "ghost" | "quiet"; className?: string; testId: string; disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetSessionQueryKey()[0] });
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        setErr("Your session has ended. Sign in again.");
        return;
      }
      if (!res.ok) { setErr(await readError(res)); return; }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filenameFrom(res.headers.get("Content-Disposition"), fallbackName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Btn type="button" variant={variant} className={className} disabled={busy || disabled} onClick={run} aria-busy={busy} data-testid={testId}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {busy ? busyLabel : children}
      </Btn>
      {err && <span role="alert" className="max-w-xs text-xs text-destructive" data-testid={`${testId}-error`}>{err}</span>}
    </span>
  );
}
