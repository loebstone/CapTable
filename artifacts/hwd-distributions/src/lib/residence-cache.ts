import type { QueryClient } from "@tanstack/react-query";
import { getListResidencesQueryKey, getListAuditQueryKey } from "@workspace/api-client-react";

export function invalidateResidenceViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: getListResidencesQueryKey() });
  qc.invalidateQueries({ queryKey: getListAuditQueryKey() });
  // Draft-year calculations/blockers use current residence; finalized years
  // continue to return their frozen inputs from the server.
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/years/") });
}
