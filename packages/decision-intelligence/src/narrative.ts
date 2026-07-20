// Deterministic prose synthesis over already-computed decision-intelligence
// artifacts, mirroring @rvs/governance-intelligence/src/narrative.ts's
// generation discipline (every sentence derived from a real count/id, a
// forbidden-phrase self-check runs over every section before returning) but
// producing contracts.ts's own DecisionNarrative shape: a fixed-order
// `sections: DecisionNarrativeSection[]` array (spec's 12-section order),
// not governance's five distinct named text fields -- contracts.ts modeled
// it as an array precisely because 12 named fields would be unwieldy.
//
// Unlike governance's GovernanceNarrative, contracts.ts's DecisionNarrative
// carries no approvedClaims/rejectedClaims fields, so this module does not
// take claims.ts's output as input -- a caller that wants both narrative and
// claims runs them side by side from the same artifacts.

import type {
  ArchitectureDecision,
  DecisionAssumption,
  DecisionBlastRadiusAssessment,
  DecisionChangeSet,
  DecisionCoverageMetric,
  DecisionDebtFinding,
  DecisionDrift,
  DecisionConflict,
  DecisionGovernanceContextEcho,
  DecisionImplementationState,
  DecisionNarrative,
  DecisionSnapshot,
  DecisionSupersessionIssue,
} from "./contracts.js";
import { DECISION_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildNarrativeId } from "./ids.js";

/**
 * Fixed, case-insensitive forbidden substrings, mirroring governance's own
 * convention of naming exact phrases rather than trying to detect "bare vs.
 * qualified" usage via substring scanning. Decision-intelligence must never
 * assert a subjective quality/correctness/safety judgement (disclosed scope
 * trim) or an unqualified "no impact"/"no risk" claim.
 */
const FORBIDDEN_PHRASES = ["decision is correct", "decision is safe", "no risk", "no impact", "architecture is improved", "guaranteed to work"];

export function containsForbiddenPhrasing(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));
}

function countBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${count} ${key}`).join(", ");
}

function buildHeadline(snapshot: DecisionSnapshot, changeSet: DecisionChangeSet | undefined): string {
  const changeText = changeSet
    ? ` Comparing against snapshot "${changeSet.source_snapshot_id}" produced ${changeSet.changes.length} change entr${changeSet.changes.length === 1 ? "y" : "ies"} (compatibility "${changeSet.compatibility.status}").`
    : " No comparison target was provided for this narrative.";
  return `Snapshot "${snapshot.id}" discovered ${snapshot.decisions.length} decision record(s) (source compatibility "${snapshot.compatibility}").${changeText}`;
}

function buildDecisionLandscape(decisions: ArchitectureDecision[], blastRadius: DecisionBlastRadiusAssessment[] | undefined): string {
  const byStatus = countBy(decisions, (decision) => decision.decision_status);
  const base = `Decision status breakdown: ${formatCounts(byStatus)}.`;
  if (!blastRadius || blastRadius.length === 0) return base;
  const byLevel = countBy(blastRadius, (entry) => entry.level);
  const blastRadiusText = ` Blast radius: ${byLevel.isolated ?? 0} isolated, ${byLevel.local ?? 0} local, ${byLevel.cross_component ?? 0} cross-component, ${byLevel.cross_layer ?? 0} cross-layer, ${byLevel.portfolio_wide ?? 0} portfolio-wide, ${byLevel.unresolved ?? 0} unresolved.`;
  return `${base}${blastRadiusText}`;
}

function buildAcceptedActiveDecisions(decisions: ArchitectureDecision[]): string {
  const active = decisions.filter((decision) => decision.decision_status === "accepted" || decision.decision_status === "implemented" || decision.decision_status === "partially_implemented").sort((a, b) => a.id.localeCompare(b.id));
  if (active.length === 0) return "No decisions are currently accepted, implemented, or partially implemented.";
  const sample = active.slice(0, 5).map((decision) => `"${decision.id}"`).join(", ");
  return `${active.length} decision(s) are accepted, implemented, or partially implemented, including: ${sample}.`;
}

function buildImplementationAlignment(implementationStates: DecisionImplementationState[]): string {
  if (implementationStates.length === 0) return "No implementation state was assessed for any decision.";
  const byStatus = countBy(implementationStates, (state) => state.status);
  return `Implementation state breakdown: ${formatCounts(byStatus)}.`;
}

function buildMaterialDecisionChanges(changeSet: DecisionChangeSet | undefined): string {
  if (!changeSet) return "No comparison target was provided, so material decision changes could not be assessed.";
  const material = changeSet.changes.filter((change) => change.classification === "material").sort((a, b) => a.id.localeCompare(b.id));
  if (material.length === 0) return "No material decision changes were identified in this comparison.";
  const sample = material.slice(0, 5).map((change) => `"${change.decision_id}"`).join(", ");
  return `${material.length} material decision change(s) were identified, including: ${sample}.`;
}

function buildAssumptionChanges(assumptions: DecisionAssumption[]): string {
  if (assumptions.length === 0) return "No assumptions were extracted from any decision.";
  const byState = countBy(assumptions, (assumption) => assumption.state);
  const contradicted = assumptions.filter((assumption) => assumption.state === "contradicted").sort((a, b) => a.id.localeCompare(b.id));
  const contradictedText = contradicted.length > 0 ? ` ${contradicted.length} assumption(s) are contradicted, affecting decision(s): ${[...new Set(contradicted.map((a) => a.decision_id))].sort().join(", ")}.` : "";
  return `Assumption state breakdown: ${formatCounts(byState)}.${contradictedText}`;
}

function buildConflictsAndSupersession(conflicts: DecisionConflict[], supersessionIssues: DecisionSupersessionIssue[]): string {
  const unresolvedConflicts = conflicts.filter((conflict) => conflict.status !== "resolved");
  const conflictText = conflicts.length === 0 ? "No conflicts were detected." : `${conflicts.length} conflict(s) detected (${unresolvedConflicts.length} not resolved).`;
  const supersessionText = supersessionIssues.length === 0 ? "No supersession issues were detected." : `${supersessionIssues.length} supersession issue(s) detected: ${formatCounts(countBy(supersessionIssues, (issue) => issue.kind))}.`;
  return `${conflictText} ${supersessionText}`;
}

function buildDecisionCoverage(coverage: DecisionCoverageMetric[]): string {
  if (coverage.length === 0) return "No decision coverage metrics were computed.";
  const parts = coverage
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((metric) => `${metric.dimension}: ${metric.numerator}/${metric.denominator}`);
  return `Decision coverage by dimension: ${parts.join(", ")}.`;
}

function buildDecisionDebt(debtFindings: DecisionDebtFinding[]): string {
  if (debtFindings.length === 0) return "No decision debt findings were identified.";
  const byCategory = countBy(debtFindings, (finding) => finding.category);
  return `${debtFindings.length} decision debt finding(s) identified. Breakdown by category: ${formatCounts(byCategory)}.`;
}

function buildGovernanceImpact(governanceContext: DecisionGovernanceContextEcho | undefined): string {
  if (!governanceContext) return "No governance context was supplied for this narrative, so decision-aware governance impact could not be assessed.";
  const parts = [
    `${governanceContext.changes_missing_decision.length} change(s) missing a linked decision`,
    `${governanceContext.decisions_with_contradicted_assumptions.length} decision(s) with contradicted assumptions`,
    `${governanceContext.decisions_active_and_superseded.length} decision(s) active and superseded simultaneously`,
    `${governanceContext.exceptions_with_invalid_decision_ref.length} governance exception(s) with an invalid decision reference`,
    `${governanceContext.unresolved_conflict_decision_ids.length} decision(s) with an unresolved conflict`,
    `${governanceContext.decisions_requiring_review_for_drift.length} decision(s) requiring review for drift`,
  ];
  return `${parts.join(", ")}.`;
}

function buildHumanReviewRequired(debtFindings: DecisionDebtFinding[], drift: DecisionDrift[]): string {
  const debtNeedingReview = debtFindings.filter((finding) => finding.requires_human_review).sort((a, b) => a.id.localeCompare(b.id));
  const driftNeedingReview = drift.filter((entry) => entry.severity === "blocking" || entry.severity === "review_required").sort((a, b) => a.id.localeCompare(b.id));
  if (debtNeedingReview.length === 0 && driftNeedingReview.length === 0) return "No decision debt findings or drift entries currently require human review.";
  return `${debtNeedingReview.length} decision debt finding(s) and ${driftNeedingReview.length} drift entr(y/ies) require human review.`;
}

function buildEvidenceLimitations(snapshot: DecisionSnapshot, implementationStates: DecisionImplementationState[]): string {
  const unverifiableImplementation = implementationStates.filter((state) => state.status === "unverifiable").length;
  const compatibilityText = snapshot.compatibility === "complete" ? "The snapshot's own source discovery is complete." : `The snapshot's own source discovery is "${snapshot.compatibility}".`;
  const issuesText = snapshot.source_issues.length > 0 ? ` ${snapshot.source_issues.length} source issue(s) were recorded during discovery.` : " No source issues were recorded during discovery.";
  const unverifiableText = unverifiableImplementation > 0 ? ` ${unverifiableImplementation} decision(s) have an unverifiable implementation state.` : "";
  return `${compatibilityText}${issuesText}${unverifiableText}`;
}

