// Public types for @rvs/knowledge-graph. Every upstream artifact is
// consumed structurally (as `unknown`, narrowed by node-builder.ts /
// edge-builder.ts) -- this package never imports @rvs/architecture-intelligence,
// @rvs/capability-intelligence, @rvs/product-intelligence,
// @rvs/portfolio-intelligence, @rvs/governance-intelligence, or
// @rvs/decision-intelligence types, matching the zero-cross-import
// convention every sibling intelligence package already follows.

export const KNOWLEDGE_GRAPH_SCHEMA_VERSION = 1;

export type UpstreamSourceArtifact =
  | "architecture"
  | "capability"
  | "product"
  | "portfolio"
  | "governance"
  | "decision";

/** Own EvidenceRef echo -- a structural superset covering every upstream package's own EvidenceRef/EvidenceReference shape. `lines` is a string (e.g. "12-34"), matching every upstream artifact's own EvidenceReference/EvidenceRef.lines representation verbatim -- never renumbered into a tuple. `path`/`source_artifact` are both optional here because product-intelligence/portfolio-intelligence evidence carries no file path at all (sourceType/sourceId/text-based instead). */
export interface EvidenceRef {
  path?: string;
  lines?: string;
  source_artifact?: UpstreamSourceArtifact | "repository";
  detail?: string;
}

export type KnowledgeNodeType =
  | "repository"
  | "component"
  | "package"
  | "workflow"
  | "runtime_entrypoint"
  | "command"
  | "capability"
  | "capability_domain"
  | "product"
  | "portfolio_relationship"
  | "policy"
  | "governance_finding"
  | "decision"
  | "decision_assumption"
  | "decision_consequence"
  | "baseline"
  | "evidence"
  | "presentation"
  | "unresolved_reference";

export type KnowledgeEdgeType =
  | "contains"
  | "depends_on"
  | "invokes"
  | "implements"
  | "exposes"
  | "supports"
  | "governs"
  | "violates"
  | "explains"
  | "justifies"
  | "requires"
  | "constrains"
  | "supersedes"
  | "invalidates"
  | "affects"
  | "produces"
  | "consumes"
  | "references"
  | "evidenced_by"
  | "presented_in"
  | "inherits_risk_from";

export type ResolutionStatus = "resolved" | "unresolved" | "partial";

export type EdgeResolutionStatus =
  | "resolved"
  | "unresolved"
  | "partial"
  | "ambiguous"
  | "incompatible";

export type ConfidenceLevel = "confirmed" | "qualified" | "unverifiable";

export interface KnowledgeNode {
  id: string;
  node_type: KnowledgeNodeType;
  source_artifact: UpstreamSourceArtifact;
  source_entity_id: string;
  label: string;
  evidence_refs: EvidenceRef[];
  resolution_status: ResolutionStatus;
  schema_version: number;
  repository_id: string;
  confidence: ConfidenceLevel;
}

export interface KnowledgeEdge {
  id: string;
  edge_type: KnowledgeEdgeType;
  from_node_id: string;
  to_node_id: string;
  direction: "directed";
  evidence_refs: EvidenceRef[];
  resolution_status: EdgeResolutionStatus;
  detail: string;
}

export type TraversalDirection = "upstream" | "downstream" | "both";
export type RepositoryBoundary = "single";

export interface TraversalOptions {
  maxDepth: number;
  allowedEdgeTypes?: KnowledgeEdgeType[];
  allowedNodeTypes?: KnowledgeNodeType[];
  direction: TraversalDirection;
  repositoryBoundary: RepositoryBoundary;
  resultLimit: number;
}

export interface TraversedNode {
  node_id: string;
  depth: number;
  via_edge_id?: string;
}

export interface TraversalResult {
  root_node_id: string;
  nodes: TraversedNode[];
  edges_traversed: string[];
  truncated: boolean;
}

export interface KnowledgePath {
  id: string;
  from_node_id: string;
  to_node_id: string;
  node_ids: string[];
  edge_ids: string[];
  length: number;
}

export interface ImpactQuery {
  entity_node_id: string;
  max_depth: number;
  allowed_edge_types?: KnowledgeEdgeType[];
  direction: TraversalDirection;
}

export type BlastRadiusLevel =
  | "isolated"
  | "local"
  | "cross_component"
  | "cross_layer"
  | "portfolio_wide"
  | "unresolved";

export interface ImpactFinding {
  node_id: string;
  node_type: KnowledgeNodeType;
  depth: number;
  path_id?: string;
}

