import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSignOut, type Session } from "@workspace/api-client-react";
import { Home, Layers, Archive, MapPin, Percent, KeyRound, ScrollText, LogOut, TreePine } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/years", label: "Distribution years", icon: TreePine },
  { href: "/holdings", label: "Holdings", icon: Layers },
  { href: "/snapshots", label: "Snapshots", icon: Archive },
  { href: "/residences", label: "Tax residence", icon: MapPin },
  { href: "/rates", label: "Annual rates", icon: Percent },
  { href: "/access", label: "Access", icon: KeyRound },
  { href: "/audit", label: "Write history", icon: ScrollText },
];

export function EnvLine({ session }: { session: Session }) {
  return (
    <div className="num flex flex-wrap gap-x-4 gap-y-1 text-[11px]" data-testid="text-environment">
      <span>ENVIRONMENT <b className="font-medium">{session.environment}</b></span>
      <span>db <b className="font-medium">{session.databaseName}</b></span>
      <span>server <b className="font-medium">{session.serverAddress ?? "SQL NULL"}</b></span>
    </div>
  );
}

export function Shell({ session, children }: { session: Session; children: ReactNode }) {
  const [loc, setLoc] = useLocation();
  const qc = useQueryClient();
  const signOut = useSignOut({
    mutation: {
      onSettled: () => {
        qc.clear();
        setLoc("/");
      },
    },
  });

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] md:w-60">
        <div className="px-5 pb-4 pt-6">
          <div className="font-display text-xl text-[hsl(40_40%_97%)]">HWD Farm</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-primary">Distributions ledger</div>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? loc === "/" : loc === href || loc.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                data-testid={`link-nav-${href.slice(1) || "home"}`}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-accent text-[hsl(40_40%_97%)]" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <span className={cn("absolute left-0 top-2 bottom-2 w-0.5 rounded bg-sidebar-primary transition-transform duration-200 origin-center", active ? "scale-y-100" : "scale-y-0")} />
                <Icon className="h-4 w-4 opacity-80" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-sidebar-border px-5 py-4 md:block">
          <div className="text-xs opacity-60">Signed in as</div>
          <div className="text-sm text-[hsl(40_40%_97%)]" data-testid="text-session-name">{session.displayName}</div>
          <button
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            data-testid="button-sign-out"
            className="mt-3 inline-flex items-center gap-2 text-xs text-sidebar-foreground/70 transition-colors hover:text-sidebar-primary"
          >
            <LogOut className="h-3.5 w-3.5" /> {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-2 md:hidden">
          <span className="text-sm">{session.displayName}</span>
          <button onClick={() => signOut.mutate()} className="text-xs text-primary" data-testid="button-sign-out-mobile">Sign out</button>
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-10 md:py-10">{children}</main>
        <footer className="border-t border-border px-5 py-3 text-muted-foreground md:px-10">
          <EnvLine session={session} />
        </footer>
      </div>
    </div>
  );
}
