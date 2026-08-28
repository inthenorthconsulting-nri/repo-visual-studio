// Public types for @rvs/change-workbench.
//
// North star (Milestone 11, verbatim): "Milestone 11 enables RVS to
// evaluate explicitly described, not-yet-applied architecture changes
// against the current evidence graph and produce deterministic impact,
// governance, and decision advisories, while preserving the boundary
// between observed architecture and proposed architecture and without
// applying changes itself."
//
// Truth model this package enforces at the type level:
//   observed architecture (KnowledgeNode[]/KnowledgeEdge[], upstream truth)
//     -> ProposedChangeSet (caller-authored hypothetical, never persisted
//        as authoritative)
//     -> ChangeAdvisory (deterministic derived assessment of the
//        hypothetical, explicitly non-authoritative)
//     -> actual post-change architecture (only obtainable via a later real
//        scan -- this package never produces one).
// A ProposedChangeSet/ChangeAdvisory can never self-promote into observed
// truth; nothing in this package writes to knowledge-graph's own cache
// files or mutates a KnowledgeNode/KnowledgeEdge in place.

import type { EvidenceRef, KnowledgeEdge, KnowledgeEdgeType, KnowledgeNode, KnowledgeNodeType, UpstreamSourceArtifact } from "@rvs/knowledge-graph";

export type { EvidenceRef };

// ---------------------------------------------------------------------------
// Entity references and their runtime trust boundary (see refs.ts)
// ---------------------------------------------------------------------------

/**
 * A reference to an entity confirmed present in the observed knowledge
 * graph. TypeScript branding alone is NOT the trust boundary -- the only
 * way to mint one is `tryConfirmEntityRef()` in refs.ts, which performs an
 * actual lookup against a loaded `KnowledgeNode[]`. No public API exposes
 * an unrestricted `as ConfirmedEntityRef` cast.
 */
export type ConfirmedEntityRef = string & { readonly __brand: "ConfirmedEntityRef" };

/**
 * A reference to an entity this proposal itself introduces (via
 * `add_entity`) that does not exist in the observed graph. Minted by
 * `proposeEntityRef()` in refs.ts as a pure, deterministic function of the
 * proposal's own declared identity -- never randomly generated, matching
 * the repository's content-derived-id convention.
 */
export type ProposedEntityRef = string & { readonly __brand: "ProposedEntityRef" };

/**
 * A reference to an existing, confirmed entity that is itself the SUBJECT
 * of a mutation in this proposal (`remove_entity` / `modify_attributes`, or
 * a relation operation's mutated endpoint) -- distinct from
 * `ConfirmedEntityRef`, which may also be used to reference an existing
 * entity purely as unchanged context (e.g. the far endpoint of an
 * `add_relation`). Minted only from an already-confirmed ref via
 * `mutateExistingEntityRef()` in refs.ts, so the trust boundary composes:
 * you cannot construct one without first passing the confirmed-lookup gate.
 */
export type ExistingEntityMutationRef = string & { readonly __brand: "ExistingEntityMutationRef" };

// ---------------------------------------------------------------------------
// The six frozen semantic proposal primitives -- no `rename` primitive.
// Display-name rename is `modify_attributes({ label })`; an identity/
// source-key change is a distinct, never-auto-inferred remove+add+
// relation-remap the caller must express explicitly as three operations.
// ---------------------------------------------------------------------------

export type ProposalOperationKind = "add_entity" | "remove_entity" | "modify_attributes" | "add_relation" | "remove_relation" | "modify_relation";

export interface AddEntityOperation {
  kind: "add_entity";
  ref: ProposedEntityRef;
  node_type: KnowledgeNodeType;
  source_artifact: UpstreamSourceArtifact;
  /** The entity's proposed source-system id (mirrors KnowledgeNode.source_entity_id) -- part of the content `ref` was derived from, never re-declared independently of it. */
  proposed_source_entity_id: string;
  label: string;
  repository_id: string;
  /** Only `label`/`evidence_refs`-shaped keys are meaningful here; see attribute-support.ts. Anything else is disclosed as unsupported/unresolved, never silently applied. */
  attributes?: Record<string, unknown>;
  evidence_refs?: EvidenceRef[];
}

