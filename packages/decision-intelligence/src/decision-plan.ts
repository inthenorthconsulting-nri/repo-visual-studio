// One build<Kind>Scene function per DecisionSceneKind (17, exactly as
// contracts.ts's union declares), mirroring
// @rvs/governance-intelligence/src/governance-plan.ts's "full content per
// scene, evidence-gated absence" pattern: a scene that would have nothing
// real to show returns `undefined` rather than being emitted empty. Unlike
// GovernanceSceneContent's `data` field, contracts.ts's DecisionSceneContent
// names this field `body`. Unlike GovernancePlan, contracts.ts's DecisionPlan
// carries no `report`/`narrative`/`evidence_refs`/`schema_version` fields --
// it is deliberately just `{ id, generated_at, source_snapshot_id, scenes }`,
// and it has no notion of a comparison target (no `target_snapshot_id`), so
// this builder is snapshot-scoped only; comparison-shaped content belongs to
// narrative.ts's "Material decision changes" section instead.
//
// buildSceneId is reused directly from ids.ts (unlike governance-plan.ts,
// which duplicates a local copy) -- ids.ts's `buildSceneId(planId, kind)`
// is already exactly the general shape this file needs, so there is no
// "widening the public surface for one call site" concern here.

import type {
  DecisionAssumption,
  DecisionBlastRadiusAssessment,
  DecisionConflict,
  DecisionCoverageMetric,
  DecisionDebtFinding,
  DecisionDrift,
  DecisionGovernanceContextEcho,
  DecisionImplementationState,
  DecisionLink,
  DecisionLinkTargetDomain,
  DecisionNarrative,
  DecisionPlan,
  DecisionSceneContent,
  DecisionSceneKind,
  DecisionSnapshot,
  DecisionSupersessionChain,
  DecisionSupersessionIssue,
} from "./contracts.js";
import { buildPlanId, buildSceneId } from "./ids.js";

/** Canonical DecisionSceneKind order, exactly as declared in contracts.ts. */
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
const SCENE_KIND_RANK: Record<DecisionSceneKind, number> = Object.fromEntries(SCENE_KIND_ORDER.map((kind, index) => [kind, index])) as Record<DecisionSceneKind, number>;

function countBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted = {} as Record<K, number>;
  for (const key of Object.keys(counts).sort() as K[]) {
    sorted[key] = counts[key];
  }
  return sorted;
}

function findSection(narrative: DecisionNarrative, heading: string): string {
  return narrative.sections.find((section) => section.heading === heading)?.body ?? "";
}

// ---------------------------------------------------------------------------
// Per-kind scene builders
// ---------------------------------------------------------------------------

export function buildDecisionHeroScene(planId: string, snapshot: DecisionSnapshot, narrative: DecisionNarrative): DecisionSceneContent {
  return {
    scene_id: buildSceneId(planId, "decision-hero"),
    kind: "decision-hero",
    title: `Decision snapshot: ${snapshot.id}`,
    body: { summary: findSection(narrative, "Headline"), decision_count: snapshot.decisions.length, compatibility: snapshot.compatibility },
    evidence_refs: [],
  };
}

export function buildDecisionLandscapeScene(planId: string, snapshot: DecisionSnapshot): DecisionSceneContent | undefined {
  if (snapshot.decisions.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-landscape"),
    kind: "decision-landscape",
    title: "Decision landscape",
    body: { total: snapshot.decisions.length, by_status: countBy(snapshot.decisions, (decision) => decision.decision_status) },
    evidence_refs: [],
  };
}

export function buildDecisionStatusScene(planId: string, snapshot: DecisionSnapshot): DecisionSceneContent | undefined {
  if (snapshot.decisions.length === 0) return undefined;
  const rows = snapshot.decisions
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((decision) => ({ id: decision.id, decision_status: decision.decision_status, implementation_status: decision.implementation_status, governance_status: decision.governance_status ?? "unverifiable" }));
  return {
    scene_id: buildSceneId(planId, "decision-status"),
    kind: "decision-status",
    title: "Decision status detail",
    body: { rows },
    evidence_refs: snapshot.decisions.flatMap((decision) => decision.evidence_refs),
  };
}

