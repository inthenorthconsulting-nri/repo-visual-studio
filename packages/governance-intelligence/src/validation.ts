import type { GovernanceClaim, GovernanceFinding, GovernancePlan, GovernanceSeverity } from "./contracts.js";
import { containsForbiddenPhrasing } from "./narrative.js";

// ---------------------------------------------------------------------------
// validateGovernancePlan -- mirrors portfolio-intelligence/src/validation.ts's
// Tier1 (structural error) + Tier2 (semantic warning) pattern, adapted to
// this package's own GOVERNANCE_*-prefixed codes and GovernancePlan shape.
// Every code below is reachable by at least one test in
// __tests__/validation.test.ts -- no dead codes.
//
// `GovernanceValidationIssue` is this package's analogue of portfolio's
// `PortfolioWarning`; it is defined here (not in contracts.ts) since
// contracts.ts is the fixed cross-package data contract surface and this
// type is purely an internal validator-output shape, same as
// PortfolioWarning lives in portfolio-intelligence's own contracts rather
// than being a "core" type.
// ---------------------------------------------------------------------------

export interface GovernanceValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  relatedId?: string;
  remediation?: string;
}

const TIER1_ERROR_CODES = new Set<string>([
  "GOVERNANCE_MISSING_SCHEMA_VERSION",
  "GOVERNANCE_DUPLICATE_FINDING_ID",
  "GOVERNANCE_UNSORTED_FINDINGS",
  "GOVERNANCE_UNSORTED_EVALUATIONS",
  "GOVERNANCE_INVALID_SEVERITY",
  "GOVERNANCE_EXCEPTION_WITHOUT_APPROVAL_REFERENCE",
  "GOVERNANCE_FINDING_EXCEPTED_RESULT_MISMATCH",
  "GOVERNANCE_CLAIM_MISSING_REJECTION_REASON",
  "GOVERNANCE_CLAIM_UNEXPECTED_REJECTION_REASON",
  "GOVERNANCE_CLAIM_QUALIFIED_WITHOUT_QUALIFIERS",
  "GOVERNANCE_CLAIM_MISPLACED",
  "GOVERNANCE_CLAIM_DUPLICATE_ID",
  "GOVERNANCE_UNSORTED_CLAIMS",
  "GOVERNANCE_SCENE_MISSING_EVIDENCE",
  "GOVERNANCE_SCENE_DUPLICATE_ID",
  "GOVERNANCE_SCENE_UNSORTED",
  "GOVERNANCE_NARRATIVE_ID_MISMATCH",
  "GOVERNANCE_NARRATIVE_FORBIDDEN_PHRASING",
]);

function severityFor(code: string): "error" | "warning" {
  return TIER1_ERROR_CODES.has(code) ? "error" : "warning";
}

function issue(code: string, message: string, relatedId?: string, remediation?: string): GovernanceValidationIssue {
  return { code, severity: severityFor(code), message, relatedId, remediation };
}

const SEVERITY_RANK: Record<GovernanceSeverity, number> = { blocking: 0, review_required: 1, advisory: 2, informational: 3 };
const VALID_SEVERITIES = new Set<string>(["blocking", "review_required", "advisory", "informational"]);

const SCENE_KIND_ORDER = ["governance-hero", "snapshot-comparison", "change-summary", "architecture-change-map", "capability-regression", "product-change", "portfolio-change", "evidence-regression", "blast-radius", "policy-findings", "exceptions", "decision-required", "governance-validation"];
const SCENE_KIND_RANK: Record<string, number> = Object.fromEntries(SCENE_KIND_ORDER.map((kind, index) => [kind, index]));

// ---------------------------------------------------------------------------
// Findings checks
// ---------------------------------------------------------------------------

function checkFindingsDuplicateIds(findings: GovernanceFinding[]): GovernanceValidationIssue[] {
  const seen = new Set<string>();
  const issues: GovernanceValidationIssue[] = [];
  for (const finding of findings) {
    if (seen.has(finding.id)) {
      issues.push(issue("GOVERNANCE_DUPLICATE_FINDING_ID", `Finding id "${finding.id}" appears more than once in report.findings.`, finding.id));
    }
    seen.add(finding.id);
  }
  return issues;
}

