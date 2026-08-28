// Governance advisory: a wrapper around @rvs/governance-intelligence's own
// `evaluatePolicy()`, called UNCHANGED (never modified, never
// reimplemented) when the caller can supply it real input.
//
// Honest limitation, stated up front rather than worked around:
// `evaluatePolicy()`'s `EvaluatePolicyInput` requires real
// `ArchitectureChangeSet`/`CapabilityChangeSet`/`ProductChangeSet`/
// `BlastRadiusAssessment` objects -- each one the product of
// @rvs/governance-intelligence's own M3-M6 snapshot-diffing and
// classification pipeline (domain_path, lineage, GovernanceChangeClassification,
// etc. are all downstream-computed judgments, not something a hypothetical
// `ProposedChangeSet`'s raw KnowledgeNode/KnowledgeEdge overlay can honestly
// synthesize). Faking those fields would mean guessing at a classification
// this package has no basis for, which the whole codebase's conservative
// "never guess" bias forbids. So: when the caller has already run that real
// pipeline (e.g. by scanning an actual candidate branch) and can supply its
// output, this wrapper evaluates it and rephrases the result onto a
// proposed basis. When it can't -- the ordinary case for an overlay-only
// advisory -- this wrapper honestly reports `not_evaluated` rather than
// fabricating findings. See decision-advisory.ts's capability registry for
// the parallel finding on the decision-intelligence side.

import { evaluatePolicy } from "@rvs/governance-intelligence";
import type { EvaluatePolicyInput, GovernanceEvaluation, GovernanceFinding } from "@rvs/governance-intelligence";
import type { AdvisoryGovernanceFinding, AdvisoryGovernanceResult } from "./contracts.js";

export interface GovernanceAdvisoryParams {
  /** Only present when the caller already has a real evaluatePolicy() input built from an actual M3-M6 snapshot diff. Absent for the ordinary overlay-only advisory. */
  evaluationInput?: EvaluatePolicyInput;
}

export function buildGovernanceAdvisory(params: GovernanceAdvisoryParams): AdvisoryGovernanceResult {
  if (!params.evaluationInput) {
    return {
      status: "not_evaluated",
      detail:
        "Full governance policy evaluation requires real ArchitectureChangeSet/CapabilityChangeSet/ProductChangeSet/BlastRadiusAssessment inputs produced by @rvs/governance-intelligence's own M3-M6 snapshot-diffing pipeline against an actually-applied change. A hypothetical proposal's ephemeral overlay cannot honestly synthesize those without reimplementing that pipeline, so this advisory does not attempt it and reports not_evaluated rather than guessing.",
      findings: [],
    };
  }

  const evaluation: GovernanceEvaluation = evaluatePolicy(params.evaluationInput);
  return {
    status: "evaluated",
    detail: `Evaluated ${evaluation.findings.length} finding(s) from policy "${params.evaluationInput.policy.id}" via @rvs/governance-intelligence's evaluatePolicy(), called unchanged, then rephrased onto a proposed (not-yet-applied) basis for this advisory.`,
    findings: evaluation.findings.map(toAdvisoryFinding),
  };
}

function toAdvisoryFinding(finding: GovernanceFinding): AdvisoryGovernanceFinding {
  return {
    rule_id: finding.rule_id,
    policy_id: finding.policy_id,
    result: finding.result,
    severity: finding.severity,
    statement: toProposedBasisStatement(finding.statement),
    affected_refs: finding.affected_entity_ids,
  };
}

const PROPOSED_BASIS_PREAMBLE = "On the proposed (not-yet-applied) basis evaluated by this advisory: ";

/**
 * Rephrases a canonical GovernanceFinding.statement (which may assert
 * present-tense violation, e.g. `..., violating rule "X".`) onto a proposed
 * basis. The two substitutions target the exact present-tense phrasing
 * evaluatePolicy() actually produces across every rule kind (verified
 * against the current evaluator source, not assumed) -- see
 * __tests__/governance-wording.test.ts, which asserts the output never
 * contains a bare "violates"/", violating rule" or "exceeding the
 * configured maximum" substring. Never mutates the canonical
 * GovernanceFinding itself -- this returns a new string, called only from
 * `toAdvisoryFinding` above when building the advisory-only wrapper type.
 */
export function toProposedBasisStatement(canonicalStatement: string): string {
  const rephrased = canonicalStatement
    .replace(/, violating rule/g, ", which would violate rule")
    .replace(/, exceeding the configured maximum/g, ", which would exceed the configured maximum");
  return `${PROPOSED_BASIS_PREAMBLE}${rephrased}`;
}