export interface RemoveEntityOperation {
  kind: "remove_entity";
  ref: ExistingEntityMutationRef;
  detail?: string;
}

export interface ModifyAttributesOperation {
  kind: "modify_attributes";
  ref: ExistingEntityMutationRef;
  attributes: Record<string, unknown>;
}

export interface AddRelationOperation {
  kind: "add_relation";
  from_ref: ConfirmedEntityRef | ProposedEntityRef;
  to_ref: ConfirmedEntityRef | ProposedEntityRef;
  edge_type: KnowledgeEdgeType;
  detail?: string;
  evidence_refs?: EvidenceRef[];
}

export interface RemoveRelationOperation {
  kind: "remove_relation";
  from_ref: ConfirmedEntityRef;
  to_ref: ConfirmedEntityRef;
  edge_type: KnowledgeEdgeType;
  detail?: string;
}

export interface ModifyRelationOperation {
  kind: "modify_relation";
  from_ref: ConfirmedEntityRef;
  to_ref: ConfirmedEntityRef;
  edge_type: KnowledgeEdgeType;
  /** Only `detail` is a supported edge attribute; see attribute-support.ts. */
  attributes: Record<string, unknown>;
}

export type ProposalOperation =
  | AddEntityOperation
  | RemoveEntityOperation
  | ModifyAttributesOperation
  | AddRelationOperation
  | RemoveRelationOperation
  | ModifyRelationOperation;

// ---------------------------------------------------------------------------
// Attribute-support model
// ---------------------------------------------------------------------------

export type AttributeSupportStatus = "supported" | "unsupported" | "unresolved";

export interface AttributeSupportFinding {
  key: string;
  status: AttributeSupportStatus;
  detail: string;
}

// ---------------------------------------------------------------------------
// ProposedChangeSet -- the caller-authored hypothetical. Identity is a pure
// function of `repository_id` + canonicalized `operations`; no timestamp is
// part of identity material (two proposals with identical operations
// authored at different times are the same proposal).
// ---------------------------------------------------------------------------

