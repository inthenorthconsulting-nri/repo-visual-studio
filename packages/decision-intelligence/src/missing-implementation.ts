// Reclassifies implementation-state.ts's output into the missing-
// implementation vocabulary. This never auto-fails anything -- whether a
// `implementation_missing` finding should block CI is a policy decision
// made downstream (governance-policy-extension.ts / a configured rule),
// not something this module decides.

import type { DecisionImplementationState, MissingImplementationFinding, MissingImplementationStatus } from "./contracts.js";
import { buildMissingImplementationFindingId } from "./ids.js";

export function detectMissingImplementation(states: DecisionImplementationState[]): MissingImplementationFinding[] {
  const findings: MissingImplementationFinding[] = [];

  for (const state of states) {
    const status = mapStatus(state.status);
    if (!status) continue;
    findings.push({
      id: buildMissingImplementationFindingId(state.decision_id),
      decision_id: state.decision_id,
      status,
      detail: state.detail,
      evidence_refs: state.evidence_refs,
    });
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

function mapStatus(status: DecisionImplementationState["status"]): MissingImplementationStatus | undefined {
  switch (status) {
    case "not_started":
      return "implementation_missing";
    case "partial":
      return "partial";
    case "regressed":
      return "conflicting";
    case "unverifiable":
      return "unverifiable";
    case "implemented":
    case "superseded":
    case "not_applicable":
      return undefined;
    default:
      return undefined;
  }
}
