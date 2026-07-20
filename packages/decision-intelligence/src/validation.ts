// Structural + semantic validators over decision-intelligence's own output
// artifacts, mirroring @rvs/governance-intelligence/src/validation.ts's
// Tier1 (error) / Tier2 (warning) pattern and its own DECISION_*-prefixed
// codes. Unlike governance's single `validateGovernancePlan(plan)` -- whose
// GovernancePlan embeds the full report/narrative/claims -- contracts.ts's
// DecisionPlan is deliberately minimal (`{ id, generated_at,
// source_snapshot_id, scenes }`), so this file exposes one validator per
// artifact kind (snapshot, links, claims, narrative, plan) plus a combined
// `validateDecisionArtifacts` aggregator a CLI `decisions validate` command
// can call with whatever subset of artifacts it has already built.
//
// `DecisionValidationIssue` is this package's analogue of
// GovernanceValidationIssue; defined here (not contracts.ts) since
// contracts.ts is the fixed cross-package data contract surface and this is
// purely an internal validator-output shape.

import type { ArchitectureDecision, DecisionClaim, DecisionLink, DecisionNarrative, DecisionPlan, DecisionSceneKind, DecisionSnapshot } from "./contracts.js";
import { containsForbiddenPhrasing } from "./narrative.js";

export interface DecisionValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  relatedId?: string;
  remediation?: string;
}

const TIER1_ERROR_CODES = new Set<string>([
  "DECISION_DUPLICATE_ID",
  "DECISION_UNSORTED_DECISIONS",
  "DECISION_INVALID_STATUS",
  "DECISION_BROKEN_SUPERSESSION_REFERENCE",
  "DECISION_LINK_UNKNOWN_DECISION",
  "DECISION_CLAIM_MISSING_REJECTION_CODES",
  "DECISION_CLAIM_UNEXPECTED_REJECTION_CODES",
  "DECISION_CLAIM_DUPLICATE_ID",
  "DECISION_UNSORTED_CLAIMS",
  "DECISION_SCENE_DUPLICATE_ID",
  "DECISION_SCENE_UNSORTED",
  "DECISION_NARRATIVE_ID_MISMATCH",
  "DECISION_NARRATIVE_FORBIDDEN_PHRASING",
]);

function severityFor(code: string): "error" | "warning" {
  return TIER1_ERROR_CODES.has(code) ? "error" : "warning";
}

function issue(code: string, message: string, relatedId?: string, remediation?: string): DecisionValidationIssue {
  return { code, severity: severityFor(code), message, relatedId, remediation };
}

const VALID_DECISION_STATUSES = new Set<string>(["draft", "proposed", "under_review", "accepted", "rejected", "superseded", "deprecated", "withdrawn", "implemented", "partially_implemented", "unknown"]);
const VALID_IMPLEMENTATION_STATUSES = new Set<string>(["not_started", "partial", "implemented", "regressed", "superseded", "unverifiable", "not_applicable"]);

const SCENE_KIND_ORDER: DecisionSceneKind[] = [
  "decision-hero",
  "decision-landscape",
  "decision-status",
  "decision-architecture-map",
  "decision-capability-map",
  "decision-product-map",
  "decision-portfolio-map",
  "decision-implementation",
  "decision-assumptions",
  "decision-supersession",
  "decision-conflicts",
  "decision-coverage",
  "decision-drift",
  "decision-debt",
  "decision-governance-impact",
  "decision-review-required",
  "decision-validation",
];
const SCENE_KIND_RANK: Record<string, number> = Object.fromEntries(SCENE_KIND_ORDER.map((kind, index) => [kind, index]));

// ---------------------------------------------------------------------------
// Snapshot checks
// ---------------------------------------------------------------------------

export function validateDecisionSnapshot(snapshot: DecisionSnapshot): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [];
  const decisionsById = new Map(snapshot.decisions.map((decision) => [decision.id, decision]));

  const seen = new Set<string>();
  for (const decision of snapshot.decisions) {
    if (seen.has(decision.id)) {
      issues.push(issue("DECISION_DUPLICATE_ID", `Decision id "${decision.id}" appears more than once in snapshot.decisions.`, decision.id));
    }
    seen.add(decision.id);
  }

  for (let i = 1; i < snapshot.decisions.length; i += 1) {
    if (snapshot.decisions[i - 1].id > snapshot.decisions[i].id) {
      issues.push(issue("DECISION_UNSORTED_DECISIONS", `snapshot.decisions is not sorted by id: "${snapshot.decisions[i - 1].id}" appears before "${snapshot.decisions[i].id}".`, snapshot.decisions[i].id));
      break;
    }
  }

  for (const decision of snapshot.decisions) {
    if (!VALID_DECISION_STATUSES.has(decision.decision_status)) {
      issues.push(issue("DECISION_INVALID_STATUS", `Decision "${decision.id}" has an invalid decision_status "${decision.decision_status}".`, decision.id));
    }
    if (!VALID_IMPLEMENTATION_STATUSES.has(decision.implementation_status)) {
      issues.push(issue("DECISION_INVALID_STATUS", `Decision "${decision.id}" has an invalid implementation_status "${decision.implementation_status}".`, decision.id));
    }
  }

  issues.push(...checkBrokenSupersessionReferences(snapshot.decisions, decisionsById));

  return issues;
}