export interface ImpactResult {
  id: string;
  schema_version: number;
  query: ImpactQuery;
  directly_affected: ImpactFinding[];
  transitively_affected: ImpactFinding[];
  blast_radius_level: BlastRadiusLevel;
  edge_types_traversed: KnowledgeEdgeType[];
  products_affected: string[];
  capabilities_affected: string[];
  decisions_affected: string[];
  governance_findings_affected: string[];
  assumptions_potentially_invalidated: string[];
  unresolved_downstream_impact: boolean;
  truncated: boolean;
  evidence_refs: EvidenceRef[];
}

export type RootCauseClassification =
  | "confirmed"
  | "probable"
  | "shared_dependency_only"
  | "unresolved";

export interface RootCauseGroup {
  id: string;
  schema_version: number;
  finding_node_ids: string[];
  candidate_root_node_ids: string[];
  classification: RootCauseClassification;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export type DecisionImpactState =
  | "unaffected"
  | "review_required"
  | "assumption_weakened"
  | "assumption_contradicted"
  | "implementation_invalidated"
  | "superseded"
  | "unverifiable";

export interface DecisionImpactEntry {
  id: string;
  schema_version: number;
  decision_node_id: string;
  target_entity_node_id: string;
  state: DecisionImpactState;
  detail: string;
  evidence_refs: EvidenceRef[];
}

export interface ChangePlanEntry {
  id: string;
  schema_version: number;
  removed_entity_node_id: string;
  affected_node_ids: string[];
  decisions_requiring_review: string[];
  governance_requiring_review: string[];
  tests_likely_affected: EvidenceRef[];
  docs_likely_affected: EvidenceRef[];
  presentation_likely_affected: EvidenceRef[];
  suggested_validation_commands: string[];
  baselines_requiring_review: string[];
  unknown_consumers: string[];
  evidence_refs: EvidenceRef[];
}

export type ArtifactProvenance = "complete" | "partial" | "unavailable";

export interface UpstreamArtifactDigest {
  source_artifact: UpstreamSourceArtifact;
  snapshot_id?: string;
  schema_version?: number;
  provenance: ArtifactProvenance;
}

export interface GraphSnapshot {
  id: string;
  schema_version: number;
  repository_id: string;
  upstream_artifacts: UpstreamArtifactDigest[];
  node_count: number;
  edge_count: number;
  digest: string;
}

export type CompatibilityStatus =
  | "compatible"
  | "compatible_with_warnings"
  | "partial"
  | "incompatible";

export interface CompatibilityAssessment {
  status: CompatibilityStatus;
  reasons: string[];
}

export interface GraphChangeSet {
  id: string;
  schema_version: number;
  source_snapshot_id: string;
  target_snapshot_id: string;
  nodes_added: string[];
  nodes_removed: string[];
  edges_added: string[];
  edges_removed: string[];
  entity_types_changed: string[];
  relationships_changed: string[];
  dependency_paths_changed: string[];
  impact_radius_increased: string[];
  impact_radius_decreased: string[];
  new_orphans: string[];
  new_cycles: string[];
  root_causes_introduced: string[];
  root_causes_resolved: string[];
  decision_dependencies_changed: string[];
  governance_reach_changed: string[];
}

export interface ValidationFinding {
  id: string;
  code: string;
  message: string;
  subject_id: string;
  blocking: boolean;
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface KnowledgeGraphNarrativeSection {
  heading: string;
  body: string;
}

export interface KnowledgeGraphNarrative {
  id: string;
  generated_at: string;
  source_snapshot_id: string;
  target_snapshot_id?: string;
  sections: KnowledgeGraphNarrativeSection[];
}

// ---------------------------------------------------------------------------
// Presentation plan
// ---------------------------------------------------------------------------

export type KnowledgeGraphSceneKind =
  | "graph-overview"
  | "graph-layers-connected"
  | "graph-entity-landscape"
  | "graph-relationship-landscape"
  | "graph-dependency-paths"
  | "graph-component-impact"
  | "graph-capability-impact"
  | "graph-product-portfolio-reach"
  | "graph-root-causes"
  | "graph-decision-dependencies"
  | "graph-invalidated-assumptions"
  | "graph-orphans-unresolved"
  | "graph-changes"
  | "graph-review-required"
  | "graph-validation";

export interface KnowledgeGraphSceneContent {
  scene_id: string;
  kind: KnowledgeGraphSceneKind;
  title: string;
  body: unknown;
  evidence_refs: EvidenceRef[];
}

export interface KnowledgeGraphPlan {
  id: string;
  generated_at: string;
  source_snapshot_id: string;
  scenes: KnowledgeGraphSceneContent[];
}
