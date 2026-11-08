import { useLocation } from "wouter";
import { useGetYear, getGetYearQueryKey } from "@workspace/api-client-react";

// Lives in the shell so year subpages (including mailing errors) keep the notice.
export function YearDraftBanner() {
  const [path] = useLocation();
  const id = Number(/^\/years\/(\d+)(?:\/|$)/.exec(path)?.[1]);
  const q = useGetYear(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetYearQueryKey(id) } });
  if (!q.data || q.data.isPractice || q.data.status !== "draft") return null;
  return <div role="note" className="sticky top-14 z-20 mb-6 rounded-md border border-amber-600 bg-amber-100 px-4 py-3 font-medium text-amber-950" data-testid="banner-draft-year">
    Draft — preliminary figures for board guidance. Final figures will follow the Farm's tax filing.
  </div>;
}
