// Shared fixture builders for the milestone-7 part-4 test files
// (claims/narrative/governance-plan/validation/explain). Deliberately
// centralized here -- unlike the smaller change-set-only fixtures earlier
// test files each define locally (e.g. policy-evaluator.test.ts), a full
// `ContinuousIntelligenceReport` has 11 required fields, several of which
// are themselves composite artifacts; duplicating that shape five times
// across test files would risk the fixtures silently drifting out of sync
// with contracts.ts. This file is not itself a test file (no
// describe/it, no *.test.ts suffix) so vitest never collects it directly.
import type {
  ArchitectureChangeSet,
  BlastRadiusAssessment,
  BlastRadiusEntry,
  CapabilityChangeSet,
  ContinuousIntelligenceReport,
  EvidenceChangeSet,
  GovernanceChangeClassification,
  GovernanceChangeEntry,
  GovernanceCompatibilityStatus,
  GovernanceEvaluation,
  GovernanceEvidenceChangeEntry,
  GovernanceFinding,
  GovernancePolicyResult,
  PortfolioChangeSet,
  ProductChangeSet,
} from "../contracts.js";

export const GENERATED_AT = "2026-07-01T00:00:00.000Z";

export function classification(overrides: Partial<GovernanceChangeClassification> = {}): GovernanceChangeClassification {
  return {
    domain: "architecture",
    materiality: "material",
    confidence: "confirmed",
    governance_severity: "informational",
    compatibility_impact: "compatible",
    evidence_impact: "preserved",
    runtime_impact: "none",
    consumer_impact: "isolated",
    portfolio_impact: "none",
    ...overrides,
  };
}

let entrySeq = 0;
export function changeEntry(overrides: Partial<GovernanceChangeEntry> = {}): GovernanceChangeEntry {
  entrySeq += 1;
  return {
    id: overrides.id ?? `governance:change:test:${entrySeq}`,
    domain_path: overrides.domain_path ?? "components",
    entity_id: overrides.entity_id ?? `entity-${entrySeq}`,
    entity_label: overrides.entity_label ?? `entity-${entrySeq}`,
    type: overrides.type ?? "modified",
    compatibility: overrides.compatibility ?? "compatible",
    lineage: overrides.lineage ?? "preserved",
    classification: overrides.classification ?? classification(),
    detail: overrides.detail ?? "Entry changed.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function architectureChangeSet(changes: GovernanceChangeEntry[] = [], compatibility: GovernanceCompatibilityStatus = "compatible"): ArchitectureChangeSet {
  return { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
export function capabilityChangeSet(changes: GovernanceChangeEntry[] = [], compatibility: GovernanceCompatibilityStatus = "compatible"): CapabilityChangeSet {
  return { schema_version: 1, id: "changeset:capability", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
export function productChangeSet(changes: GovernanceChangeEntry[] = [], compatibility: GovernanceCompatibilityStatus = "compatible"): ProductChangeSet {
  return { schema_version: 1, id: "changeset:product", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
export function portfolioChangeSet(changes: GovernanceChangeEntry[] = [], compatibility: GovernanceCompatibilityStatus = "compatible"): PortfolioChangeSet {
  return { schema_version: 1, id: "changeset:portfolio", source_snapshot_id: "source", target_snapshot_id: "target", portfolio_id: "portfolio-1", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

let evidenceChangeSeq = 0;
export function evidenceChangeEntry(overrides: Partial<GovernanceEvidenceChangeEntry> = {}): GovernanceEvidenceChangeEntry {
  evidenceChangeSeq += 1;
  return {
    id: overrides.id ?? `governance:evidence-change:test:${evidenceChangeSeq}`,
    evidence_ref: overrides.evidence_ref ?? { path: `src/file-${evidenceChangeSeq}.ts`, source_artifact: "architecture" },
    type: overrides.type ?? "added",
    related_entity_id: overrides.related_entity_id,
    detail: overrides.detail ?? "Evidence changed.",
  };
}

export function evidenceChangeSet(changes: GovernanceEvidenceChangeEntry[] = [], compatibility: GovernanceCompatibilityStatus = "compatible"): EvidenceChangeSet {
  return { schema_version: 1, id: "changeset:evidence", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

let blastEntrySeq = 0;
export function blastRadiusEntry(overrides: Partial<BlastRadiusEntry> = {}): BlastRadiusEntry {
  blastEntrySeq += 1;
  return {
    id: overrides.id ?? `governance:blast-radius-entry:test:${blastEntrySeq}`,
    change_id: overrides.change_id ?? `governance:change:test:${blastEntrySeq}`,
    level: overrides.level ?? "isolated",
    affected_entity_ids: overrides.affected_entity_ids ?? [],
    rationale: overrides.rationale ?? "Rationale.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function blastRadiusAssessment(entries: BlastRadiusEntry[] = []): BlastRadiusAssessment {
  return { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

let findingSeq = 0;
export function finding(overrides: Partial<GovernanceFinding> = {}): GovernanceFinding {
  findingSeq += 1;
  const result: GovernancePolicyResult = overrides.result ?? "pass";
  return {
    id: overrides.id ?? `governance:finding:test:${findingSeq}`,
    policy_id: overrides.policy_id ?? "governance:policy:test-policy",
    rule_id: overrides.rule_id ?? "governance:rule:test-policy:test-rule",
    change_id: overrides.change_id,
    result,
    severity: overrides.severity ?? "informational",
    statement: overrides.statement ?? "Finding statement.",
    affected_entity_ids: overrides.affected_entity_ids ?? [],
    blast_radius: overrides.blast_radius,
    human_review_required: overrides.human_review_required ?? false,
    excepted: overrides.excepted ?? result === "excepted",
    exception: overrides.exception,
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

export function evaluation(overrides: Partial<GovernanceEvaluation> = {}): GovernanceEvaluation {
  return {
    schema_version: 1,
    id: overrides.id ?? "governance:evaluation:test-policy:source:target",
    policy_id: overrides.policy_id ?? "governance:policy:test-policy",
    source_snapshot_id: "source",
    target_snapshot_id: "target",
    findings: overrides.findings ?? [],
    evidence_refs: overrides.evidence_refs ?? [],
    generation: { generated_at: GENERATED_AT },
  };
}

export function report(overrides: Partial<ContinuousIntelligenceReport> = {}): ContinuousIntelligenceReport {
  return {
    schema_version: 1,
    id: overrides.id ?? "governance:report:source:target",
    source_snapshot_id: overrides.source_snapshot_id ?? "source",
    target_snapshot_id: overrides.target_snapshot_id ?? "target",
    repository_id: overrides.repository_id,
    compatibility: overrides.compatibility ?? "compatible",
    architecture_changes: overrides.architecture_changes ?? architectureChangeSet(),
    capability_changes: overrides.capability_changes ?? capabilityChangeSet(),
    product_changes: overrides.product_changes ?? productChangeSet(),
    portfolio_changes: overrides.portfolio_changes,
    evidence_changes: overrides.evidence_changes ?? evidenceChangeSet(),
    blast_radius: overrides.blast_radius ?? blastRadiusAssessment(),
    evaluations: overrides.evaluations ?? [],
    findings: overrides.findings ?? [],
    evidence_refs: overrides.evidence_refs ?? [],
    generation: { generated_at: GENERATED_AT },
  };
}
