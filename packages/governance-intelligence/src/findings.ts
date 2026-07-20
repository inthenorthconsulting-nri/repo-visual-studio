import type { GovernanceEvaluation, GovernanceFinding, GovernancePolicyResult, GovernanceSeverity } from "./contracts.js";

// ---------------------------------------------------------------------------
// mergeFindings / summarizeFindings -- pure rollup helpers over an already-
// evaluated set of GovernanceEvaluations. Neither function evaluates
// anything itself (that is policy-evaluator.ts's job); these simply flatten
// and count what evaluatePolicy() already produced. No side effects, no
// timestamps, no I/O.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<GovernanceSeverity, number> = {
  blocking: 0,
  review_required: 1,
  advisory: 2,
  informational: 3,
};

/**
 * Flattens `evaluations[].findings` into one list, sorted by (severity rank,
 * policy_id, first affected_entity_id, finding id) -- the same ordering
 * contracts.ts's `ContinuousIntelligenceReport.findings` doc comment
 * describes ("Flattened from evaluations[].findings, sorted by severity rank
 * then id"), refined here with the two extra tie-break keys the brief calls
 * out explicitly (policy_id, then first affected entity) so findings from
 * the same policy and touching the same entity sort adjacently even when
 * their ids alone wouldn't guarantee that. Dedupes nothing: two distinct
 * findings that happen to be identical in every field but id are both kept,
 * since a governance report must never silently drop a real finding.
 */
export function mergeFindings(evaluations: GovernanceEvaluation[]): GovernanceFinding[] {
  const all = evaluations.flatMap((evaluation) => evaluation.findings);
  return [...all].sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (a.policy_id !== b.policy_id) return a.policy_id < b.policy_id ? -1 : 1;
    const aFirstEntity = a.affected_entity_ids[0] ?? "";
    const bFirstEntity = b.affected_entity_ids[0] ?? "";
    if (aFirstEntity !== bFirstEntity) return aFirstEntity < bFirstEntity ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface FindingsSummary {
  total: number;
  by_severity: Record<GovernanceSeverity, number>;
  by_result: Record<GovernancePolicyResult, number>;
}

/** Plain counts over a findings list, no side effects. Every severity/result key is always present (zero-filled) so a caller never has to guard against a missing key. */
export function summarizeFindings(findings: GovernanceFinding[]): FindingsSummary {
  const bySeverity: Record<GovernanceSeverity, number> = { blocking: 0, review_required: 0, advisory: 0, informational: 0 };
  const byResult: Record<GovernancePolicyResult, number> = { pass: 0, fail: 0, not_applicable: 0, unverifiable: 0, excepted: 0 };

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byResult[finding.result] += 1;
  }

  return { total: findings.length, by_severity: bySeverity, by_result: byResult };
}