function checkFindingsSorted(findings: GovernanceFinding[]): GovernanceValidationIssue[] {
  for (let i = 1; i < findings.length; i += 1) {
    const prevRank = SEVERITY_RANK[findings[i - 1].severity];
    const rank = SEVERITY_RANK[findings[i].severity];
    if (prevRank > rank || (prevRank === rank && findings[i - 1].id > findings[i].id)) {
      return [issue("GOVERNANCE_UNSORTED_FINDINGS", `report.findings is not sorted by (severity rank, id): "${findings[i - 1].id}" appears before "${findings[i].id}".`, findings[i].id)];
    }
  }
  return [];
}

function checkInvalidSeverity(findings: GovernanceFinding[]): GovernanceValidationIssue[] {
  return findings.filter((finding) => !VALID_SEVERITIES.has(finding.severity)).map((finding) => issue("GOVERNANCE_INVALID_SEVERITY", `Finding "${finding.id}" has an invalid severity "${finding.severity}".`, finding.id));
}

function checkExceptionApprovalReference(findings: GovernanceFinding[]): GovernanceValidationIssue[] {
  return findings
    .filter((finding) => finding.excepted && (!finding.exception || !finding.exception.approval_reference || finding.exception.approval_reference.trim().length === 0))
    .map((finding) => issue("GOVERNANCE_EXCEPTION_WITHOUT_APPROVAL_REFERENCE", `Finding "${finding.id}" is excepted but names no approval_reference on its exception.`, finding.id, "Set exception.approval_reference to a real approval record (ticket, sign-off, etc.)."));
}

function checkExceptedResultMismatch(findings: GovernanceFinding[]): GovernanceValidationIssue[] {
  return findings
    .filter((finding) => finding.excepted !== (finding.result === "excepted"))
    .map((finding) => issue("GOVERNANCE_FINDING_EXCEPTED_RESULT_MISMATCH", `Finding "${finding.id}" has excepted=${finding.excepted} but result="${finding.result}" -- these must agree.`, finding.id));
}

// ---------------------------------------------------------------------------
// Evaluation checks
// ---------------------------------------------------------------------------

