import { useState } from "react";
import { useGetSuiteMenu, getGetSuiteMenuQueryKey, type Session } from "@workspace/api-client-react";
import { Menu, X } from "lucide-react";

// Trusted local geometry only. Remote logoSvg is never rendered.
function FarmMark() {
  return <svg viewBox="0 0 48 30" className="h-7 w-10 shrink-0 text-primary" aria-hidden="true">
    <path fill="currentColor" d="M2 27 12 7l10 20H2Zm13 0L28 1l13 26H15Zm19 0 7-14 7 14H34Z" />
  </svg>;
}

export function SuiteHeader({ session, signOut, signingOut }: {
  session: Session; signOut: () => void; signingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menu = useGetSuiteMenu({ query: { queryKey: getGetSuiteMenuQueryKey(), staleTime: 5 * 60000, refetchInterval: 5 * 60000 } });
  const data = menu.data;
  const tools = (data?.tools ?? []).filter((item) => item.id.toLowerCase() !== "captable");
  const links = (mobile = false) => <>
    {data?.items.map((item) => <a key={item.id} href={item.href}
      className="rounded px-2 py-2 text-sm hover:bg-muted">{item.label}</a>)}
    {!!data?.tools.length && <details className="relative">
      <summary className="cursor-pointer rounded px-2 py-2 text-sm hover:bg-muted">Tools</summary>
      <div className={mobile ? "flex flex-col pl-3" : "absolute right-0 top-full z-50 min-w-40 rounded border bg-background p-2 shadow-md"}>
        {tools.map((item) => <a className="block rounded px-2 py-2 text-sm hover:bg-muted" key={item.id} href={item.href}>{item.label}</a>)}
        <a href={import.meta.env.BASE_URL} aria-current="page" className="block rounded bg-muted px-2 py-2 text-sm font-semibold">Cap Table</a>
      </div>
    </details>}
  </>;
  return <header className="sticky top-0 z-40 border-b border-border bg-background" data-testid="suite-header">
    <nav aria-label="Farm apps" className="flex min-h-14 items-center gap-3 px-4">
      <a className="flex shrink-0 items-center gap-2 font-display text-lg" href={data?.homeHref ?? "https://hwd-main-site.replit.app/"}>
        <FarmMark /><span className="hidden xl:inline">HWD Farm</span><span className="sr-only xl:hidden">HWD Farm Home</span>
      </a>
      <div className="hidden min-w-0 flex-1 items-center gap-1 xl:flex">{links()}</div>
      <a href={import.meta.env.BASE_URL} aria-current="page" className="rounded bg-primary/10 px-2 py-1 text-sm font-semibold text-primary">Cap Table</a>
      <div className="ml-auto hidden items-center gap-3 xl:flex">
        <span className="max-w-40 truncate text-sm">{session.displayName}</span>
        <button onClick={signOut} disabled={signingOut} className="whitespace-nowrap text-sm underline">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <button className="ml-auto rounded p-2 xl:hidden" onClick={() => setOpen(!open)}
        aria-label={open ? "Close Farm menu" : "Open Farm menu"} aria-expanded={open} aria-controls="suite-mobile-menu">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
    </nav>
    {open && <div id="suite-mobile-menu" className="flex flex-col border-t px-4 pb-4 xl:hidden">
      {links(true)}
      {menu.isError && <p className="py-2 text-sm">Navigation is unavailable. Use HWD Farm Home above.</p>}
      <div className="mt-2 flex items-center justify-between border-t pt-3 text-sm">
        <span>{session.displayName}</span>
        <button disabled={signingOut} onClick={signOut} className="underline">{signingOut ? "Signing out…" : "Sign out"}</button>
      </div>
    </div>}
  </header>;
}
