// Builds the DecisionGovernanceContextEcho value (spec §36-38) that a CLI
// caller passes into @rvs/governance-intelligence's `evaluatePolicy()` as its
// optional `decisionChanges` domain -- and ONLY when a decision snapshot was
// actually built for this comparison; when no decision artifacts exist, the
// caller simply omits this altogether and governance evaluation is
// byte-identical to pre-Milestone-8 behavior (see governance-intelligence's
// own DecisionGovernanceContext doc comment). This module never imports
// @rvs/governance-intelligence -- it only assembles a structurally
// compatible plain object from decision-intelligence's own already-computed
// artifacts (missing-decisions.ts, assumptions.ts, conflicts.ts,
// governance-links.ts, decision-drift.ts), each of which is itself
// deterministic, so this synthesis step introduces no new nondeterminism of
// its own.
//
// Field-by-field derivation (each intentionally the most specific already-
// computed fact available, never re-derived from scratch here):
//   - changes_missing_decision: MissingDecisionFinding.affected_entity_id,
//     i.e. the changed upstream entity ids missing-decisions.ts already
//     determined have no resolved link to an accepted/implemented decision.
//   - decisions_with_contradicted_assumptions: decision_id of every
//     DecisionAssumption whose own `state` is "contradicted".
//   - decisions_active_and_superseded: decision_ids from every DecisionConflict
//     of kind "active_and_superseded_simultaneously" -- conflicts.ts already
//     detects exactly this condition (an active-status decision reciprocally
//     superseded_by another active decision).
//   - exceptions_with_invalid_decision_ref: decision_id of every DecisionLink
//     governance-links.ts produced with link_type "excepts" and target_domain
//     "governance" whose resolution is NOT "resolved" -- i.e. every
//     decision_ref a governance exception named that governance-links.ts
//     could not confirm (missing decision, wrong status, expired, or
//     scope mismatch).
//   - unresolved_conflict_decision_ids: decision_ids from every DecisionConflict
//     whose status is not "resolved" (confirmed/probable/possible/unverifiable
//     all count as still outstanding).
//   - decisions_requiring_review_for_drift: decision_id of every DecisionDrift
//     whose severity is "blocking" or "review_required" -- advisory/
//     informational drift does not, by itself, require human review.

import type { DecisionAssumption, DecisionConflict, DecisionDrift, DecisionGovernanceContextEcho, DecisionLink, MissingDecisionFinding } from "./contracts.js";

export interface BuildDecisionGovernanceContextInput {
  missingDecisionFindings: MissingDecisionFinding[];
  assumptions: DecisionAssumption[];
  conflicts: DecisionConflict[];
  governanceLinks: DecisionLink[];
  drift: DecisionDrift[];
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function buildDecisionGovernanceContext(input: BuildDecisionGovernanceContextInput): DecisionGovernanceContextEcho {
  const changesMissingDecision = sortedUnique(input.missingDecisionFindings.map((finding) => finding.affected_entity_id));

  const decisionsWithContradictedAssumptions = sortedUnique(input.assumptions.filter((assumption) => assumption.state === "contradicted").map((assumption) => assumption.decision_id));

  const decisionsActiveAndSuperseded = sortedUnique(
    input.conflicts.filter((conflict) => conflict.kind === "active_and_superseded_simultaneously").flatMap((conflict) => conflict.decision_ids),
  );

  const exceptionsWithInvalidDecisionRef = sortedUnique(
    input.governanceLinks.filter((link) => link.link_type === "excepts" && link.target_domain === "governance" && link.resolution !== "resolved").map((link) => link.decision_id),
  );

  const unresolvedConflictDecisionIds = sortedUnique(input.conflicts.filter((conflict) => conflict.status !== "resolved").flatMap((conflict) => conflict.decision_ids));

  const decisionsRequiringReviewForDrift = sortedUnique(
    input.drift.filter((entry) => entry.severity === "blocking" || entry.severity === "review_required").map((entry) => entry.decision_id),
  );

  return {
    changes_missing_decision: changesMissingDecision,
    decisions_with_contradicted_assumptions: decisionsWithContradictedAssumptions,
    decisions_active_and_superseded: decisionsActiveAndSuperseded,
    exceptions_with_invalid_decision_ref: exceptionsWithInvalidDecisionRef,
    unresolved_conflict_decision_ids: unresolvedConflictDecisionIds,
    decisions_requiring_review_for_drift: decisionsRequiringReviewForDrift,
  };
}
