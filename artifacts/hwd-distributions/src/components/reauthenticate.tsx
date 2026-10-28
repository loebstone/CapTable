import { useEffect, useState } from "react";

export function isReauthentication(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "reauthenticate";
}
export function reportReauthentication(error: unknown) {
  if (isReauthentication(error)) window.dispatchEvent(new CustomEvent("hwd-reauthenticate", {
    detail: (error as { message: string }).message,
  }));
}
export function rosterEntry(fresh = false) {
  const path = window.location.pathname + window.location.search;
  return `${import.meta.env.BASE_URL}api/auth/roster?${new URLSearchParams({ to: path, ...(fresh ? { fresh: "1" } : {}) })}`;
}
export function ReauthenticationMessage() {
  return <div className="mx-auto max-w-lg space-y-4 px-6 py-24" role="alert">
    <h1 className="font-display text-2xl">Please verify your identity again</h1>
    <p>For this step we need to confirm it's you — we'll email you a fresh link.</p>
    <a className="inline-block rounded bg-primary px-4 py-3 text-primary-foreground" href={rosterEntry(true)}>Confirm it's me</a>
  </div>;
}
export function ReauthenticationPrompt() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const show = () => setStale(true);
    window.addEventListener("hwd-reauthenticate", show);
    return () => window.removeEventListener("hwd-reauthenticate", show);
  }, []);
  if (!stale) return null;
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-background/95" role="dialog" aria-modal="true" aria-label="Verify your identity">
    <ReauthenticationMessage />
    <button className="mx-auto block underline" onClick={() => setStale(false)}>Return without submitting</button>
  </div>;
}