export interface ProposedChangeSet {
  schema_version: number;
  id: string;
  repository_id: string;
  title?: string;
  operations: ProposalOperation[];
  evidence_refs?: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Proposal completeness validation
// ---------------------------------------------------------------------------

export type ProposalValidationStatus = "valid_sufficient" | "valid_partial" | "unresolved" | "invalid";

export interface ProposalValidationIssue {
  code: string;
  operation_index: number;
  detail: string;
  blocking: boolean;
}

export interface ProposalValidationResult {
  status: ProposalValidationStatus;
  issues: ProposalValidationIssue[];
}

// ---------------------------------------------------------------------------
// Topology disclosure -- never implies zero impact from missing topology.
// ---------------------------------------------------------------------------

export type TopologyDisclosureStatus = "explicit" | "not_supplied" | "partial" | "unresolved";

export interface TopologyDisclosure {
  status: TopologyDisclosureStatus;
  detail: string;
  /** Entity refs (proposed or confirmed) this disclosure covers. */
  entity_refs: string[];
}

// ---------------------------------------------------------------------------
// Ephemeral overlay (see overlay.ts) -- deliberately NOT a GraphSnapshot:
// it carries no `id`/`digest` implying authoritative status, and it is
// never written to knowledge-graph's own cache.
// ---------------------------------------------------------------------------

export type OverlayEntityProvenance = "confirmed" | "proposed" | "modified" | "removed";

export interface OverlayBuildIssue {
  code: string;
  operation_index?: number;
  detail: string;
  blocking: boolean;
}

/**
 * The ephemeral overlay itself. Deliberately not a `GraphSnapshot`: it
 * carries no `id`/`digest` implying authoritative status, `nodes`/`edges`
 * are plain mutable arrays scoped to this call only (never the caller's
 * original confirmed arrays, which are never mutated), and it is never
 * written to knowledge-graph's own cache.
 */
export interface ChangeOverlay {
  repository_id: string;
  base_snapshot_digest: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  node_provenance: Record<string, OverlayEntityProvenance>;
  edge_provenance: Record<string, OverlayEntityProvenance>;
}

export type OverlayBuildStatus = "ok" | "unresolved" | "invalid";

export interface OverlayBuildResult {
  status: OverlayBuildStatus;
  overlay?: ChangeOverlay;
  issues: OverlayBuildIssue[];
}

// ---------------------------------------------------------------------------
// Governance/decision advisory wrappers -- never modify the canonical M7/M8
// contracts (GovernanceEvaluation / DecisionImplementationState etc.).
// Every wrapper is explicitly and visibly marked as evaluating a PROPOSED,
// not-yet-applied basis.
// ---------------------------------------------------------------------------

export interface AdvisoryGovernanceFinding {
  rule_id: string;
  policy_id: string;
  result: string;
  severity: string;
  /** Always phrased against the proposed basis (e.g. "would violate", never "violates") -- see governance-advisory.ts's wording regression tests. */
  statement: string;
  affected_refs: string[];
}

export interface AdvisoryGovernanceResult {
  status: "evaluated" | "not_evaluated" | "unresolved";
  detail: string;
  findings: AdvisoryGovernanceFinding[];
}

export type DecisionCapabilitySupport = "supported" | "partially_supported" | "unsupported";

export interface DecisionCapabilityEntry {
  function_name: string;
  support: DecisionCapabilitySupport;
  detail: string;
}

export interface AdvisoryDecisionFinding {
  decision_node_id: string;
  state: string;
  /** Always phrased against the proposed basis. */
  statement: string;
}

export interface AdvisoryDecisionResult {
  status: "evaluated" | "not_evaluated" | "unresolved";
  detail: string;
  findings: AdvisoryDecisionFinding[];
  capability_registry: DecisionCapabilityEntry[];
}

// ---------------------------------------------------------------------------
// ChangeAdvisory -- the deterministic derived assessment. Identity depends
// on both the proposal's own identity and the baseline snapshot digest it
// was evaluated against, so the same proposal against two different
// baselines never collides.
// ---------------------------------------------------------------------------

export type DomainCoverageStatus = "evaluated" | "partial" | "unresolved" | "not_applicable";

export interface DomainCoverageState {
  domain: "impact" | "governance" | "decisions" | "topology";
  status: DomainCoverageStatus;
  detail: string;
}

export interface ChangeAdvisory {
  schema_version: number;
  id: string;
  proposal_id: string;
  repository_id: string;
  base_snapshot_digest: string;
  proposal_validation: ProposalValidationResult;
  topology: TopologyDisclosure[];
  impact: {
    status: "evaluated" | "not_evaluated" | "unresolved";
    detail: string;
    directly_affected_refs: string[];
    transitively_affected_refs: string[];
    blast_radius_level: string;
    unresolved_downstream_impact: boolean;
    truncated: boolean;
  };
  governance: AdvisoryGovernanceResult;
  decisions: AdvisoryDecisionResult;
  domain_coverage: DomainCoverageState[];
  evidence_refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Persistence / staleness (see persistence.ts)
// ---------------------------------------------------------------------------

/** A ChangeAdvisory is cacheable but never authoritative -- STALE_EQUIVALENT is the only degradation state; nothing here auto-recomputes or mutates a previously written advisory. */
export type ChangeAdvisoryFreshness = "current" | "stale_equivalent";

export interface StoredChangeAdvisory {
  advisory: ChangeAdvisory;
  base_snapshot_digest_at_store_time: string;
}