function buildDomainMapScene(planId: string, kind: DecisionSceneKind, title: string, links: DecisionLink[], domain: DecisionLinkTargetDomain): DecisionSceneContent | undefined {
  const scoped = links.filter((link) => link.target_domain === domain);
  if (scoped.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, kind),
    kind,
    title,
    body: { total: scoped.length, by_resolution: countBy(scoped, (link) => link.resolution), decision_ids: [...new Set(scoped.map((link) => link.decision_id))].sort() },
    evidence_refs: scoped.flatMap((link) => link.evidence_refs),
  };
}

export function buildDecisionArchitectureMapScene(planId: string, links: DecisionLink[]): DecisionSceneContent | undefined {
  return buildDomainMapScene(planId, "decision-architecture-map", "Decisions linked to architecture", links, "architecture");
}

export function buildDecisionCapabilityMapScene(planId: string, links: DecisionLink[]): DecisionSceneContent | undefined {
  return buildDomainMapScene(planId, "decision-capability-map", "Decisions linked to capabilities", links, "capability");
}

export function buildDecisionProductMapScene(planId: string, links: DecisionLink[]): DecisionSceneContent | undefined {
  return buildDomainMapScene(planId, "decision-product-map", "Decisions linked to products", links, "product");
}

export function buildDecisionPortfolioMapScene(planId: string, links: DecisionLink[]): DecisionSceneContent | undefined {
  return buildDomainMapScene(planId, "decision-portfolio-map", "Decisions linked to portfolio", links, "portfolio");
}

export function buildDecisionImplementationScene(planId: string, implementationStates: DecisionImplementationState[]): DecisionSceneContent | undefined {
  if (implementationStates.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-implementation"),
    kind: "decision-implementation",
    title: "Implementation alignment",
    body: { total: implementationStates.length, by_status: countBy(implementationStates, (state) => state.status) },
    evidence_refs: implementationStates.flatMap((state) => state.evidence_refs),
  };
}

export function buildDecisionAssumptionsScene(planId: string, assumptions: DecisionAssumption[]): DecisionSceneContent | undefined {
  if (assumptions.length === 0) return undefined;
  const contradicted = assumptions.filter((assumption) => assumption.state === "contradicted");
  return {
    scene_id: buildSceneId(planId, "decision-assumptions"),
    kind: "decision-assumptions",
    title: "Assumptions",
    body: { total: assumptions.length, by_state: countBy(assumptions, (assumption) => assumption.state), contradicted_ids: [...contradicted.map((assumption) => assumption.id)].sort() },
    evidence_refs: assumptions.flatMap((assumption) => assumption.evidence_refs),
  };
}

export function buildDecisionSupersessionScene(planId: string, issues: DecisionSupersessionIssue[], chains: DecisionSupersessionChain[]): DecisionSceneContent | undefined {
  if (issues.length === 0 && chains.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-supersession"),
    kind: "decision-supersession",
    title: "Supersession",
    body: { issue_total: issues.length, by_issue_kind: countBy(issues, (issue) => issue.kind), chain_total: chains.length, invalid_chain_count: chains.filter((chain) => !chain.is_valid).length },
    evidence_refs: [...issues.flatMap((issue) => issue.evidence_refs), ...chains.flatMap((chain) => chain.evidence_refs)],
  };
}

export function buildDecisionConflictsScene(planId: string, conflicts: DecisionConflict[]): DecisionSceneContent | undefined {
  if (conflicts.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-conflicts"),
    kind: "decision-conflicts",
    title: "Conflicts",
    body: { total: conflicts.length, by_kind: countBy(conflicts, (conflict) => conflict.kind), unresolved_count: conflicts.filter((conflict) => conflict.status !== "resolved").length },
    evidence_refs: conflicts.flatMap((conflict) => conflict.evidence_refs),
  };
}

