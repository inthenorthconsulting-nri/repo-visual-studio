export const GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Layering note
// ---------------------------------------------------------------------------
//
// Architecture Governance sits above Repository Evidence -> Architecture
// Intelligence -> Capability Intelligence -> Product Identity Intelligence ->
// Portfolio Intelligence. It never re-scans a repository and never calls an
// external model -- it only reads the already-synthesized JSON those five
// layers produced (architecture-intelligence.json, capability-model.json,
// product-identity-model.json, portfolio-model.json). Every type below is
// therefore intentionally decoupled, at both the runtime and the type level,
// from those upstream packages: nothing here imports from
// @rvs/architecture-intelligence, @rvs/capability-intelligence,
// @rvs/product-intelligence, or @rvs/portfolio-intelligence. Where this
// package needs to describe a shape those layers own (e.g. an evidence
// reference), it defines its own minimal structural echo of that shape
// instead of importing the upstream type -- exactly as
// @rvs/portfolio-intelligence does not import @rvs/architecture-intelligence
// types even though it consumes capability/product data derived from it.
//
// Determinism note: every timestamp field named `generated_at` is wall-clock
// time stamped at synthesis and is the one field excluded from every
// determinism/equality comparison this package makes (snapshot digests,
// change-set diffing, id derivation, byte-identical-output tests). Two
// governance runs over the identical input state must be recognized as
// equivalent even when run at different times or produce different
// `generated_at` values.

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A governance-local structural echo of the EvidenceReference shape used
 * across the rest of the stack (see
 * packages/architecture-intelligence/src/types.ts's EvidenceReference) --
 * intentionally duplicated rather than imported so governance-intelligence
 * carries zero type-level coupling to any upstream package. `source_artifact`
 * records which layer's already-synthesized artifact this reference was
 * carried forward from, since a single governance artifact can cite evidence
 * that originated in any of the four upstream intelligence layers (or, via
 * those layers, in the repository evidence layer beneath them).
 */
export interface EvidenceRef {
  path: string;
  lines?: string;
  source_artifact: "architecture" | "capability" | "product" | "portfolio" | "repository";
}

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/**
 * Every governance finding resolves to exactly one of these four levels:
 *
 * - blocking:         violates an explicit blocking policy, or invalidates a
 *                      contract a rule marks as required. Must stop
 *                      promotion/release until resolved or excepted.
 * - review_required:   a material, ambiguous, or evidence-weakening change
 *                      that needs human judgment before it can be trusted --
 *                      not itself a policy violation.
 * - advisory:          may matter, but does not violate a required policy.
 * - informational:     evidence-backed and worth surfacing, but no action is
 *                      required.
 */
export type GovernanceSeverity = "blocking" | "review_required" | "advisory" | "informational";

/**
 * How a single entity in an upstream artifact compares between a source
 * (baseline) snapshot and a target (current) snapshot. "unresolved" is not a
 * defect state -- insufficient or contradictory evidence to classify a change
 * must render as unresolved rather than as a guessed classification, matching
 * every upstream layer's conservative-bias requirement.
 */
export type GovernanceChangeType = "added" | "removed" | "modified" | "renamed" | "reclassified" | "unchanged" | "unresolved";

/**
 * How far a change's effects are judged to reach through the stack, from a
 * single isolated entity up to the entire portfolio. "unresolved" covers
 * cases where the upstream artifacts don't carry enough relationship/
 * dependency evidence to bound the radius at all.
 */
export type BlastRadiusLevel = "isolated" | "local" | "cross_component" | "product_wide" | "cross_product" | "portfolio_wide" | "unresolved";

/**
 * Whether a piece of evidence-backed lineage (e.g. a capability's link back
 * to its architecture component, or a product claim's link back to its
 * capability) survived the transition from the source snapshot to the target
 * snapshot.
 */
export type GovernanceLineageState = "preserved" | "strengthened" | "weakened" | "broken" | "unverifiable";

/** The outcome of evaluating one GovernanceRule against one change. */
export type GovernancePolicyResult = "pass" | "fail" | "not_applicable" | "unverifiable" | "excepted";

/** Whether an upstream domain artifact was available to a snapshot, and if so, whether it parsed into a complete, recognizable shape. */
export type GovernanceProvenance = "complete" | "partial" | "unavailable";

/** Whether two snapshots (or a snapshot and a policy) can be meaningfully compared/evaluated at all, and if so, with what caveats. */
export type GovernanceCompatibilityStatus = "compatible" | "compatible_with_warnings" | "partial" | "incompatible";

/** The four upstream intelligence domains a snapshot fingerprints. Deliberately excludes "repository": governance reads already-synthesized intelligence artifacts, never the raw repository-model/evidence-manifest layer directly. */
export type GovernanceArtifactKind = "architecture" | "capability" | "product" | "portfolio";

// ---------------------------------------------------------------------------
// Minimal shared generation metadata
// ---------------------------------------------------------------------------

/**
 * Minimal generation metadata every governance artifact carries. See the
 * determinism note at the top of this file: `generated_at` is excluded from
 * all determinism/equality comparisons this package makes.
 */
export interface GovernanceGenerationMetadata {
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Intelligence snapshot -- the fingerprint of a single point-in-time read of
// the four upstream artifacts
// ---------------------------------------------------------------------------

/** One upstream domain's contribution to a snapshot: its provenance, its content digest (when available), and just enough identity to detect schema/staleness drift without re-parsing the full artifact. */
export interface GovernanceArtifactDigest {
  artifact: GovernanceArtifactKind;
  provenance: GovernanceProvenance;
  /** The artifact's own schema_version/schemaVersion field, when the artifact was available and parsed as a record. */
  schema_version?: number;
  /** SHA-256 hex digest of the artifact's canonical (key-sorted) JSON form. Absent when provenance is not "complete". */
  digest?: string;
  /** The `generated_at` (or `generationMetadata.generated_at`) the upstream artifact itself carries -- used for staleness comparisons between snapshots, never for this snapshot's own determinism. */
  source_generated_at?: string;
}

/**
 * A deterministic fingerprint of the four upstream intelligence artifacts as
 * they existed at one point in time. Never re-derives or re-scans anything --
 * `id` and every `digest` are pure functions of the artifact content passed
 * in by the caller (see ids.ts and snapshot.ts).
 */
export interface IntelligenceSnapshot {
  schema_version: number;
  id: string;
  repository_id?: string;
  repository_name?: string;
  portfolio_id?: string;
  portfolio_name?: string;
  git_commit?: string;
  /** Sorted by the fixed domain order: architecture, capability, product, portfolio. */
  artifacts: GovernanceArtifactDigest[];
  /** Always empty for IntelligenceSnapshot: a snapshot fingerprints artifacts, it does not itself assert evidence-backed claims. Present for structural consistency with every other governance artifact type. Sorted by (source_artifact, path, lines ?? ""). */
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

/**
 * A previously captured IntelligenceSnapshot promoted to "baseline" status --
 * the fixed point every later snapshot's change sets are computed against
 * until a new baseline is explicitly established. Governance never diffs
 * against a moving target: exactly one baseline is active per repository at
 * a time (enforcement of that invariant is a caller/CLI-layer concern, not
 * this type's).
 */
export interface GovernanceBaseline {
  schema_version: number;
  id: string;
  snapshot: IntelligenceSnapshot;
  repository_id?: string;
  /** Wall-clock time the baseline was pinned; like `generated_at`, excluded from determinism comparisons. */
  established_at: string;
  /** Sorted by (source_artifact, path, lines ?? ""). */
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Change sets
// ---------------------------------------------------------------------------

/**
 * One entity-level change detected between two snapshots' view of a single
 * upstream domain (architecture / capability / product / portfolio). All
 * four *ChangeSet types below reuse this same entry shape because the
 * governance layer never re-derives domain semantics itself -- it only diffs
 * whatever stable ids and labels the upstream artifact already assigned.
 * `domain_path` records which section of the upstream artifact the entity
 * came from (e.g. "components", "includedCapabilities", "valuePillars",
 * "relationships") so a change entry stays traceable to its origin without
 * governance importing the upstream package's own types.
 */
/**
 * §15 classification dimensions, derived only from change semantics +
 * evidence state + explicit policy + compatibility effect + configured
 * thresholds -- never from broad assumption. `governance_severity` here is
 * the change's OWN intrinsic severity signal (e.g. an evidence-lineage
 * break is inherently at least review_required); the FINAL severity a
 * GovernanceFinding carries also folds in policy-evaluation results, which
 * can only raise, never lower, this intrinsic floor.
 */
export interface GovernanceChangeClassification {
  domain: GovernanceArtifactKind | "evidence";
  materiality: "material" | "qualified" | "editorial" | "unresolved";
  confidence: "confirmed" | "derived" | "suggested" | "unresolved";
  governance_severity: GovernanceSeverity;
  compatibility_impact: GovernanceCompatibilityStatus;
  evidence_impact: GovernanceLineageState;
  runtime_impact: "none" | "reduced" | "lost" | "unresolved";
  consumer_impact: BlastRadiusLevel;
  portfolio_impact: "none" | "affected" | "unresolved";
}

export interface GovernanceChangeEntry {
  id: string;
  domain_path: string;
  entity_id: string;
  entity_label: string;
  type: GovernanceChangeType;
  compatibility: GovernanceCompatibilityStatus;
  lineage: GovernanceLineageState;
  classification: GovernanceChangeClassification;
  detail: string;
  /** Sorted by (source_artifact, path, lines ?? ""). */
  evidence_refs: EvidenceRef[];
}

export interface ArchitectureChangeSet {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  /** Sorted by (type, domain_path, entity_id). */
  changes: GovernanceChangeEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

export interface CapabilityChangeSet {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  /** Sorted by (type, domain_path, entity_id). */
  changes: GovernanceChangeEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

export interface ProductChangeSet {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  /** Sorted by (type, domain_path, entity_id). */
  changes: GovernanceChangeEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

export interface PortfolioChangeSet {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  portfolio_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  /** Sorted by (type, domain_path, entity_id). */
  changes: GovernanceChangeEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

/** Evidence is never "modified" or "renamed" -- a path either newly supports a claim, no longer does, or its support became unverifiable. */
export type GovernanceEvidenceChangeType = "added" | "removed" | "unresolved";

export interface GovernanceEvidenceChangeEntry {
  id: string;
  evidence_ref: EvidenceRef;
  type: GovernanceEvidenceChangeType;
  related_entity_id?: string;
  detail: string;
}

export interface EvidenceChangeSet {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  /** Sorted by (type, evidence_ref.source_artifact, evidence_ref.path, evidence_ref.lines ?? ""). */
  changes: GovernanceEvidenceChangeEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Policy and evaluation
// ---------------------------------------------------------------------------

/**
 * §17: deliberately a FINITE set of typed rule kinds, never a general-purpose
 * expression language. Each kind's condition object is fully typed (see
 * GovernanceRuleCondition) so a policy file can only express what the
 * governance engine actually knows how to evaluate deterministically.
 */
export type GovernanceRuleKind =
  | "forbid_component_removal"
  | "require_runtime_entrypoint"
  | "require_capability_status_at_least"
  | "forbid_operational_to_planned_regression"
  | "require_evidence_type"
  | "forbid_dependency_removal"
  | "require_shared_contract_for_dependency"
  | "forbid_approved_claim_without_lineage"
  | "require_product_role"
  | "limit_unresolved_relationships"
  | "require_compatible_snapshot"
  | "require_decision_for_change"
  | "require_accepted_decision"
  | "require_decision_implementation"
  | "forbid_contradicted_assumption"
  | "forbid_active_superseded_decision"
  | "require_decision_evidence"
  | "require_decision_for_policy_exception"
  | "require_decision_for_baseline_replacement"
  | "limit_unresolved_decision_conflicts"
  | "require_decision_review_for_drift";

/**
 * Per-kind condition payloads. Every field is optional scoping (an absent
 * scope field means "applies to all entities in this rule's domain"), never
 * an expression to execute -- the evaluator (`policy-evaluator.ts`) branches
 * on `kind` and reads only the fields the matching interface below declares.
 */
export interface ForbidComponentRemovalCondition {
  kind: "forbid_component_removal";
  component_id_pattern?: string;
  component_type?: string;
}
export interface RequireRuntimeEntrypointCondition {
  kind: "require_runtime_entrypoint";
  entrypoint_id_pattern?: string;
}
export interface RequireCapabilityStatusAtLeastCondition {
  kind: "require_capability_status_at_least";
  capability_id_pattern?: string;
  minimum_status: string;
}
export interface ForbidOperationalToPlannedRegressionCondition {
  kind: "forbid_operational_to_planned_regression";
  capability_id_pattern?: string;
}
export interface RequireEvidenceTypeCondition {
  kind: "require_evidence_type";
  entity_id_pattern?: string;
  required_evidence_source: EvidenceRef["source_artifact"];
}
export interface ForbidDependencyRemovalCondition {
  kind: "forbid_dependency_removal";
  dependency_id_pattern?: string;
}
export interface RequireSharedContractForDependencyCondition {
  kind: "require_shared_contract_for_dependency";
  dependency_id_pattern?: string;
}
export interface ForbidApprovedClaimWithoutLineageCondition {
  kind: "forbid_approved_claim_without_lineage";
  claim_id_pattern?: string;
}
export interface RequireProductRoleCondition {
  kind: "require_product_role";
  product_id_pattern?: string;
  required_role: string;
}
export interface LimitUnresolvedRelationshipsCondition {
  kind: "limit_unresolved_relationships";
  max_unresolved: number;
}
export interface RequireCompatibleSnapshotCondition {
  kind: "require_compatible_snapshot";
  minimum_status: GovernanceCompatibilityStatus;
}

/**
 * §36-38 (decision-aware policy extension): the 10 additional rule kinds
 * added by Milestone 8's governance-policy-extension. Each condition below
 * is scoped only by an id/rule pattern (or, for
 * RequireDecisionForBaselineReplacementCondition, nothing at all) -- the
 * evaluator's own doc comments in policy-evaluator.ts document exactly how
 * far each rule can be verified given DecisionGovernanceContext's flat,
 * id-array-only shape.
 */
export interface RequireDecisionForChangeCondition {
  kind: "require_decision_for_change";
  entity_id_pattern?: string;
}
export interface RequireAcceptedDecisionCondition {
  kind: "require_accepted_decision";
  entity_id_pattern?: string;
}
export interface RequireDecisionImplementationCondition {
  kind: "require_decision_implementation";
  entity_id_pattern?: string;
}
export interface ForbidContradictedAssumptionCondition {
  kind: "forbid_contradicted_assumption";
  decision_id_pattern?: string;
}
export interface ForbidActiveSupersededDecisionCondition {
  kind: "forbid_active_superseded_decision";
  decision_id_pattern?: string;
}
export interface RequireDecisionEvidenceCondition {
  kind: "require_decision_evidence";
  entity_id_pattern?: string;
}
export interface RequireDecisionForPolicyExceptionCondition {
  kind: "require_decision_for_policy_exception";
  rule_id_pattern?: string;
}
export interface RequireDecisionForBaselineReplacementCondition {
  kind: "require_decision_for_baseline_replacement";
}
export interface LimitUnresolvedDecisionConflictsCondition {
  kind: "limit_unresolved_decision_conflicts";
  max_unresolved: number;
}
export interface RequireDecisionReviewForDriftCondition {
  kind: "require_decision_review_for_drift";
  decision_id_pattern?: string;
}

export type GovernanceRuleCondition =
  | ForbidComponentRemovalCondition
  | RequireRuntimeEntrypointCondition
  | RequireCapabilityStatusAtLeastCondition
  | ForbidOperationalToPlannedRegressionCondition
  | RequireEvidenceTypeCondition
  | ForbidDependencyRemovalCondition
  | RequireSharedContractForDependencyCondition
  | ForbidApprovedClaimWithoutLineageCondition
  | RequireProductRoleCondition
  | LimitUnresolvedRelationshipsCondition
  | RequireCompatibleSnapshotCondition
  | RequireDecisionForChangeCondition
  | RequireAcceptedDecisionCondition
  | RequireDecisionImplementationCondition
  | ForbidContradictedAssumptionCondition
  | ForbidActiveSupersededDecisionCondition
  | RequireDecisionEvidenceCondition
  | RequireDecisionForPolicyExceptionCondition
  | RequireDecisionForBaselineReplacementCondition
  | LimitUnresolvedDecisionConflictsCondition
  | RequireDecisionReviewForDriftCondition;

/** §19: never implicit -- an exception must name a policy/scope/reason/approval reference to apply at all. */
export interface GovernanceException {
  policy_id: string;
  rule_id: string;
  scope?: string;
  reason: string;
  approval_reference: string;
  expiry?: string;
  /**
   * §38: an optional pointer to the ArchitectureDecision id (a concept owned
   * entirely by @rvs/decision-intelligence) that supports this exception.
   * governance-intelligence only carries this field through -- it never
   * resolves, validates existence/expiry/scope-match of, or otherwise
   * interprets the referenced decision itself; that validation is
   * decision-intelligence's governance-links.ts's job. The linked decision
   * supports the exception, it does not replace the exception record (the
   * exception's own reason/approval_reference/expiry remain authoritative).
   */
  decision_ref?: string;
  evidence_refs: EvidenceRef[];
}

export interface GovernanceRule {
  id: string;
  title: string;
  description: string;
  kind: GovernanceRuleKind;
  condition: GovernanceRuleCondition;
  severity: GovernanceSeverity;
  enabled: boolean;
  evidence_requirement?: EvidenceRef["source_artifact"];
  effective_from?: string;
  owner_ref?: string;
}

export interface GovernancePolicy {
  schema_version: number;
  id: string;
  name: string;
  /** Sorted by id. */
  rules: GovernanceRule[];
  /** Sorted by (policy_id, rule_id, scope ?? ""). */
  exceptions: GovernanceException[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

export interface GovernanceFinding {
  id: string;
  policy_id: string;
  rule_id: string;
  change_id?: string;
  result: GovernancePolicyResult;
  severity: GovernanceSeverity;
  statement: string;
  affected_entity_ids: string[];
  blast_radius?: BlastRadiusLevel;
  human_review_required: boolean;
  /** True only when a non-expired GovernanceException matched this finding's policy_id/rule_id/scope. The underlying finding is never deleted when excepted -- only its enforcement status (result: "excepted") changes. */
  excepted: boolean;
  exception?: GovernanceException;
  /** Sorted by (source_artifact, path, lines ?? ""). */
  evidence_refs: EvidenceRef[];
}

export interface GovernanceEvaluation {
  schema_version: number;
  id: string;
  policy_id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  /** Sorted by severity rank (blocking, review_required, advisory, informational), then id. */
  findings: GovernanceFinding[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export interface BlastRadiusEntry {
  id: string;
  change_id: string;
  level: BlastRadiusLevel;
  /** Sorted lexicographically. */
  affected_entity_ids: string[];
  rationale: string;
  evidence_refs: EvidenceRef[];
}

export interface BlastRadiusAssessment {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  /** Sorted by level rank (isolated, local, cross_component, product_wide, cross_product, portfolio_wide, unresolved), then change_id. */
  entries: BlastRadiusEntry[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

/**
 * §36-38: the decision-derived facts @rvs/decision-intelligence hands to
 * this package's policy evaluator as its optional 5th domain, exactly the
 * way `portfolio_changes`/`portfolioChanges` was added as the optional 4th
 * domain. Declared independently here as governance-intelligence's OWN
 * structural echo of decision-intelligence's `DecisionGovernanceContextEcho`
 * (packages/decision-intelligence/src/contracts.ts) -- governance never
 * imports from @rvs/decision-intelligence, since governance stays the more
 * foundational package and must not depend "up" on a layer built on top of
 * it. Every field is a flat array of decision/change ids that
 * decision-intelligence has already computed deterministically; governance
 * only checks membership, it never re-derives the underlying decision
 * analysis.
 */
export interface DecisionGovernanceContext {
  changes_missing_decision: string[];
  decisions_with_contradicted_assumptions: string[];
  decisions_active_and_superseded: string[];
  exceptions_with_invalid_decision_ref: string[];
  unresolved_conflict_decision_ids: string[];
  decisions_requiring_review_for_drift: string[];
}

// ---------------------------------------------------------------------------
// Continuous intelligence report -- the governance pipeline's terminal
// rollup artifact
// ---------------------------------------------------------------------------

export interface ContinuousIntelligenceReport {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  repository_id?: string;
  compatibility: GovernanceCompatibilityStatus;
  architecture_changes: ArchitectureChangeSet;
  capability_changes: CapabilityChangeSet;
  product_changes: ProductChangeSet;
  portfolio_changes?: PortfolioChangeSet;
  /** Opt-in: present only when a decision snapshot existed for this comparison. Absent, governance evaluation is byte-identical to pre-Milestone-8 behavior. */
  decision_changes?: DecisionGovernanceContext;
  evidence_changes: EvidenceChangeSet;
  blast_radius: BlastRadiusAssessment;
  /** Sorted by policy_id. */
  evaluations: GovernanceEvaluation[];
  /** Flattened from `evaluations[].findings`, sorted by severity rank then id (same ordering as GovernanceEvaluation.findings). */
  findings: GovernanceFinding[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Narrative and plan
// ---------------------------------------------------------------------------

/** §26: three-state claim-control vocabulary, matching Product/Portfolio Intelligence's own approved/qualified/rejected shape -- but governance's rejection-reason vocabulary below is its OWN, per the spec's explicit instruction not to reuse Product/Portfolio codes where semantics differ. */
export type GovernanceClaimStatus = "approved" | "qualified" | "rejected";

/** §26's exact rejection-code vocabulary. Never reused from @rvs/product-intelligence or @rvs/portfolio-intelligence's own rejection codes. */
export type GovernanceClaimRejectionReason =
  | "unsupported_safety_claim"
  | "unsupported_no_impact_claim"
  | "unsupported_improvement_claim"
  | "unsupported_risk_reduction"
  | "unsupported_completeness_claim"
  | "missing_lineage"
  | "unresolved_blast_radius"
  | "incompatible_snapshot"
  | "partial_snapshot"
  | "policy_result_mismatch";

export type GovernanceClaimType = "no_regression" | "policy_compliance" | "lineage_integrity" | "blast_radius_bound" | "evidence_strength";

export interface GovernanceClaim {
  id: string;
  text: string;
  claim_type: GovernanceClaimType;
  status: GovernanceClaimStatus;
  rejection_reason?: GovernanceClaimRejectionReason;
  qualifiers: string[];
  evidence_refs: EvidenceRef[];
}

export interface GovernanceNarrative {
  schema_version: number;
  id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  summary: string;
  whatChanged: string;
  whyItMatters: string;
  riskAssessment: string;
  recommendedActions: string;
  /** Sorted by id. */
  approvedClaims: GovernanceClaim[];
  /** Sorted by id. */
  rejectedClaims: GovernanceClaim[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

/**
 * §28: the 13 governance presentation scene kinds, in their canonical
 * sequence. A single `governance-scene` VisualDoc type (defined in
 * @rvs/visualdoc-schema) carries only a `plan_id`/`scene_id` pointer into
 * `GovernancePlan.scenes[]` -- this array is the one place actual per-scene
 * content and ordering live, mirroring @rvs/portfolio-intelligence's
 * portfolio-plan.ts pointer-scene pattern exactly ("avoid parallel rendering
 * architecture", spec §28).
 */
export type GovernanceSceneKind =
  | "governance-hero"
  | "snapshot-comparison"
  | "change-summary"
  | "architecture-change-map"
  | "capability-regression"
  | "product-change"
  | "portfolio-change"
  | "evidence-regression"
  | "blast-radius"
  | "policy-findings"
  | "exceptions"
  | "decision-required"
  | "governance-validation";

/**
 * One scene's fully-resolved content. `renderer-html`'s
 * scenes/governance/render.ts switches on `kind` to lay it out; the shape of
 * `data` for each kind is intentionally loose (Record<string, unknown>)
 * because each kind's payload is a different projection of
 * ContinuousIntelligenceReport/GovernanceNarrative fields -- typed narrowing
 * happens in governance-plan.ts's builder functions and in render.ts's
 * switch, not duplicated again here.
 */
export interface GovernanceSceneContent {
  scene_id: string;
  kind: GovernanceSceneKind;
  title: string;
  /** Evidence-gated: a scene is present in this array only when the underlying report/narrative has evidence to show for it (e.g. no empty "portfolio-change" scene for a repository-only snapshot with no portfolio artifact). */
  data: Record<string, unknown>;
  evidence_refs: EvidenceRef[];
}

export interface GovernancePlan {
  schema_version: number;
  id: string;
  report: ContinuousIntelligenceReport;
  narrative: GovernanceNarrative;
  /** Sorted by the canonical GovernanceSceneKind sequence given above, then scene_id. Evidence-gated -- see GovernanceSceneContent. */
  scenes: GovernanceSceneContent[];
  evidence_refs: EvidenceRef[];
  generation: GovernanceGenerationMetadata;
}

// ---------------------------------------------------------------------------
// Compatibility result
// ---------------------------------------------------------------------------

/** Never a bare boolean: names exactly which staged check(s) produced the status, so a caller/human always knows why two snapshots were judged compatible/partial/incompatible. */
export interface GovernanceCompatibilityResult {
  status: GovernanceCompatibilityStatus;
  reasons: string[];
}
