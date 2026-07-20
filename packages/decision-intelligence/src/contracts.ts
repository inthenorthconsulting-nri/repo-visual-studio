export const DECISION_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Layering note
// ---------------------------------------------------------------------------
//
// Architecture Decision Intelligence sits above Repository Evidence ->
// Architecture Intelligence -> Capability Intelligence -> Product Identity
// Intelligence -> Portfolio Intelligence -> Architecture Governance. It
// discovers and normalizes a repository's own decision documents (ADRs,
// RFCs, design decisions, decision logs) and links them to those six layers,
// but it never re-scans repository source itself and never calls an external
// model. Every type below is therefore intentionally decoupled, at both the
// runtime and the type level, from every upstream package: nothing here
// imports from @rvs/architecture-intelligence, @rvs/capability-intelligence,
// @rvs/product-intelligence, @rvs/portfolio-intelligence, or
// @rvs/governance-intelligence. Where this package needs to describe a shape
// one of those layers owns (e.g. an evidence reference, or an upstream
// snapshot identity), it defines its own minimal structural echo of that
// shape instead of importing the upstream type -- exactly as
// @rvs/governance-intelligence does not import upstream intelligence types
// even though it consumes their already-synthesized artifacts.
//
// Reference, never embed: a DecisionSnapshot records the upstream
// IntelligenceSnapshot it was built alongside as a `{ snapshot_id, digest,
// schema_version }` pointer only (see UpstreamSnapshotRef below) -- it never
// copies the full upstream artifact into its own output.
//
// Determinism note: every timestamp field named `generated_at` is wall-clock
// time stamped at synthesis and is the one field excluded from every
// determinism/equality comparison this package makes (snapshot digests,
// change-set diffing, id derivation, byte-identical-output tests). Two
// decision-intelligence runs over identical input state must be recognized
// as equivalent even when run at different times or produce different
// `generated_at` values. Decision truth is never derived from filesystem
// mtime, scan order, or array/iteration index.

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A decision-intelligence-local structural echo of the evidence-reference
 * shape used across the rest of the stack -- intentionally duplicated rather
 * than imported so this package carries zero type-level coupling to any
 * upstream package. `source_artifact` records which layer's already-
 * synthesized artifact (or decision document itself) this reference was
 * drawn from.
 */
export interface EvidenceRef {
  path: string;
  lines?: string;
  source_artifact: "architecture" | "capability" | "product" | "portfolio" | "governance" | "decision" | "repository";
}

/**
 * A pointer to an upstream IntelligenceSnapshot (produced by
 * `rvs snapshot create`, consumed by @rvs/governance-intelligence), recorded
 * by identity/digest/schema-version only -- never the embedded artifact
 * contents. Absent when a decision snapshot was built without any compatible
 * upstream snapshot available.
 */
export interface UpstreamSnapshotRef {
  snapshot_id: string;
  digest: string;
  schema_version: number;
}

// ---------------------------------------------------------------------------
// Decision source discovery
// ---------------------------------------------------------------------------

export type DecisionSourceType = "adr" | "rfc" | "design_decision" | "decision_log" | "unsupported";

/** One discovered candidate decision document, before or after successful parsing. */
export interface DecisionSource {
  id: string;
  repo_relative_path: string;
  source_type: DecisionSourceType;
  content_digest: string;
  classification_basis: "configured_path" | "frontmatter" | "heading_pattern" | "filename_convention" | "explicit_type_field" | "none";
  evidence_refs: EvidenceRef[];
}

export type DecisionSourceIssueKind =
  | "duplicate_id_exact"
  | "duplicate_id_case_only"
  | "multiple_files_claim_one_id"
  | "id_reused_with_changed_content"
  | "unparseable_structure"
  | "unsupported_source_type";