export interface BuildDecisionNarrativeInput {
  snapshot: DecisionSnapshot;
  changeSet?: DecisionChangeSet;
  implementationStates: DecisionImplementationState[];
  assumptions: DecisionAssumption[];
  conflicts: DecisionConflict[];
  supersessionIssues: DecisionSupersessionIssue[];
  coverage: DecisionCoverageMetric[];
  debtFindings: DecisionDebtFinding[];
  drift: DecisionDrift[];
  governanceContext?: DecisionGovernanceContextEcho;
  blastRadius?: DecisionBlastRadiusAssessment[];
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  generatedAt: string;
}

export function buildDecisionNarrative(input: BuildDecisionNarrativeInput): DecisionNarrative {
  const { snapshot, changeSet, implementationStates, assumptions, conflicts, supersessionIssues, coverage, debtFindings, drift, governanceContext, blastRadius, generatedAt } = input;

  const sections: [string, string][] = [
    ["Headline", buildHeadline(snapshot, changeSet)],
    ["Decision landscape", buildDecisionLandscape(snapshot.decisions, blastRadius)],
    ["Accepted/active decisions", buildAcceptedActiveDecisions(snapshot.decisions)],
    ["Implementation alignment", buildImplementationAlignment(implementationStates)],
    ["Material decision changes", buildMaterialDecisionChanges(changeSet)],
    ["Assumption changes", buildAssumptionChanges(assumptions)],
    ["Conflicts and supersession", buildConflictsAndSupersession(conflicts, supersessionIssues)],
    ["Decision coverage", buildDecisionCoverage(coverage)],
    ["Decision debt", buildDecisionDebt(debtFindings)],
    ["Governance impact", buildGovernanceImpact(governanceContext)],
    ["Human review required", buildHumanReviewRequired(debtFindings, drift)],
    ["Evidence limitations", buildEvidenceLimitations(snapshot, implementationStates)],
  ];

  for (const [heading, body] of sections) {
    const hits = containsForbiddenPhrasing(body);
    if (hits.length > 0) {
      throw new Error(`Generated decision narrative section "${heading}" contains forbidden phrasing (${hits.join(", ")}). This is a synthesis bug: narrative text must never assert an unsupported quality/safety/no-impact claim.`);
    }
  }

  return {
    id: buildNarrativeId(snapshot.id, changeSet?.target_snapshot_id),
    generated_at: generatedAt,
    source_snapshot_id: snapshot.id,
    target_snapshot_id: changeSet?.target_snapshot_id,
    sections: sections.map(([heading, body]) => ({ heading, body })),
  };
}
