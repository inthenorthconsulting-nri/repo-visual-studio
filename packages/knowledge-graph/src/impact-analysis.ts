// rvs graph impact <entity-id>. Runs the shared bounded traversal engine
// from the target node, classifies the result set, and delegates decision
// classification to decision-impact.ts rather than re-deriving it.

import type { EvidenceRef, ImpactFinding, ImpactQuery, ImpactResult, KnowledgeEdge, KnowledgeEdgeType, KnowledgeNode } from "./contracts.js";
import { buildImpactResultId, digestOf } from "./ids.js";
import { traverse } from "./traversal.js";
import { findShortestPath } from "./path-finding.js";
import { deriveBlastRadiusLevel } from "./blast-radius.js";
import { assumptionNodeIdsPotentiallyInvalidated, computeDecisionImpact, type DecisionStateLookup } from "./decision-impact.js";
import { DEFAULT_RESULT_LIMIT } from "./constants.js";

function collectEvidenceRefs(edges: KnowledgeEdge[], edgeIds: Set<string>): EvidenceRef[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const seen = new Set<string>();
  const refs: EvidenceRef[] = [];
  for (const edgeId of Array.from(edgeIds).sort()) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    for (const ref of edge.evidence_refs) {
      const key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

export function runImpactAnalysis(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  query: ImpactQuery,
  decisionStateLookup: DecisionStateLookup,
): ImpactResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const queryDigest = digestOf(query);
  const id = buildImpactResultId(query.entity_node_id, queryDigest);

  const result = traverse(nodes, edges, query.entity_node_id, {
    maxDepth: query.max_depth,
    allowedEdgeTypes: query.allowed_edge_types,
    direction: query.direction,
    repositoryBoundary: "single",
    resultLimit: DEFAULT_RESULT_LIMIT,
  });

  const directlyAffected: ImpactFinding[] = [];
  const transitivelyAffected: ImpactFinding[] = [];
  const edgeTypesTraversed = new Set<KnowledgeEdgeType>();
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const productsAffected = new Set<string>();
  const capabilitiesAffected = new Set<string>();
  const governanceFindingsAffected = new Set<string>();
  const directEdgeIds = new Set<string>();
  let reachedUnresolvedReference = false;

  for (const traversedNode of result.nodes) {
    if (traversedNode.node_id === query.entity_node_id) continue;
    const node = nodeById.get(traversedNode.node_id);
    if (!node) continue;

    const path = findShortestPath(nodes, edges, query.entity_node_id, node.id, {
      maxDepth: query.max_depth,
      allowedEdgeTypes: query.allowed_edge_types,
      direction: query.direction,
    });
    const finding: ImpactFinding = { node_id: node.id, node_type: node.node_type, depth: traversedNode.depth, path_id: path?.id };
    if (traversedNode.depth === 1) {
      directlyAffected.push(finding);
      if (traversedNode.via_edge_id) directEdgeIds.add(traversedNode.via_edge_id);
    } else {
      transitivelyAffected.push(finding);
    }

    if (traversedNode.via_edge_id) {
      const edge = edgeById.get(traversedNode.via_edge_id);
      if (edge) edgeTypesTraversed.add(edge.edge_type);
    }

    if (node.node_type === "product") productsAffected.add(node.id);
    if (node.node_type === "capability") capabilitiesAffected.add(node.id);
    if (node.node_type === "governance_finding") governanceFindingsAffected.add(node.id);
    if (node.node_type === "unresolved_reference") reachedUnresolvedReference = true;
  }

  const reachedNodeIds = new Set(result.nodes.map((traversedNode) => traversedNode.node_id));
  const decisionEntries = computeDecisionImpact(nodes, edges, query.entity_node_id, decisionStateLookup).filter((entry) =>
    reachedNodeIds.has(entry.decision_node_id),
  );
  const decisionsAffected = decisionEntries.map((entry) => entry.decision_node_id).sort();

  const allGraphNodeIds = new Set(nodes.map((node) => node.id));
  const assumptionsPotentiallyInvalidated = Array.from(
    new Set(
      decisionEntries.flatMap((entry) => {
        const decisionNode = nodeById.get(entry.decision_node_id);
        if (!decisionNode) return [];
        return assumptionNodeIdsPotentiallyInvalidated(decisionNode.source_entity_id, decisionStateLookup, allGraphNodeIds);
      }),
    ),
  ).sort();

  return {
    id,
    schema_version: 1,
    query,
    directly_affected: directlyAffected.sort((a, b) => (a.node_id < b.node_id ? -1 : 1)),
    transitively_affected: transitivelyAffected.sort((a, b) => (a.node_id < b.node_id ? -1 : 1)),
    blast_radius_level: deriveBlastRadiusLevel(nodes, query.entity_node_id, result),
    edge_types_traversed: Array.from(edgeTypesTraversed).sort(),
    products_affected: Array.from(productsAffected).sort(),
    capabilities_affected: Array.from(capabilitiesAffected).sort(),
    decisions_affected: decisionsAffected,
    governance_findings_affected: Array.from(governanceFindingsAffected).sort(),
    assumptions_potentially_invalidated: assumptionsPotentiallyInvalidated,
    unresolved_downstream_impact: result.truncated || reachedUnresolvedReference,
    truncated: result.truncated,
    evidence_refs: collectEvidenceRefs(edges, directEdgeIds),
  };
}