function checkBrokenSupersessionReferences(decisions: ArchitectureDecision[], decisionsById: Map<string, ArchitectureDecision>): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [];
  for (const decision of decisions) {
    for (const targetId of [...decision.supersedes, ...decision.superseded_by]) {
      if (!decisionsById.has(targetId)) {
        issues.push(issue("DECISION_BROKEN_SUPERSESSION_REFERENCE", `Decision "${decision.id}" references supersession target "${targetId}", which is not present in this snapshot.`, decision.id));
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Link checks
// ---------------------------------------------------------------------------

export function validateDecisionLinks(links: DecisionLink[], snapshot: DecisionSnapshot): DecisionValidationIssue[] {
  const decisionIds = new Set(snapshot.decisions.map((decision) => decision.id));
  return links
    .filter((link) => !decisionIds.has(link.decision_id))
    .map((link) => issue("DECISION_LINK_UNKNOWN_DECISION", `Link "${link.id}" names decision_id "${link.decision_id}", which is not present in this snapshot.`, link.id));
}

// ---------------------------------------------------------------------------
// Claim checks
// ---------------------------------------------------------------------------

export function validateDecisionClaims(claims: DecisionClaim[]): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [];

  for (const claim of claims) {
    if (claim.status === "rejected" && claim.rejection_codes.length === 0) {
      issues.push(issue("DECISION_CLAIM_MISSING_REJECTION_CODES", `Claim "${claim.id}" has status "rejected" but rejection_codes is empty.`, claim.id));
    }
    if (claim.status !== "rejected" && claim.rejection_codes.length > 0) {
      issues.push(issue("DECISION_CLAIM_UNEXPECTED_REJECTION_CODES", `Claim "${claim.id}" has status "${claim.status}" but rejection_codes is non-empty (${claim.rejection_codes.join(", ")}).`, claim.id));
    }
  }

  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.id)) {
      issues.push(issue("DECISION_CLAIM_DUPLICATE_ID", `Claim id "${claim.id}" appears more than once.`, claim.id));
    }
    seen.add(claim.id);
  }

  for (let i = 1; i < claims.length; i += 1) {
    if (claims[i - 1].id > claims[i].id) {
      issues.push(issue("DECISION_UNSORTED_CLAIMS", `Claims are not sorted by id: "${claims[i - 1].id}" appears before "${claims[i].id}".`, claims[i].id));
      break;
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Narrative checks
// ---------------------------------------------------------------------------

export function validateDecisionNarrative(narrative: DecisionNarrative, snapshot: DecisionSnapshot): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [];

  if (narrative.source_snapshot_id !== snapshot.id) {
    issues.push(issue("DECISION_NARRATIVE_ID_MISMATCH", `narrative.source_snapshot_id "${narrative.source_snapshot_id}" does not match snapshot.id "${snapshot.id}".`, narrative.id));
  }

  for (const section of narrative.sections) {
    const hits = containsForbiddenPhrasing(section.body);
    if (hits.length > 0) {
      issues.push(issue("DECISION_NARRATIVE_FORBIDDEN_PHRASING", `narrative section "${section.heading}" contains forbidden phrasing: ${hits.join(", ")}.`, narrative.id));
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Plan checks
// ---------------------------------------------------------------------------

export function validateDecisionPlan(plan: DecisionPlan): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [];

  const seen = new Set<string>();
  for (const scene of plan.scenes) {
    if (seen.has(scene.scene_id)) {
      issues.push(issue("DECISION_SCENE_DUPLICATE_ID", `Scene id "${scene.scene_id}" appears more than once in plan.scenes.`, scene.scene_id));
    }
    seen.add(scene.scene_id);
  }

  for (let i = 1; i < plan.scenes.length; i += 1) {
    const prevRank = SCENE_KIND_RANK[plan.scenes[i - 1].kind] ?? Number.MAX_SAFE_INTEGER;
    const rank = SCENE_KIND_RANK[plan.scenes[i].kind] ?? Number.MAX_SAFE_INTEGER;
    if (prevRank > rank || (prevRank === rank && plan.scenes[i - 1].scene_id > plan.scenes[i].scene_id)) {
      issues.push(
        issue(
          "DECISION_SCENE_UNSORTED",
          `plan.scenes is not sorted by (canonical kind order, scene_id): "${plan.scenes[i - 1].scene_id}" (${plan.scenes[i - 1].kind}) appears before "${plan.scenes[i].scene_id}" (${plan.scenes[i].kind}).`,
          plan.scenes[i].scene_id,
        ),
      );
      break;
    }
  }

  const MIN_SCENES = 1;
  if (plan.scenes.length < MIN_SCENES) {
    issues.push(issue("DECISION_PLAN_TOO_FEW_SCENES", `plan.scenes is empty. This can genuinely reflect a repository with no discovered decisions and is a warning, not an error.`, plan.id));
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Combined aggregator
// ---------------------------------------------------------------------------

export interface ValidateDecisionArtifactsInput {
  snapshot: DecisionSnapshot;
  links?: DecisionLink[];
  claims?: DecisionClaim[];
  narrative?: DecisionNarrative;
  plan?: DecisionPlan;
}

/** Validates whatever subset of artifacts the caller has already built -- each sub-validator is independently callable, this just runs the ones whose input is present. */
export function validateDecisionArtifacts(input: ValidateDecisionArtifactsInput): DecisionValidationIssue[] {
  const issues: DecisionValidationIssue[] = [...validateDecisionSnapshot(input.snapshot)];
  if (input.links) issues.push(...validateDecisionLinks(input.links, input.snapshot));
  if (input.claims) issues.push(...validateDecisionClaims(input.claims));
  if (input.narrative) issues.push(...validateDecisionNarrative(input.narrative, input.snapshot));
  if (input.plan) issues.push(...validateDecisionPlan(input.plan));
  return issues;
}
