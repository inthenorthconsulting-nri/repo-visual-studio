// Shared fixture builders for decision-intelligence's test suite, mirroring
// @rvs/governance-intelligence/src/__tests__/governance-fixtures.ts's
// centralization rationale: several artifacts here (ArchitectureDecision,
// DecisionSnapshot) have many required fields, and duplicating their shape
// across 40+ test files would risk silent drift from contracts.ts. This file
// is not itself a test file (no describe/it, no *.test.ts suffix) so vitest
// never collects it directly.

import type {
  ArchitectureDecision,
  DecisionAlternative,
  DecisionAssumption,
  DecisionBlastRadiusAssessment,
  DecisionChange,
  DecisionChangeSet,
  DecisionClaim,
  DecisionClaimDraft,
  DecisionConflict,
  DecisionConsequence,
  DecisionCoverageMetric,
  DecisionCriticalityAssessment,
  DecisionDebtFinding,
  DecisionDependency,
  DecisionDependencyCycle,
  DecisionDrift,
  DecisionGovernanceContextEcho,
  DecisionImplementationState,
  DecisionLink,
  DecisionNarrative,
  DecisionPlan,
  DecisionSceneContent,
  DecisionSceneKind,
  DecisionSnapshot,
  DecisionSource,
  DecisionSourceIssue,
  DecisionSupersessionChain,
  DecisionSupersessionIssue,
  EvidenceRef,
  MissingDecisionFinding,
  MissingImplementationFinding,
} from "../contracts.js";

export const GENERATED_AT = "2026-07-01T00:00:00.000Z";

export function evidenceRef(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return { path: "docs/adr/0001-example.md", source_artifact: "decision", ...overrides };
}

