import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { errMessage } from "@/lib/format";

export function PageHeader({ kicker, title, children, actions }: { kicker: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="rise flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">{kicker}</div>
        <h1 className="font-display text-3xl text-foreground md:text-4xl">{title}</h1>
        {children && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Btn({ variant = "primary", className, disabledReason, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" | "danger"; disabledReason?: string }) {
  const button = (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-[transform,background-color,color] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" && "border border-input bg-card text-foreground hover:bg-secondary",
        variant === "quiet" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className,
      )}
    />
  );
  if (!p.disabled) return button;
  return <span className={cn("inline-flex flex-col items-start gap-1", className?.includes("w-full") && "w-full")}>
    {button}
    <span className="max-w-sm text-xs font-normal text-muted-foreground" role="note" data-testid={`${p["data-testid" as keyof typeof p] ?? "button"}-disabled-reason`}>{disabledReason || p.title || "Please wait for the current request to finish."}</span>
  </span>;
}

export const inputCls =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="block text-xs text-destructive">{error}</span> : hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="status-loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" data-testid="status-error">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex-1 text-sm">
        <div className="font-medium text-foreground">Could not load this record.</div>
        <div className="mt-0.5 text-muted-foreground">{errMessage(error)}</div>
      </div>
      {onRetry && (
        <Btn variant="ghost" onClick={onRetry} data-testid="button-retry">
          <RotateCw className="h-3.5 w-3.5" /> Retry
        </Btn>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rings rise flex flex-col items-start gap-3 rounded-lg border border-dashed border-input bg-card/60 px-6 py-10" data-testid="status-empty">
      <div className="font-display text-xl text-foreground">{title}</div>
      {children && <p className="max-w-lg text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

export function Tag({ tone = "plain", children }: { tone?: "plain" | "lichen" | "rust" | "amber"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        tone === "plain" && "bg-secondary text-secondary-foreground",
        tone === "lichen" && "bg-accent text-accent-foreground",
        tone === "rust" && "bg-primary/10 text-primary",
        tone === "amber" && "bg-[hsl(38_70%_88%)] text-[hsl(30_60%_28%)]",
      )}
    >
      {children}
    </span>
  );
}