export function buildDecisionCoverageScene(planId: string, coverage: DecisionCoverageMetric[]): DecisionSceneContent | undefined {
  if (coverage.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-coverage"),
    kind: "decision-coverage",
    title: "Decision coverage",
    body: { metrics: coverage.slice().sort((a, b) => a.id.localeCompare(b.id)).map((metric) => ({ dimension: metric.dimension, numerator: metric.numerator, denominator: metric.denominator })) },
    evidence_refs: coverage.flatMap((metric) => metric.evidence_refs),
  };
}

export function buildDecisionDriftScene(planId: string, drift: DecisionDrift[]): DecisionSceneContent | undefined {
  if (drift.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-drift"),
    kind: "decision-drift",
    title: "Decision drift",
    body: { total: drift.length, by_severity: countBy(drift, (entry) => entry.severity), by_cause: countBy(drift, (entry) => entry.cause) },
    evidence_refs: drift.flatMap((entry) => entry.evidence_refs),
  };
}

export function buildDecisionDebtScene(planId: string, debtFindings: DecisionDebtFinding[], blastRadius?: DecisionBlastRadiusAssessment[]): DecisionSceneContent | undefined {
  if (debtFindings.length === 0) return undefined;
  const body: { total: number; by_category: Record<string, number>; open_count: number; by_blast_radius_level?: Record<string, number> } = {
    total: debtFindings.length,
    by_category: countBy(debtFindings, (finding) => finding.category),
    open_count: debtFindings.filter((finding) => finding.resolution_state === "open").length,
  };
  if (blastRadius && blastRadius.length > 0) {
    body.by_blast_radius_level = countBy(blastRadius, (entry) => entry.level);
  }
  return {
    scene_id: buildSceneId(planId, "decision-debt"),
    kind: "decision-debt",
    title: "Decision debt",
    body,
    evidence_refs: debtFindings.flatMap((finding) => finding.evidence_refs),
  };
}

/** Judgment call: gated on the context being both present AND non-empty, mirroring governance-plan.ts's own "present AND non-empty" precedent for optional domains. */
export function buildDecisionGovernanceImpactScene(planId: string, governanceContext: DecisionGovernanceContextEcho | undefined): DecisionSceneContent | undefined {
  if (!governanceContext) return undefined;
  const total =
    governanceContext.changes_missing_decision.length +
    governanceContext.decisions_with_contradicted_assumptions.length +
    governanceContext.decisions_active_and_superseded.length +
    governanceContext.exceptions_with_invalid_decision_ref.length +
    governanceContext.unresolved_conflict_decision_ids.length +
    governanceContext.decisions_requiring_review_for_drift.length;
  if (total === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-governance-impact"),
    kind: "decision-governance-impact",
    title: "Governance impact",
    body: governanceContext,
    evidence_refs: [],
  };
}

/** Judgment call: excludes debt findings/drift entries below review-worthy severity, matching governance-plan.ts's own decision-required scene's "needs a human decision, not a re-run" framing. */
export function buildDecisionReviewRequiredScene(planId: string, debtFindings: DecisionDebtFinding[], drift: DecisionDrift[]): DecisionSceneContent | undefined {
  const debtNeedingReview = debtFindings.filter((finding) => finding.requires_human_review);
  const driftNeedingReview = drift.filter((entry) => entry.severity === "blocking" || entry.severity === "review_required");
  if (debtNeedingReview.length === 0 && driftNeedingReview.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-review-required"),
    kind: "decision-review-required",
    title: "Human review required",
    body: {
      debt_finding_ids: [...debtNeedingReview.map((finding) => finding.id)].sort(),
      drift_ids: [...driftNeedingReview.map((entry) => entry.id)].sort(),
    },
    evidence_refs: [...debtNeedingReview.flatMap((finding) => finding.evidence_refs), ...driftNeedingReview.flatMap((entry) => entry.evidence_refs)],
  };
}

