// Draft -> classify claim pipeline, mirroring
// @rvs/governance-intelligence/src/claims.ts's shape (ordered structural
// gates first, a claim-type-specific check last, then a qualifier pass) but
// built entirely around this package's own contracts and its own closed
// DecisionClaimRejectionCode vocabulary (contracts.ts, spec S43) -- never
// governance's or portfolio's rejection codes.
//
// Unlike governance's GovernanceClaimType, contracts.ts deliberately leaves
// DecisionClaimDraft.claim_type as a plain `string` (not a closed union) so a
// caller can draft an arbitrary claim. classifyDecisionClaim() only *acts* on
// the RecognizedDecisionClaimType literals below; an unrecognized claim_type
// still passes through every unconditional structural gate, it just never
// triggers a claim-type-specific rejection since this module has no basis to
// know what an unrecognized claim asserts (gate-first: unknown is never
// silently treated as "nothing to check").
//
// Gate ordering (each gate *collects* into `rejection_codes` rather than
// short-circuiting -- these are independent structural facts about the
// subject decision that can co-occur, and DecisionClaim.rejection_codes is a
// array precisely so more than one can be surfaced at once):
//   1. snapshot compatibility (partial -> partial_snapshot; unavailable ->
//      incompatible_upstream_artifact)
//   2. zero evidence anywhere (missing_decision_evidence)
//   3. decision embroiled in a supersession issue (broken_supersession)
//   4. decision has a contradicted assumption (contradicted_assumption)
//   5. decision embroiled in a non-resolved conflict (unresolved_conflict)
//   6. exactly one claim-type-specific check (approval / implementation /
//      quality / safety / link-domain), producing at most one further code
// A claim with zero collected codes is "approved", unless a softer signal
// (a weakened/unverifiable -- not contradicted -- assumption, or a
// partially_resolved/ambiguous -- not unresolved -- link for the subject
// decision) is present, in which case it is "qualified": DecisionClaim has
// no separate free-text qualifier field, so "qualified" status is itself the
// caveat signal: rejection_codes stays empty precisely because none of the
// 14 codes describe a merely-soft finding.

import type { ArchitectureDecision, DecisionAssumption, DecisionClaim, DecisionClaimDraft, DecisionClaimRejectionCode, DecisionConflict, DecisionLink, DecisionLinkTargetDomain, DecisionSnapshotCompatibilityStatus, DecisionSupersessionIssue } from "./contracts.js";
import { buildClaimId } from "./ids.js";

export type RecognizedDecisionClaimType =
  | "decision_approved"
  | "decision_implemented"
  | "decision_quality"
  | "decision_safety"
  | "architecture_linked"
  | "capability_linked"
  | "governance_linked"
  | "assumptions_hold"
  | "no_unresolved_conflicts"
  | "supersession_valid";

export interface DecisionClaimContext {
  decisionsById: Map<string, ArchitectureDecision>;
  assumptions: DecisionAssumption[];
  conflicts: DecisionConflict[];
  supersessionIssues: DecisionSupersessionIssue[];
  links: DecisionLink[];
  snapshotCompatibility: DecisionSnapshotCompatibilityStatus;
}

const LINK_DOMAIN_BY_CLAIM_TYPE: Partial<Record<RecognizedDecisionClaimType, DecisionLinkTargetDomain>> = {
  architecture_linked: "architecture",
  capability_linked: "capability",
  governance_linked: "governance",
};

const MISSING_LINK_CODE_BY_CLAIM_TYPE: Partial<Record<RecognizedDecisionClaimType, DecisionClaimRejectionCode>> = {
  architecture_linked: "missing_architecture_link",
  capability_linked: "missing_capability_link",
  governance_linked: "missing_governance_link",
};

function sortedUniqueCodes(codes: DecisionClaimRejectionCode[]): DecisionClaimRejectionCode[] {
  return [...new Set(codes)].sort();
}

function checkCompatibilityGate(context: DecisionClaimContext): DecisionClaimRejectionCode[] {
  if (context.snapshotCompatibility === "partial") return ["partial_snapshot"];
  if (context.snapshotCompatibility === "unavailable") return ["incompatible_upstream_artifact"];
  return [];
}

function checkEvidenceGate(draft: DecisionClaimDraft, decision: ArchitectureDecision | undefined): DecisionClaimRejectionCode[] {
  const decisionEvidence = decision?.evidence_refs ?? [];
  if (decisionEvidence.length === 0 && draft.evidence_refs.length === 0) return ["missing_decision_evidence"];
  return [];
}

function checkSupersessionGate(subjectDecisionId: string, context: DecisionClaimContext): DecisionClaimRejectionCode[] {
  const embroiled = context.supersessionIssues.some((issue) => issue.decision_ids.includes(subjectDecisionId));
  return embroiled ? ["broken_supersession"] : [];
}