/** A structural problem found during discovery/identity resolution -- always surfaced, never silently resolved. */
export interface DecisionSourceIssue {
  id: string;
  kind: DecisionSourceIssueKind;
  affected_paths: string[];
  detail: string;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Decision statuses -- three independent axes, never derived from each other
// ---------------------------------------------------------------------------

export type DecisionStatus =
  | "draft"
  | "proposed"
  | "under_review"
  | "accepted"
  | "rejected"
  | "superseded"
  | "deprecated"
  | "withdrawn"
  | "implemented"
  | "partially_implemented"
  | "unknown";

export type DecisionImplementationStatus = "not_started" | "partial" | "implemented" | "regressed" | "superseded" | "unverifiable" | "not_applicable";

/** Populated only once governance-links.ts has resolved the decision against configured governance policy/exceptions. */
export type DecisionGovernanceStatus = "aligned" | "review_required" | "conflicting" | "unverifiable";

export type DecisionScope = "component" | "capability" | "product" | "portfolio" | "cross_cutting" | "unresolved";

// ---------------------------------------------------------------------------
// Core decision record
// ---------------------------------------------------------------------------

export interface ArchitectureDecision {
  schema_version: 1;
  id: string;
  source: DecisionSource;
  title: string;
  decision_status: DecisionStatus;
  implementation_status: DecisionImplementationStatus;
  governance_status?: DecisionGovernanceStatus;
  scope: DecisionScope;
  context?: string;
  decision_text?: string;
  authors: string[];
  date?: string;
  supersedes: string[];
  superseded_by: string[];
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Assumptions / consequences / alternatives
// ---------------------------------------------------------------------------

export type DecisionAssumptionState = "confirmed" | "supported" | "weakened" | "contradicted" | "unverifiable" | "retired";

export interface DecisionAssumption {
  id: string;
  decision_id: string;
  statement: string;
  state: DecisionAssumptionState;
  evidence_refs: EvidenceRef[];
}

export type DecisionConsequenceClass = "positive" | "negative" | "neutral" | "tradeoff" | "risk" | "obligation" | "constraint" | "unclassified";

export interface DecisionConsequence {
  id: string;
  decision_id: string;
  statement: string;
  classification: DecisionConsequenceClass;
  evidence_refs: EvidenceRef[];
}

export type DecisionAlternativeState = "considered" | "rejected" | "deferred" | "selected" | "unknown";

export interface DecisionAlternative {
  id: string;
  decision_id: string;
  statement: string;
  state: DecisionAlternativeState;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type DecisionLinkType =
  | "governs"
  | "introduces"
  | "removes"
  | "replaces"
  | "constrains"
  | "permits"
  | "deprecates"
  | "requires"
  | "explains"
  | "justifies"
  | "depends_on"
  | "implements"
  | "validates"
  | "excepts"
  | "affects"
  | "references";

export type DecisionLinkResolution = "resolved" | "partially_resolved" | "unresolved" | "ambiguous" | "incompatible";

export type DecisionLinkTargetDomain = "architecture" | "capability" | "product" | "portfolio" | "governance" | "decision";

/** Unresolved links are always kept in the output -- never dropped, per the conservative-bias convention every layer below Governance already follows. */
export interface DecisionLink {
  id: string;
  decision_id: string;
  link_type: DecisionLinkType;
  target_domain: DecisionLinkTargetDomain;
  target_id?: string;
  resolution: DecisionLinkResolution;
  detail: string;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Dependencies (decision-to-decision graph)
// ---------------------------------------------------------------------------

export type DecisionDependencyType = "depends_on" | "blocks" | "requires" | "is_required_by" | "related_to" | "conflicts_with";

export interface DecisionDependency {
  id: string;
  from_decision_id: string;
  to_decision_id: string;
  dependency_type: DecisionDependencyType;
  evidence_refs: EvidenceRef[];
}

export type DecisionCycleClassification = "informational_allowed" | "blocking_flagged" | "supersession_invalid";

export interface DecisionDependencyCycle {
  id: string;
  decision_ids: string[];
  classification: DecisionCycleClassification;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

export type DecisionSupersessionIssueKind =
  | "missing_target"
  | "reciprocal_inconsistency"
  | "multiple_active_superseders"
  | "supersession_cycle";

export interface DecisionSupersessionIssue {
  id: string;
  kind: DecisionSupersessionIssueKind;
  decision_ids: string[];
  detail: string;
  evidence_refs: EvidenceRef[];
}

export interface DecisionSupersessionChain {
  id: string;
  decision_ids_in_order: string[];
  is_valid: boolean;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export type DecisionConflictStatus = "confirmed" | "probable" | "possible" | "resolved" | "unverifiable";

export type DecisionConflictKind =
  | "incompatible_required_states"
  | "mutually_exclusive_requirements"
  | "accepted_depends_on_rejected"
  | "active_and_superseded_simultaneously"
  | "incompatible_baseline_policy_linkage";

export interface DecisionConflict {
  id: string;
  decision_ids: [string, string];
  kind: DecisionConflictKind;
  status: DecisionConflictStatus;
  detail: string;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Coverage, implementation state, missing detection
// ---------------------------------------------------------------------------

export interface DecisionCoverageMetric {
  id: string;
  dimension: "architecture_entities" | "capabilities" | "products" | "portfolio_relationships" | "governance_exceptions";
  numerator: number;
  denominator: number;
  evidence_refs: EvidenceRef[];
}

export interface DecisionImplementationState {
  id: string;
  decision_id: string;
  status: DecisionImplementationStatus;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export type MissingDecisionRuleKind =
  | "runtime_entrypoint_change_without_decision"
  | "shared_contract_change_without_decision"
  | "baseline_replacement_without_decision"
  | "policy_exception_without_decision"
  | "product_role_change_without_decision"
  | "portfolio_relationship_change_without_decision";

export interface MissingDecisionFinding {
  id: string;
  rule_kind: MissingDecisionRuleKind;
  affected_entity_id: string;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export type MissingImplementationStatus = "implementation_missing" | "partial" | "conflicting" | "unverifiable";

export interface MissingImplementationFinding {
  id: string;
  decision_id: string;
  status: MissingImplementationStatus;
  detail: string;
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Drift and debt
// ---------------------------------------------------------------------------

export type DecisionDriftSeverity = "blocking" | "review_required" | "advisory" | "informational";

export type DecisionDriftCause =
  | "linked_entity_removed"
  | "linked_entity_materially_changed"
  | "assumption_contradicted"
  | "implementation_regressed"
  | "governance_status_downgraded"
  | "upstream_artifact_incompatible"
  | "supersession_target_removed"
  | "conflict_introduced"
  | "coverage_regressed"
  | "criticality_upgraded_without_review"
  | "evidence_lineage_broken"
  | "decision_document_unparseable"
  | "policy_exception_expired";

export interface DecisionDrift {
  id: string;
  decision_id: string;
  cause: DecisionDriftCause;
  severity: DecisionDriftSeverity;
  detail: string;
  /** Populated by the caller (decisions-analyze.ts) after blast-radius assessment, by decision_id lookup -- this package's own detectDecisionDrift() never computes it. */
  blast_radius_id?: string;
  evidence_refs: EvidenceRef[];
}

export type DecisionDebtCategory =
  | "accepted_without_implementation"
  | "implementation_regressed_from_decision"
  | "stale_proposed_decision"
  | "unresolved_conflict"
  | "broken_supersession_chain"
  | "missing_required_decision"
  | "contradicted_assumption_unaddressed"
  | "expired_policy_exception"
  | "unverifiable_governance_status"
  | "orphaned_decision"
  | "duplicate_decision_identity"
  | "unparseable_decision_document"
  | "incompatible_upstream_linkage"
  | "criticality_unreviewed";

export interface DecisionDebtFinding {
  id: string;
  category: DecisionDebtCategory;
  decision_id: string;
  severity: DecisionDriftSeverity;
  blast_radius_id?: string;
  resolution_state: "open" | "acknowledged" | "resolved";
  requires_human_review: boolean;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export type DecisionCriticality = "critical" | "elevated" | "standard" | "unresolved";

export interface DecisionCriticalityAssessment {
  decision_id: string;
  criticality: DecisionCriticality;
  basis: string[];
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Blast radius (decision-scoped)
// ---------------------------------------------------------------------------

export type DecisionBlastRadiusLevel = "isolated" | "local" | "cross_component" | "cross_layer" | "portfolio_wide" | "unresolved";

export interface DecisionBlastRadiusAssessment {
  id: string;
  decision_id: string;
  level: DecisionBlastRadiusLevel;
  affected_entity_ids: string[];
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Snapshot, compatibility, comparison
// ---------------------------------------------------------------------------

export type DecisionSnapshotCompatibilityStatus = "complete" | "partial" | "unavailable";

export interface DecisionSnapshot {
  schema_version: 1;
  id: string;
  generated_at: string;
  repository_id: string;
  digest: string;
  upstream_snapshot?: UpstreamSnapshotRef;
  decisions: ArchitectureDecision[];
  source_issues: DecisionSourceIssue[];
  compatibility: DecisionSnapshotCompatibilityStatus;
}

export interface DecisionSnapshotCompatibility {
  status: "compatible" | "incompatible";
  reasons: string[];
}

export type DecisionChangeType = "added" | "removed" | "modified" | "unchanged" | "unresolved";
export type DecisionChangeClassification = "editorial" | "metadata" | "material" | "governance_relevant" | "unresolved";

export interface DecisionChange {
  id: string;
  decision_id: string;
  change_type: DecisionChangeType;
  classification: DecisionChangeClassification;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export interface DecisionChangeSet {
  schema_version: 1;
  id: string;
  generated_at: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  compatibility: DecisionSnapshotCompatibility;
  changes: DecisionChange[];
}

// ---------------------------------------------------------------------------
// Governance integration (structural echo, never imports @rvs/governance-intelligence)
// ---------------------------------------------------------------------------

/**
 * The decision-derived facts decision-intelligence hands to
 * @rvs/governance-intelligence's policy evaluator as its optional
 * `decisionContext` domain (see governance-policy-extension.ts). Governance
 * itself only carries this shape through -- it is defined independently in
 * governance-intelligence/src/contracts.ts as its own structural echo, never
 * imported from this package, since governance must not depend "up" on
 * decision-intelligence.
 */
export interface DecisionGovernanceContextEcho {
  changes_missing_decision: string[];
  decisions_with_contradicted_assumptions: string[];
  decisions_active_and_superseded: string[];
  exceptions_with_invalid_decision_ref: string[];
  unresolved_conflict_decision_ids: string[];
  decisions_requiring_review_for_drift: string[];
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export type DecisionClaimStatus = "approved" | "qualified" | "rejected";

export type DecisionClaimRejectionCode =
  | "missing_decision_evidence"
  | "unsupported_approval_claim"
  | "unsupported_implementation_claim"
  | "unsupported_quality_claim"
  | "unsupported_safety_claim"
  | "missing_architecture_link"
  | "missing_capability_link"
  | "missing_governance_link"
  | "contradicted_assumption"
  | "unresolved_conflict"
  | "broken_supersession"
  | "partial_snapshot"
  | "incompatible_upstream_artifact"
  | "unresolved_implementation_state";

export interface DecisionClaimDraft {
  claim_type: string;
  subject_decision_id: string;
  statement: string;
  evidence_refs: EvidenceRef[];
}

export interface DecisionClaim {
  id: string;
  claim_type: string;
  subject_decision_id: string;
  statement: string;
  status: DecisionClaimStatus;
  rejection_codes: DecisionClaimRejectionCode[];
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface DecisionNarrativeSection {
  heading: string;
  body: string;
}

export interface DecisionNarrative {
  id: string;
  generated_at: string;
  source_snapshot_id: string;
  target_snapshot_id?: string;
  sections: DecisionNarrativeSection[];
}

// ---------------------------------------------------------------------------
// Presentation plan
// ---------------------------------------------------------------------------

export type DecisionSceneKind =
  | "decision-hero"
  | "decision-landscape"
  | "decision-status"
  | "decision-architecture-map"
  | "decision-capability-map"
  | "decision-product-map"
  | "decision-portfolio-map"
  | "decision-implementation"
  | "decision-assumptions"
  | "decision-supersession"
  | "decision-conflicts"
  | "decision-coverage"
  | "decision-drift"
  | "decision-debt"
  | "decision-governance-impact"
  | "decision-review-required"
  | "decision-validation";

export interface DecisionSceneContent {
  scene_id: string;
  kind: DecisionSceneKind;
  title: string;
  body: unknown;
  evidence_refs: EvidenceRef[];
}

export interface DecisionPlan {
  id: string;
  generated_at: string;
  source_snapshot_id: string;
  scenes: DecisionSceneContent[];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface DecisionIntelligenceReport {
  schema_version: 1;
  id: string;
  generated_at: string;
  snapshot_id: string;
  decision_count: number;
  coverage: DecisionCoverageMetric[];
  findings_by_severity: Record<DecisionDriftSeverity, number>;
  /** Populated by the caller (decisions-analyze.ts) once blast-radius assessment has run; absent when it has not. */
  blast_radius_by_level?: Record<DecisionBlastRadiusLevel, number>;
  unresolved_count: number;
}