let sourceSeq = 0;
export function decisionSource(overrides: Partial<DecisionSource> = {}): DecisionSource {
  sourceSeq += 1;
  return {
    id: overrides.id ?? `decision:source:test-${sourceSeq}`,
    repo_relative_path: overrides.repo_relative_path ?? `docs/adr/000${sourceSeq}-example.md`,
    source_type: overrides.source_type ?? "adr",
    content_digest: overrides.content_digest ?? `digest-${sourceSeq}`,
    classification_basis: overrides.classification_basis ?? "configured_path",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let decisionSeq = 0;
export function architectureDecision(overrides: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  decisionSeq += 1;
  const id = overrides.id ?? `decision:test-${decisionSeq}`;
  return {
    schema_version: 1,
    id,
    source: overrides.source ?? decisionSource(),
    title: overrides.title ?? `Test decision ${decisionSeq}`,
    decision_status: overrides.decision_status ?? "accepted",
    implementation_status: overrides.implementation_status ?? "implemented",
    governance_status: overrides.governance_status,
    scope: overrides.scope ?? "component",
    context: overrides.context,
    decision_text: overrides.decision_text,
    authors: overrides.authors ?? [],
    date: overrides.date,
    supersedes: overrides.supersedes ?? [],
    superseded_by: overrides.superseded_by ?? [],
    evidence_refs: overrides.evidence_refs ?? [evidenceRef({ path: overrides.source?.repo_relative_path ?? "docs/adr/example.md" })],
  };
}

let sourceIssueSeq = 0;
export function decisionSourceIssue(overrides: Partial<DecisionSourceIssue> = {}): DecisionSourceIssue {
  sourceIssueSeq += 1;
  return {
    id: overrides.id ?? `decision:source-issue:test-${sourceIssueSeq}`,
    kind: overrides.kind ?? "unparseable_structure",
    affected_paths: overrides.affected_paths ?? [`docs/adr/000${sourceIssueSeq}-example.md`],
    detail: overrides.detail ?? "Source issue detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionSnapshot(overrides: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  return {
    schema_version: 1,
    id: overrides.id ?? "decision:snapshot:test",
    generated_at: overrides.generated_at ?? GENERATED_AT,
    repository_id: overrides.repository_id ?? "repo-test",
    digest: overrides.digest ?? "digest-snapshot-test",
    upstream_snapshot: overrides.upstream_snapshot,
    decisions: overrides.decisions ?? [],
    source_issues: overrides.source_issues ?? [],
    compatibility: overrides.compatibility ?? "complete",
  };
}

let assumptionSeq = 0;
export function decisionAssumption(overrides: Partial<DecisionAssumption> = {}): DecisionAssumption {
  assumptionSeq += 1;
  return {
    id: overrides.id ?? `decision:assumption:test-${assumptionSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    statement: overrides.statement ?? "Assumption statement.",
    state: overrides.state ?? "confirmed",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let consequenceSeq = 0;
export function decisionConsequence(overrides: Partial<DecisionConsequence> = {}): DecisionConsequence {
  consequenceSeq += 1;
  return {
    id: overrides.id ?? `decision:consequence:test-${consequenceSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    statement: overrides.statement ?? "Consequence statement.",
    classification: overrides.classification ?? "neutral",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let alternativeSeq = 0;
export function decisionAlternative(overrides: Partial<DecisionAlternative> = {}): DecisionAlternative {
  alternativeSeq += 1;
  return {
    id: overrides.id ?? `decision:alternative:test-${alternativeSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    statement: overrides.statement ?? "Alternative statement.",
    state: overrides.state ?? "considered",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let linkSeq = 0;
export function decisionLink(overrides: Partial<DecisionLink> = {}): DecisionLink {
  linkSeq += 1;
  return {
    id: overrides.id ?? `decision:link:test-${linkSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    link_type: overrides.link_type ?? "governs",
    target_domain: overrides.target_domain ?? "architecture",
    target_id: overrides.target_id,
    resolution: overrides.resolution ?? "resolved",
    detail: overrides.detail ?? "Link detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let dependencySeq = 0;
export function decisionDependency(overrides: Partial<DecisionDependency> = {}): DecisionDependency {
  dependencySeq += 1;
  return {
    id: overrides.id ?? `decision:dependency:test-${dependencySeq}`,
    from_decision_id: overrides.from_decision_id ?? "decision:test-1",
    to_decision_id: overrides.to_decision_id ?? "decision:test-2",
    dependency_type: overrides.dependency_type ?? "depends_on",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let cycleSeq = 0;
export function decisionDependencyCycle(overrides: Partial<DecisionDependencyCycle> = {}): DecisionDependencyCycle {
  cycleSeq += 1;
  return {
    id: overrides.id ?? `decision:dependency-cycle:test-${cycleSeq}`,
    decision_ids: overrides.decision_ids ?? ["decision:test-1", "decision:test-2"],
    classification: overrides.classification ?? "informational_allowed",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let supersessionIssueSeq = 0;
export function decisionSupersessionIssue(overrides: Partial<DecisionSupersessionIssue> = {}): DecisionSupersessionIssue {
  supersessionIssueSeq += 1;
  return {
    id: overrides.id ?? `decision:supersession-issue:test-${supersessionIssueSeq}`,
    kind: overrides.kind ?? "missing_target",
    decision_ids: overrides.decision_ids ?? ["decision:test-1"],
    detail: overrides.detail ?? "Supersession issue detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let supersessionChainSeq = 0;
export function decisionSupersessionChain(overrides: Partial<DecisionSupersessionChain> = {}): DecisionSupersessionChain {
  supersessionChainSeq += 1;
  return {
    id: overrides.id ?? `decision:supersession-chain:test-${supersessionChainSeq}`,
    decision_ids_in_order: overrides.decision_ids_in_order ?? ["decision:test-1", "decision:test-2"],
    is_valid: overrides.is_valid ?? true,
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let conflictSeq = 0;
export function decisionConflict(overrides: Partial<DecisionConflict> = {}): DecisionConflict {
  conflictSeq += 1;
  return {
    id: overrides.id ?? `decision:conflict:test-${conflictSeq}`,
    decision_ids: overrides.decision_ids ?? ["decision:test-1", "decision:test-2"],
    kind: overrides.kind ?? "incompatible_required_states",
    status: overrides.status ?? "confirmed",
    detail: overrides.detail ?? "Conflict detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let coverageSeq = 0;
export function decisionCoverageMetric(overrides: Partial<DecisionCoverageMetric> = {}): DecisionCoverageMetric {
  coverageSeq += 1;
  return {
    id: overrides.id ?? `decision:coverage:test-${coverageSeq}`,
    dimension: overrides.dimension ?? "architecture_entities",
    numerator: overrides.numerator ?? 1,
    denominator: overrides.denominator ?? 2,
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let implementationStateSeq = 0;
export function decisionImplementationState(overrides: Partial<DecisionImplementationState> = {}): DecisionImplementationState {
  implementationStateSeq += 1;
  return {
    id: overrides.id ?? `decision:implementation-state:test-${implementationStateSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    status: overrides.status ?? "implemented",
    detail: overrides.detail ?? "Implementation state detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let missingDecisionSeq = 0;
export function missingDecisionFinding(overrides: Partial<MissingDecisionFinding> = {}): MissingDecisionFinding {
  missingDecisionSeq += 1;
  return {
    id: overrides.id ?? `decision:missing-decision:test-${missingDecisionSeq}`,
    rule_kind: overrides.rule_kind ?? "runtime_entrypoint_change_without_decision",
    affected_entity_id: overrides.affected_entity_id ?? `entity-${missingDecisionSeq}`,
    detail: overrides.detail ?? "Missing decision detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let missingImplementationSeq = 0;
export function missingImplementationFinding(overrides: Partial<MissingImplementationFinding> = {}): MissingImplementationFinding {
  missingImplementationSeq += 1;
  return {
    id: overrides.id ?? `decision:missing-implementation:test-${missingImplementationSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    status: overrides.status ?? "implementation_missing",
    detail: overrides.detail ?? "Missing implementation detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let driftSeq = 0;
export function decisionDrift(overrides: Partial<DecisionDrift> = {}): DecisionDrift {
  driftSeq += 1;
  return {
    id: overrides.id ?? `decision:drift:test-${driftSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    cause: overrides.cause ?? "linked_entity_materially_changed",
    severity: overrides.severity ?? "advisory",
    detail: overrides.detail ?? "Drift detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let debtSeq = 0;
export function decisionDebtFinding(overrides: Partial<DecisionDebtFinding> = {}): DecisionDebtFinding {
  debtSeq += 1;
  return {
    id: overrides.id ?? `decision:debt:test-${debtSeq}`,
    category: overrides.category ?? "accepted_without_implementation",
    decision_id: overrides.decision_id ?? "decision:test-1",
    severity: overrides.severity ?? "advisory",
    blast_radius_id: overrides.blast_radius_id,
    resolution_state: overrides.resolution_state ?? "open",
    requires_human_review: overrides.requires_human_review ?? false,
    detail: overrides.detail ?? "Debt finding detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionCriticalityAssessment(overrides: Partial<DecisionCriticalityAssessment> = {}): DecisionCriticalityAssessment {
  return {
    decision_id: overrides.decision_id ?? "decision:test-1",
    criticality: overrides.criticality ?? "standard",
    basis: overrides.basis ?? [],
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let blastRadiusSeq = 0;
export function decisionBlastRadiusAssessment(overrides: Partial<DecisionBlastRadiusAssessment> = {}): DecisionBlastRadiusAssessment {
  blastRadiusSeq += 1;
  return {
    id: overrides.id ?? `decision:blast-radius:test-${blastRadiusSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    level: overrides.level ?? "isolated",
    affected_entity_ids: overrides.affected_entity_ids ?? [],
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

let changeSeq = 0;
export function decisionChange(overrides: Partial<DecisionChange> = {}): DecisionChange {
  changeSeq += 1;
  return {
    id: overrides.id ?? `decision:change:test-${changeSeq}`,
    decision_id: overrides.decision_id ?? "decision:test-1",
    change_type: overrides.change_type ?? "modified",
    classification: overrides.classification ?? "material",
    detail: overrides.detail ?? "Change detail.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionChangeSet(overrides: Partial<DecisionChangeSet> = {}): DecisionChangeSet {
  return {
    schema_version: 1,
    id: overrides.id ?? "decision:change-set:source-target",
    generated_at: overrides.generated_at ?? GENERATED_AT,
    source_snapshot_id: overrides.source_snapshot_id ?? "decision:snapshot:source",
    target_snapshot_id: overrides.target_snapshot_id ?? "decision:snapshot:target",
    compatibility: overrides.compatibility ?? { status: "compatible", reasons: [] },
    changes: overrides.changes ?? [],
  };
}

export function decisionGovernanceContextEcho(overrides: Partial<DecisionGovernanceContextEcho> = {}): DecisionGovernanceContextEcho {
  return {
    changes_missing_decision: overrides.changes_missing_decision ?? [],
    decisions_with_contradicted_assumptions: overrides.decisions_with_contradicted_assumptions ?? [],
    decisions_active_and_superseded: overrides.decisions_active_and_superseded ?? [],
    exceptions_with_invalid_decision_ref: overrides.exceptions_with_invalid_decision_ref ?? [],
    unresolved_conflict_decision_ids: overrides.unresolved_conflict_decision_ids ?? [],
    decisions_requiring_review_for_drift: overrides.decisions_requiring_review_for_drift ?? [],
  };
}

export function decisionClaimDraft(overrides: Partial<DecisionClaimDraft> = {}): DecisionClaimDraft {
  return {
    claim_type: overrides.claim_type ?? "decision_approved",
    subject_decision_id: overrides.subject_decision_id ?? "decision:test-1",
    statement: overrides.statement ?? "Claim statement.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionClaim(overrides: Partial<DecisionClaim> = {}): DecisionClaim {
  return {
    id: overrides.id ?? "decision:claim:decision_approved:decision:test-1",
    claim_type: overrides.claim_type ?? "decision_approved",
    subject_decision_id: overrides.subject_decision_id ?? "decision:test-1",
    statement: overrides.statement ?? "Claim statement.",
    status: overrides.status ?? "approved",
    rejection_codes: overrides.rejection_codes ?? [],
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionNarrative(overrides: Partial<DecisionNarrative> = {}): DecisionNarrative {
  return {
    id: overrides.id ?? "decision:narrative:test",
    generated_at: overrides.generated_at ?? GENERATED_AT,
    source_snapshot_id: overrides.source_snapshot_id ?? "decision:snapshot:test",
    target_snapshot_id: overrides.target_snapshot_id,
    sections: overrides.sections ?? [{ heading: "Headline", body: "Test headline body." }],
  };
}

let sceneSeq = 0;
export function decisionSceneContent(overrides: Partial<DecisionSceneContent> = {}): DecisionSceneContent {
  sceneSeq += 1;
  const kind: DecisionSceneKind = overrides.kind ?? "decision-hero";
  return {
    scene_id: overrides.scene_id ?? `decision:scene:test-plan:${kind}`,
    kind,
    title: overrides.title ?? `Scene ${sceneSeq}`,
    body: overrides.body ?? {},
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function decisionPlan(overrides: Partial<DecisionPlan> = {}): DecisionPlan {
  return {
    id: overrides.id ?? "decision:plan:test-snapshot",
    generated_at: overrides.generated_at ?? GENERATED_AT,
    source_snapshot_id: overrides.source_snapshot_id ?? "decision:snapshot:test",
    scenes: overrides.scenes ?? [decisionSceneContent()],
  };
}
