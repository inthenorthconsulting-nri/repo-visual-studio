// Classifies implementation_status from evidence already gathered by
// links.ts, never from decision age or document wording. "regressed" is
// never assigned here -- detecting that something *was* implemented and
// *no longer is* requires comparing two snapshots over time, which is
// diff.ts/change-classification.ts's job, not a single-snapshot read.
//
// The one distinction this module is careful to preserve: an accepted
// decision with no resolved "implements" evidence is only ever
// "not_started" when upstream artifacts were actually available to check
// (hasUpstreamEvidence) -- when no upstream snapshot existed at all, "no
// way to even ask" resolves to "unverifiable", never to an assumed
// "not_started".

import type { ArchitectureDecision, DecisionImplementationState, DecisionLink } from "./contracts.js";
import { buildImplementationStateId } from "./ids.js";

const NOT_APPLICABLE_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["draft", "proposed", "under_review", "rejected", "withdrawn", "deprecated"]);

export interface ImplementationStateInputs {
  hasUpstreamEvidence: boolean;
}

export function buildDecisionImplementationStates(decisions: ArchitectureDecision[], links: DecisionLink[], inputs: ImplementationStateInputs): DecisionImplementationState[] {
  return decisions
    .map((decision) => buildState(decision, countImplementsEvidence(decision, links), inputs))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function countImplementsEvidence(decision: ArchitectureDecision, links: DecisionLink[]): number {
  return links.filter((l) => l.decision_id === decision.id && l.link_type === "implements" && (l.resolution === "resolved" || l.resolution === "partially_resolved")).length;
}

function buildState(decision: ArchitectureDecision, implementsCount: number, inputs: ImplementationStateInputs): DecisionImplementationState {
  const id = buildImplementationStateId(decision.id);

  if (decision.decision_status === "superseded") {
    return { id, decision_id: decision.id, status: "superseded", detail: `${decision.id} is superseded; implementation relevance passes to its superseder.`, evidence_refs: decision.evidence_refs };
  }

  if (NOT_APPLICABLE_STATUSES.has(decision.decision_status)) {
    return {
      id,
      decision_id: decision.id,
      status: "not_applicable",
      detail: `${decision.id} has decision status "${decision.decision_status}"; implementation status is not applicable until it is accepted.`,
      evidence_refs: decision.evidence_refs,
    };
  }

  if (implementsCount > 0) {
    if (decision.decision_status === "implemented") {
      return { id, decision_id: decision.id, status: "implemented", detail: `${decision.id} is self-declared implemented and has ${implementsCount} resolved implementation link(s).`, evidence_refs: decision.evidence_refs };
    }
    return { id, decision_id: decision.id, status: "partial", detail: `${decision.id} has ${implementsCount} resolved implementation link(s) but is not self-declared fully implemented.`, evidence_refs: decision.evidence_refs };
  }

  if (!inputs.hasUpstreamEvidence) {
    return {
      id,
      decision_id: decision.id,
      status: "unverifiable",
      detail: `${decision.id} is ${decision.decision_status} but no upstream architecture/capability/product/portfolio snapshot was available to check for implementation evidence.`,
      evidence_refs: decision.evidence_refs,
    };
  }

  if (decision.decision_status === "implemented" || decision.decision_status === "partially_implemented") {
    return {
      id,
      decision_id: decision.id,
      status: "unverifiable",
      detail: `${decision.id} is self-declared ${decision.decision_status}, but no resolved implementation link was found in the available upstream artifacts.`,
      evidence_refs: decision.evidence_refs,
    };
  }

  return { id, decision_id: decision.id, status: "not_started", detail: `${decision.id} is accepted with no resolved implementation link found in the available upstream artifacts.`, evidence_refs: decision.evidence_refs };
}
