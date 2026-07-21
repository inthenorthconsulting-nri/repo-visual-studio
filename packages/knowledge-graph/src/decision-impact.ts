// Which decisions/assumptions become invalid if an entity changes or is
// removed. Looks up each decision's already-computed state from
// decision-intelligence's own cached decisions.json/assumptions.json
// (consumed as JSON, never re-derived) and classifies via a fixed decision
// table. RVS never reverses, approves, or rejects the decision itself --
// this module only reports connectivity + existing classification.

import type { DecisionImpactEntry, DecisionImpactState, KnowledgeEdge, KnowledgeEdgeType, KnowledgeNode } from "./contracts.js";
import { buildDecisionImpactId, buildNodeId } from "./ids.js";
import { traverse } from "./traversal.js";
import { DEFAULT_MAX_TRAVERSAL_DEPTH, DEFAULT_RESULT_LIMIT } from "./constants.js";

export interface RawDecisionStateArtifact {
  decisions?: Array<{ id: string; decision_status?: string; implementation_status?: string }>;
}

export interface RawDecisionAssumptionStateArtifact {
  assumptions?: Array<{ id: string; decision_id: string; state?: string }>;
}

export interface DecisionStateLookup {
  decisionByDecisionId: Map<string, { decision_status?: string; implementation_status?: string }>;
  assumptionsByDecisionId: Map<string, Array<{ id: string; state?: string }>>;
}

export function buildDecisionStateLookup(
  decisions: RawDecisionStateArtifact | undefined,
  assumptions: RawDecisionAssumptionStateArtifact | undefined,
): DecisionStateLookup {
  const decisionByDecisionId = new Map<string, { decision_status?: string; implementation_status?: string }>();
  for (const decision of decisions?.decisions ?? []) {
    decisionByDecisionId.set(decision.id, {
      decision_status: decision.decision_status,
      implementation_status: decision.implementation_status,
    });
  }
  const assumptionsByDecisionId = new Map<string, Array<{ id: string; state?: string }>>();
  for (const assumption of assumptions?.assumptions ?? []) {
    const bucket = assumptionsByDecisionId.get(assumption.decision_id) ?? [];
    bucket.push({ id: assumption.id, state: assumption.state });
    assumptionsByDecisionId.set(assumption.decision_id, bucket);
  }
  return { decisionByDecisionId, assumptionsByDecisionId };
}

/**
 * Fixed decision table, keyed on (decision_status, implementation_status,
 * assumption states). Never returns "unaffected" -- this classifier is only
 * invoked for decisions already confirmed reachable from the target entity
 * by traversal; "unaffected" is the caller's own label for decisions it
 * knows about but that traversal never reached at all.
 */
export function classifyReachedDecisionImpact(params: {
  decisionSourceEntityId: string;
  lookup: DecisionStateLookup;
  reachedViaEdgeTypes: KnowledgeEdgeType[];
}): DecisionImpactState {
  const decisionState = params.lookup.decisionByDecisionId.get(params.decisionSourceEntityId);
  const assumptionStates = (params.lookup.assumptionsByDecisionId.get(params.decisionSourceEntityId) ?? []).map(
    (assumption) => assumption.state,
  );

  if (!decisionState && assumptionStates.length === 0) return "unverifiable";
  if (decisionState?.decision_status === "superseded") return "superseded";
  if (assumptionStates.includes("contradicted")) return "assumption_contradicted";
  if (assumptionStates.includes("weakened")) return "assumption_weakened";
  if (decisionState?.implementation_status === "invalidated" || decisionState?.implementation_status === "broken") {
    return "implementation_invalidated";
  }
  if (assumptionStates.some((state) => state === "unverifiable")) return "unverifiable";
  return "review_required";
}

function describeDecisionImpact(state: DecisionImpactState, edgeTypesReached: KnowledgeEdgeType[]): string {
  const viaText = edgeTypesReached.length > 0 ? ` via ${edgeTypesReached.join(", ")}` : "";
  switch (state) {
    case "assumption_contradicted":
      return `Reachable from the target entity${viaText}; at least one of this decision's assumptions is already recorded as contradicted.`;
    case "assumption_weakened":
      return `Reachable from the target entity${viaText}; at least one of this decision's assumptions is already recorded as weakened.`;
    case "implementation_invalidated":
      return `Reachable from the target entity${viaText}; this decision's recorded implementation status indicates it is no longer valid.`;
    case "superseded":
      return `Reachable from the target entity${viaText}; this decision is already recorded as superseded.`;
    case "review_required":
      return `Reachable from the target entity${viaText}; no existing contradiction/invalidation signal was recorded, so human review is required.`;
    case "unverifiable":
      return `Reachable from the target entity${viaText}; this decision's state could not be determined from cached decision-intelligence output.`;
    case "unaffected":
      return "Not reachable from the target entity.";
  }
}

/** Every decision_assumption node id (present in the graph) whose upstream state is "weakened" or "contradicted", for a given decision's own raw id. */
export function assumptionNodeIdsPotentiallyInvalidated(
  decisionSourceEntityId: string,
  lookup: DecisionStateLookup,
  nodeIds: Set<string>,
): string[] {
  const assumptions = lookup.assumptionsByDecisionId.get(decisionSourceEntityId) ?? [];
  return assumptions
    .filter((assumption) => assumption.state === "weakened" || assumption.state === "contradicted")
    .map((assumption) => buildNodeId(assumption.id))
    .filter((nodeId) => nodeIds.has(nodeId))
    .sort();
}

export function computeDecisionImpact(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  targetEntityNodeId: string,
  lookup: DecisionStateLookup,
): DecisionImpactEntry[] {
  const result = traverse(nodes, edges, targetEntityNodeId, {
    maxDepth: DEFAULT_MAX_TRAVERSAL_DEPTH,
    direction: "both",
    repositoryBoundary: "single",
    resultLimit: DEFAULT_RESULT_LIMIT,
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  const entries: DecisionImpactEntry[] = [];
  for (const traversedNode of result.nodes) {
    const node = nodeById.get(traversedNode.node_id);
    if (!node || node.node_type !== "decision") continue;
    const edgeTypesReached: KnowledgeEdgeType[] = [];
    if (traversedNode.via_edge_id) {
      const edge = edgeById.get(traversedNode.via_edge_id);
      if (edge) edgeTypesReached.push(edge.edge_type);
    }
    const state = classifyReachedDecisionImpact({
      decisionSourceEntityId: node.source_entity_id,
      lookup,
      reachedViaEdgeTypes: edgeTypesReached,
    });
    entries.push({
      id: buildDecisionImpactId(node.id, targetEntityNodeId),
      schema_version: 1,
      decision_node_id: node.id,
      target_entity_node_id: targetEntityNodeId,
      state,
      detail: describeDecisionImpact(state, edgeTypesReached),
      evidence_refs: node.evidence_refs,
    });
  }

  return entries.sort((a, b) => (a.decision_node_id < b.decision_node_id ? -1 : 1));
}