function checkEvaluationsSorted(plan: GovernancePlan): GovernanceValidationIssue[] {
  const evaluations = plan.report.evaluations;
  for (let i = 1; i < evaluations.length; i += 1) {
    if (evaluations[i - 1].policy_id > evaluations[i].policy_id) {
      return [issue("GOVERNANCE_UNSORTED_EVALUATIONS", `report.evaluations is not sorted by policy_id: "${evaluations[i - 1].policy_id}" appears before "${evaluations[i].policy_id}".`, evaluations[i].id)];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Claim checks
// ---------------------------------------------------------------------------

function checkSortedById(claims: GovernanceClaim[], code: string, label: string): GovernanceValidationIssue[] {
  for (let i = 1; i < claims.length; i += 1) {
    if (claims[i - 1].id > claims[i].id) {
      return [issue(code, `${label} is not sorted by id: "${claims[i - 1].id}" appears before "${claims[i].id}".`, claims[i].id)];
    }
  }
  return [];
}

/**
 * Judgment call: array-placement consistency (GOVERNANCE_CLAIM_MISPLACED),
 * status/rejection_reason field consistency
 * (GOVERNANCE_CLAIM_MISSING_REJECTION_REASON /
 * GOVERNANCE_CLAIM_UNEXPECTED_REJECTION_REASON), and the qualifiers check
 * are deliberately independent conditions, not nested inside "which array is
 * this claim in" branches -- so a single malformed claim (e.g. a
 * status:"rejected" claim with no rejection_reason, misfiled into
 * approvedClaims) is reported precisely: once for its field inconsistency,
 * once for its placement, never conflated into a single vaguer code.
 */
function checkClaims(plan: GovernancePlan): GovernanceValidationIssue[] {
  const issues: GovernanceValidationIssue[] = [];
  const { approvedClaims, rejectedClaims } = plan.narrative;

  for (const claim of approvedClaims) {
    if (claim.status === "rejected") {
      issues.push(issue("GOVERNANCE_CLAIM_MISPLACED", `Claim "${claim.id}" has status "rejected" but appears in approvedClaims.`, claim.id));
    }
  }
  for (const claim of rejectedClaims) {
    if (claim.status !== "rejected") {
      issues.push(issue("GOVERNANCE_CLAIM_MISPLACED", `Claim "${claim.id}" has status "${claim.status}" but appears in rejectedClaims.`, claim.id));
    }
  }

  for (const claim of [...approvedClaims, ...rejectedClaims]) {
    if (claim.status === "qualified" && claim.qualifiers.length === 0) {
      issues.push(issue("GOVERNANCE_CLAIM_QUALIFIED_WITHOUT_QUALIFIERS", `Claim "${claim.id}" has status "qualified" but qualifiers is empty.`, claim.id));
    }
    if (claim.status === "rejected" && claim.rejection_reason === undefined) {
      issues.push(issue("GOVERNANCE_CLAIM_MISSING_REJECTION_REASON", `Claim "${claim.id}" has status "rejected" but sets no rejection_reason.`, claim.id));
    }
    if (claim.status !== "rejected" && claim.rejection_reason !== undefined) {
      issues.push(issue("GOVERNANCE_CLAIM_UNEXPECTED_REJECTION_REASON", `Claim "${claim.id}" has status "${claim.status}" but sets rejection_reason "${claim.rejection_reason}".`, claim.id));
    }
  }

  const seen = new Set<string>();
  for (const claim of [...approvedClaims, ...rejectedClaims]) {
    if (seen.has(claim.id)) {
      issues.push(issue("GOVERNANCE_CLAIM_DUPLICATE_ID", `Claim id "${claim.id}" appears more than once across approvedClaims/rejectedClaims.`, claim.id));
    }
    seen.add(claim.id);
  }

  issues.push(...checkSortedById(approvedClaims, "GOVERNANCE_UNSORTED_CLAIMS", "narrative.approvedClaims"));
  issues.push(...checkSortedById(rejectedClaims, "GOVERNANCE_UNSORTED_CLAIMS", "narrative.rejectedClaims"));

  return issues;
}

// ---------------------------------------------------------------------------
// Scene checks
// ---------------------------------------------------------------------------

function checkScenes(plan: GovernancePlan): GovernanceValidationIssue[] {
  const issues: GovernanceValidationIssue[] = [];
  const { scenes, report } = plan;

  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.scene_id)) {
      issues.push(issue("GOVERNANCE_SCENE_DUPLICATE_ID", `Scene id "${scene.scene_id}" appears more than once in plan.scenes.`, scene.scene_id));
    }
    seen.add(scene.scene_id);
  }

  for (let i = 1; i < scenes.length; i += 1) {
    const prevRank = SCENE_KIND_RANK[scenes[i - 1].kind] ?? Number.MAX_SAFE_INTEGER;
    const rank = SCENE_KIND_RANK[scenes[i].kind] ?? Number.MAX_SAFE_INTEGER;
    if (prevRank > rank || (prevRank === rank && scenes[i - 1].scene_id > scenes[i].scene_id)) {
      issues.push(issue("GOVERNANCE_SCENE_UNSORTED", `plan.scenes is not sorted by (canonical kind order, scene_id): "${scenes[i - 1].scene_id}" (${scenes[i - 1].kind}) appears before "${scenes[i].scene_id}" (${scenes[i].kind}).`, scenes[i].scene_id));
      break;
    }
  }

  // Cross-checks against the evidence-gating invariants governance-plan.ts's
  // own builders enforce -- catches hand-constructed/deserialized plans that
  // bypass buildGovernancePlan and present a scene with no real evidence.
  for (const scene of scenes) {
    if (scene.kind === "portfolio-change" && !report.portfolio_changes) {
      issues.push(issue("GOVERNANCE_SCENE_MISSING_EVIDENCE", `Scene "${scene.scene_id}" (portfolio-change) is present but report.portfolio_changes is absent.`, scene.scene_id));
    }
    if (scene.kind === "exceptions" && !report.findings.some((finding) => finding.excepted)) {
      issues.push(issue("GOVERNANCE_SCENE_MISSING_EVIDENCE", `Scene "${scene.scene_id}" (exceptions) is present but no finding is excepted.`, scene.scene_id));
    }
    if (scene.kind === "decision-required" && !report.findings.some((finding) => finding.human_review_required && finding.result !== "excepted")) {
      issues.push(issue("GOVERNANCE_SCENE_MISSING_EVIDENCE", `Scene "${scene.scene_id}" (decision-required) is present but no finding requires human review.`, scene.scene_id));
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Narrative / report checks
// ---------------------------------------------------------------------------

function checkNarrativeIds(plan: GovernancePlan): GovernanceValidationIssue[] {
  const issues: GovernanceValidationIssue[] = [];
  if (plan.narrative.source_snapshot_id !== plan.report.source_snapshot_id || plan.narrative.target_snapshot_id !== plan.report.target_snapshot_id) {
    issues.push(issue("GOVERNANCE_NARRATIVE_ID_MISMATCH", `narrative source/target snapshot ids ("${plan.narrative.source_snapshot_id}" / "${plan.narrative.target_snapshot_id}") do not match report source/target snapshot ids ("${plan.report.source_snapshot_id}" / "${plan.report.target_snapshot_id}").`, plan.narrative.id));
  }
  return issues;
}

function checkForbiddenPhrasing(plan: GovernancePlan): GovernanceValidationIssue[] {
  const fields: [string, string][] = [
    ["summary", plan.narrative.summary],
    ["whatChanged", plan.narrative.whatChanged],
    ["whyItMatters", plan.narrative.whyItMatters],
    ["riskAssessment", plan.narrative.riskAssessment],
    ["recommendedActions", plan.narrative.recommendedActions],
  ];
  const issues: GovernanceValidationIssue[] = [];
  for (const [field, text] of fields) {
    const hits = containsForbiddenPhrasing(text);
    if (hits.length > 0) {
      issues.push(issue("GOVERNANCE_NARRATIVE_FORBIDDEN_PHRASING", `narrative.${field} contains forbidden phrasing: ${hits.join(", ")}.`, plan.narrative.id));
    }
  }
  return issues;
}

function checkSchemaVersion(plan: GovernancePlan): GovernanceValidationIssue[] {
  const issues: GovernanceValidationIssue[] = [];
  if (!plan.schema_version) issues.push(issue("GOVERNANCE_MISSING_SCHEMA_VERSION", "plan.schema_version is missing or zero.", plan.id));
  if (!plan.report.schema_version) issues.push(issue("GOVERNANCE_MISSING_SCHEMA_VERSION", "plan.report.schema_version is missing or zero.", plan.report.id));
  if (!plan.narrative.schema_version) issues.push(issue("GOVERNANCE_MISSING_SCHEMA_VERSION", "plan.narrative.schema_version is missing or zero.", plan.narrative.id));
  return issues;
}

const MIN_SCENES = 3;
function checkTooFewScenes(plan: GovernancePlan): GovernanceValidationIssue[] {
  if (plan.scenes.length < MIN_SCENES) {
    return [issue("GOVERNANCE_PLAN_TOO_FEW_SCENES", `plan.scenes has only ${plan.scenes.length} scene(s), fewer than the recommended minimum of ${MIN_SCENES}. This can genuinely reflect weak evidence and is a warning, not an error.`, plan.id)];
  }
  return [];
}

/**
 * Validates structural and semantic invariants of a fully-built
 * `GovernancePlan`. Pure function; makes no assumption about how the plan
 * was produced (accepts hand-constructed/deserialized plans, not just ones
 * produced by buildGovernancePlan), which is exactly why several checks here
 * re-verify invariants buildGovernancePlan/buildGovernanceNarrative already
 * uphold by construction.
 */
export function validateGovernancePlan(plan: GovernancePlan): GovernanceValidationIssue[] {
  return [
    ...checkSchemaVersion(plan),
    ...checkFindingsDuplicateIds(plan.report.findings),
    ...checkFindingsSorted(plan.report.findings),
    ...checkEvaluationsSorted(plan),
    ...checkInvalidSeverity(plan.report.findings),
    ...checkExceptionApprovalReference(plan.report.findings),
    ...checkExceptedResultMismatch(plan.report.findings),
    ...checkClaims(plan),
    ...checkScenes(plan),
    ...checkNarrativeIds(plan),
    ...checkForbiddenPhrasing(plan),
    ...checkTooFewScenes(plan),
  ];
}