function checkContradictedAssumptionGate(subjectDecisionId: string, context: DecisionClaimContext): DecisionClaimRejectionCode[] {
  const contradicted = context.assumptions.some((assumption) => assumption.decision_id === subjectDecisionId && assumption.state === "contradicted");
  return contradicted ? ["contradicted_assumption"] : [];
}

function checkUnresolvedConflictGate(subjectDecisionId: string, context: DecisionClaimContext): DecisionClaimRejectionCode[] {
  const unresolved = context.conflicts.some((conflict) => conflict.decision_ids.includes(subjectDecisionId) && conflict.status !== "resolved");
  return unresolved ? ["unresolved_conflict"] : [];
}

function checkClaimTypeSpecific(claimType: string, decision: ArchitectureDecision | undefined, context: DecisionClaimContext, subjectDecisionId: string): DecisionClaimRejectionCode[] {
  switch (claimType as RecognizedDecisionClaimType) {
    case "decision_approved": {
      if (!decision) return ["unsupported_approval_claim"];
      const accepted: ArchitectureDecision["decision_status"][] = ["accepted", "implemented", "partially_implemented"];
      return accepted.includes(decision.decision_status) ? [] : ["unsupported_approval_claim"];
    }
    case "decision_implemented": {
      if (!decision) return ["unresolved_implementation_state"];
      if (decision.implementation_status === "unverifiable") return ["unresolved_implementation_state"];
      return decision.implementation_status === "implemented" ? [] : ["unsupported_implementation_claim"];
    }
    case "decision_quality":
      // RVS never computes a subjective decision-quality judgement -- any claim
      // asserting one is structurally unsupportable, always (spec: disclosed scope trim).
      return ["unsupported_quality_claim"];
    case "decision_safety":
      // Same reasoning as decision_quality: no structural "safety" signal exists to check.
      return ["unsupported_safety_claim"];
    case "architecture_linked":
    case "capability_linked":
    case "governance_linked": {
      const domain = LINK_DOMAIN_BY_CLAIM_TYPE[claimType as RecognizedDecisionClaimType]!;
      const code = MISSING_LINK_CODE_BY_CLAIM_TYPE[claimType as RecognizedDecisionClaimType]!;
      const resolved = context.links.some((link) => link.decision_id === subjectDecisionId && link.target_domain === domain && link.resolution === "resolved");
      return resolved ? [] : [code];
    }
    case "assumptions_hold":
    case "no_unresolved_conflicts":
    case "supersession_valid":
      // Fully covered by the unconditional gates above -- no additional code.
      return [];
    default:
      return [];
  }
}

function hasQualifyingSoftSignal(subjectDecisionId: string, context: DecisionClaimContext): boolean {
  const softAssumption = context.assumptions.some((assumption) => assumption.decision_id === subjectDecisionId && (assumption.state === "weakened" || assumption.state === "unverifiable"));
  const softLink = context.links.some((link) => link.decision_id === subjectDecisionId && (link.resolution === "partially_resolved" || link.resolution === "ambiguous"));
  return softAssumption || softLink;
}

export function classifyDecisionClaim(draft: DecisionClaimDraft, context: DecisionClaimContext): DecisionClaim {
  const decision = context.decisionsById.get(draft.subject_decision_id);

  const codes = sortedUniqueCodes([
    ...checkCompatibilityGate(context),
    ...checkEvidenceGate(draft, decision),
    ...checkSupersessionGate(draft.subject_decision_id, context),
    ...checkContradictedAssumptionGate(draft.subject_decision_id, context),
    ...checkUnresolvedConflictGate(draft.subject_decision_id, context),
    ...checkClaimTypeSpecific(draft.claim_type, decision, context, draft.subject_decision_id),
  ]);

  const status = codes.length > 0 ? "rejected" : hasQualifyingSoftSignal(draft.subject_decision_id, context) ? "qualified" : "approved";

  return {
    id: buildClaimId(draft.claim_type, draft.subject_decision_id),
    claim_type: draft.claim_type,
    subject_decision_id: draft.subject_decision_id,
    statement: draft.statement,
    status,
    rejection_codes: codes,
    evidence_refs: draft.evidence_refs,
  };
}

/** Exactly 5 fixed claim drafts per decision, matching the universally-applicable (link-domain-agnostic) RecognizedDecisionClaimType entries. */
export function draftStandardDecisionClaims(decision: ArchitectureDecision): DecisionClaimDraft[] {
  const statements: Record<string, string> = {
    decision_approved: `Decision "${decision.id}" has been approved.`,
    decision_implemented: `Decision "${decision.id}" has been implemented.`,
    assumptions_hold: `Decision "${decision.id}"'s assumptions still hold.`,
    no_unresolved_conflicts: `Decision "${decision.id}" has no unresolved conflicts.`,
    supersession_valid: `Decision "${decision.id}"'s supersession relationships are valid.`,
  };

  return Object.entries(statements).map(([claimType, statement]) => ({
    claim_type: claimType,
    subject_decision_id: decision.id,
    statement,
    evidence_refs: decision.evidence_refs,
  }));
}
