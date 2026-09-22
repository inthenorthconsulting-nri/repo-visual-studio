// Shared test fixtures. `truth_disclosure`/`baseline_binding`/`advisory`
// are pass-through-only fields as far as this package is concerned (see
// this package's own contracts.ts header comment) -- their internal shape
// is @rvs/proposal-architecture-review's/@rvs/visual-intelligence's
// authority, not this package's, so fixtures here use minimally-shaped
// stand-ins rather than reconstructing every upstream sub-type in full.

import type { ProposalArchitectureReviewModel } from "@rvs/proposal-architecture-review";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { AddEntityOperation, AddRelationOperation, ModifyAttributesOperation, ModifyRelationOperation, ProposalOperation, RemoveEntityOperation, RemoveRelationOperation } from "@rvs/change-workbench";

export function kNode(overrides: Partial<KnowledgeNode> & { id: string }): KnowledgeNode {
  return {
    node_type: "component",
    source_artifact: "architecture",
    source_entity_id: overrides.id,
    label: overrides.id,
    evidence_refs: [],
    resolution_status: "resolved",
    schema_version: 1,
    repository_id: "repo-1",
    confidence: "confirmed",
    ...overrides,
  };
}

export function kEdge(overrides: Partial<KnowledgeEdge> & { id: string; from_node_id: string; to_node_id: string }): KnowledgeEdge {
  return {
    edge_type: "depends_on",
    direction: "directed",
    evidence_refs: [],
    resolution_status: "resolved",
    detail: "",
    ...overrides,
  };
}

export const BASELINE_NODE_A = kNode({ id: "node-a", label: "Service A" });
export const BASELINE_NODE_B = kNode({ id: "node-b", label: "Service B" });
export const BASELINE_NODE_C = kNode({ id: "node-c", label: "Service C" });
export const BASELINE_EDGE_AB = kEdge({ id: "edge-ab", from_node_id: "node-a", to_node_id: "node-b", edge_type: "depends_on", detail: "calls over HTTP" });

export const OBSERVED_BASELINE = {
  nodes: [BASELINE_NODE_A, BASELINE_NODE_B, BASELINE_NODE_C],
  edges: [BASELINE_EDGE_AB],
};

export const ALL_SIX_OPERATIONS: ProposalOperation[] = [
  { kind: "add_entity", ref: "proposed-x", node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "x", label: "Service X", repository_id: "repo-1" } as AddEntityOperation,
  { kind: "remove_entity", ref: "node-c", detail: "no longer needed" } as unknown as RemoveEntityOperation,
  { kind: "modify_attributes", ref: "node-a", attributes: { label: "Service A2", not_a_real_field: 1 } } as unknown as ModifyAttributesOperation,
  { kind: "add_relation", from_ref: "node-a", to_ref: "proposed-x", edge_type: "depends_on", detail: "new call" } as unknown as AddRelationOperation,
  { kind: "remove_relation", from_ref: "node-a", to_ref: "node-b", edge_type: "depends_on", detail: "decoupling" } as unknown as RemoveRelationOperation,
  { kind: "modify_relation", from_ref: "node-a", to_ref: "node-b", edge_type: "depends_on", attributes: { detail: "now async", identity: "nope" } } as unknown as ModifyRelationOperation,
];

function minimalTruthDisclosure() {
  return {
    schema_version: 1,
    id: "truth-1",
    artifact_kind: "proposal_projection",
    repository_id: "repo-1",
    base_snapshot_digest: "digest-1",
    proposal_id: "proposal-1",
    advisory_id: "advisory-1",
    baseline_basis: "observed",
    proposal_basis: "explicit",
    projection_basis: "deterministic_overlay",
    topology_disclosure_status: "explicit",
    advisory_freshness: "current",
    qualification_text: "This is a proposed, not-yet-applied change.",
    qualification_codes: ["proposal_not_applied"],
  } as unknown as ProposalArchitectureReviewModel["truth_disclosure"];
}

function minimalBaselineBinding() {
  return {
    binding_status: "bound",
    attestation_state: "attested",
    observed_baseline_content_digest: "digest-1",
  } as unknown as ProposalArchitectureReviewModel["baseline_binding"];
}

function minimalAdvisory() {
  return {
    schema_version: 1,
    id: "advisory-1",
    proposal_id: "proposal-1",
    repository_id: "repo-1",
    base_snapshot_digest: "digest-1",
    proposal_validation: { status: "valid_sufficient", issues: [] },
    topology: [],
    impact: {
      status: "evaluated",
      detail: "",
      directly_affected_refs: [],
      transitively_affected_refs: [],
      blast_radius_level: "low",
      unresolved_downstream_impact: false,
      truncated: false,
    },
    governance: { status: "evaluated", detail: "", findings: [] },
    decisions: { status: "evaluated", detail: "", findings: [], capability_registry: [] },
    domain_coverage: [],
    evidence_refs: [],
  } as unknown as ProposalArchitectureReviewModel["advisory"];
}

export function buildFixtureModel(overrides: Partial<ProposalArchitectureReviewModel> = {}): ProposalArchitectureReviewModel {
  return {
    schema_version: 1,
    id: "review-1",
    repository_id: "repo-1",
    proposal_id: "proposal-1",
    source_proposal_review_visual_input_id: "input-1",
    observed_baseline: OBSERVED_BASELINE,
    proposed_delta: { operations: ALL_SIX_OPERATIONS },
    projected_state: { status: "not_built", reason: "proposal validation was invalid" },
    truth_disclosure: minimalTruthDisclosure(),
    baseline_binding: minimalBaselineBinding(),
    advisory: minimalAdvisory(),
    ...overrides,
  };
}