/** Judgment call: gated on there being an actual data-completeness concern -- snapshot compatibility isn't "complete", source issues were recorded, or at least one implementation state is unverifiable. */
export function buildDecisionValidationScene(planId: string, snapshot: DecisionSnapshot, implementationStates: DecisionImplementationState[]): DecisionSceneContent | undefined {
  const unverifiable = implementationStates.filter((state) => state.status === "unverifiable");
  if (snapshot.compatibility === "complete" && snapshot.source_issues.length === 0 && unverifiable.length === 0) return undefined;
  return {
    scene_id: buildSceneId(planId, "decision-validation"),
    kind: "decision-validation",
    title: "Data completeness and verifiability",
    body: {
      compatibility: snapshot.compatibility,
      source_issue_count: snapshot.source_issues.length,
      unverifiable_implementation_count: unverifiable.length,
    },
    evidence_refs: snapshot.source_issues.flatMap((issue) => issue.evidence_refs),
  };
}

// ---------------------------------------------------------------------------
// buildDecisionPlan
// ---------------------------------------------------------------------------

export interface BuildDecisionPlanInput {
  snapshot: DecisionSnapshot;
  narrative: DecisionNarrative;
  links: DecisionLink[];
  implementationStates: DecisionImplementationState[];
  assumptions: DecisionAssumption[];
  supersessionIssues: DecisionSupersessionIssue[];
  supersessionChains: DecisionSupersessionChain[];
  conflicts: DecisionConflict[];
  coverage: DecisionCoverageMetric[];
  drift: DecisionDrift[];
  debtFindings: DecisionDebtFinding[];
  governanceContext?: DecisionGovernanceContextEcho;
  blastRadius?: DecisionBlastRadiusAssessment[];
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  generatedAt: string;
}

export function buildDecisionPlan(input: BuildDecisionPlanInput): DecisionPlan {
  const { snapshot, narrative, links, implementationStates, assumptions, supersessionIssues, supersessionChains, conflicts, coverage, drift, debtFindings, governanceContext, blastRadius, generatedAt } = input;
  const planId = buildPlanId(snapshot.id);

  const candidates: (DecisionSceneContent | undefined)[] = [
    buildDecisionHeroScene(planId, snapshot, narrative),
    buildDecisionLandscapeScene(planId, snapshot),
    buildDecisionStatusScene(planId, snapshot),
    buildDecisionArchitectureMapScene(planId, links),
    buildDecisionCapabilityMapScene(planId, links),
    buildDecisionProductMapScene(planId, links),
    buildDecisionPortfolioMapScene(planId, links),
    buildDecisionImplementationScene(planId, implementationStates),
    buildDecisionAssumptionsScene(planId, assumptions),
    buildDecisionSupersessionScene(planId, supersessionIssues, supersessionChains),
    buildDecisionConflictsScene(planId, conflicts),
    buildDecisionCoverageScene(planId, coverage),
    buildDecisionDriftScene(planId, drift),
    buildDecisionDebtScene(planId, debtFindings, blastRadius),
    buildDecisionGovernanceImpactScene(planId, governanceContext),
    buildDecisionReviewRequiredScene(planId, debtFindings, drift),
    buildDecisionValidationScene(planId, snapshot, implementationStates),
  ];

  const scenes = candidates
    .filter((scene): scene is DecisionSceneContent => scene !== undefined)
    .sort((a, b) => (SCENE_KIND_RANK[a.kind] !== SCENE_KIND_RANK[b.kind] ? SCENE_KIND_RANK[a.kind] - SCENE_KIND_RANK[b.kind] : a.scene_id.localeCompare(b.scene_id)));

  return {
    id: planId,
    generated_at: generatedAt,
    source_snapshot_id: snapshot.id,
    scenes,
  };
}
