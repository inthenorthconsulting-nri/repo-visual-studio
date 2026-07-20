// Decision-status-axis mapping. Of the three independent status axes on
// ArchitectureDecision (decision_status, implementation_status,
// governance_status), only decision_status is derived directly from a
// document's own declared status text -- the other two are computed
// elsewhere (implementation-state.ts, governance-links.ts) from evidence
// this package never treats as interchangeable with an author's own label.

import type { DecisionStatus } from "./contracts.js";

export const DEFAULT_STATUS_MAPPING: Record<DecisionStatus, string[]> = {
  draft: ["draft"],
  proposed: ["proposed"],
  under_review: ["under review", "under_review", "in review", "in_review"],
  accepted: ["accepted", "approved"],
  rejected: ["rejected", "declined"],
  superseded: ["superseded"],
  deprecated: ["deprecated"],
  withdrawn: ["withdrawn"],
  implemented: ["implemented"],
  partially_implemented: ["partially implemented", "partially_implemented"],
  unknown: [],
};

/**
 * Maps a document's own raw status text to one of the 11 DecisionStatus
 * values, using decisions.yml's configured `status_mapping` merged on top of
 * the built-in defaults (configured entries add to, never replace, the
 * defaults for that status). An unrecognized or absent raw status always
 * maps to "unknown" -- never guessed from surrounding context.
 */
export function mapDecisionStatus(raw: string | undefined, configured: Record<string, string[]> | undefined): DecisionStatus {
  if (!raw) return "unknown";
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return "unknown";

  const merged = mergeStatusMapping(configured);
  for (const [status, values] of Object.entries(merged)) {
    if (values.some((v) => v.trim().toLowerCase() === normalized)) {
      return status as DecisionStatus;
    }
  }
  return "unknown";
}

function mergeStatusMapping(configured: Record<string, string[]> | undefined): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...DEFAULT_STATUS_MAPPING };
  if (!configured) return merged;
  for (const [status, values] of Object.entries(configured)) {
    merged[status] = [...(merged[status] ?? []), ...values];
  }
  return merged;
}
