// Graph-scoped blast-radius level derivation, reusing traversal.ts's
// result rather than re-traversing. Mirrors the conservative-bias
// "structural-availability gate checked before any neighbor lookup"
// convention from decision-intelligence's/governance-intelligence's own
// blast-radius modules: `unresolved` fires only when the target node has
// no resolvable edges at all (no way to even ask), never merely because a
// particular neighbor type came back empty.

import type { BlastRadiusLevel, KnowledgeNode, TraversalResult } from "./contracts.js";

export function deriveBlastRadiusLevel(
  nodes: KnowledgeNode[],
  targetNodeId: string,
  traversalResult: TraversalResult,
): BlastRadiusLevel {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targetNode = nodeById.get(targetNodeId);
  if (!targetNode) return "unresolved";

  // Gate: no way to even ask -- the target node itself has zero resolvable edges.
  if (traversalResult.edges_traversed.length === 0) return "unresolved";

  const reachedNodes = traversalResult.nodes
    .filter((traversed) => traversed.node_id !== targetNodeId)
    .map((traversed) => nodeById.get(traversed.node_id))
    .filter((node): node is KnowledgeNode => node !== undefined);

  const confirmedNodes = reachedNodes.filter((node) => node.node_type !== "unresolved_reference");
  if (confirmedNodes.length === 0) return "isolated";

  const reachesPortfolioOrProduct = confirmedNodes.some(
    (node) => node.node_type === "product" || node.node_type === "portfolio_relationship",
  );
  if (reachesPortfolioOrProduct) return "portfolio_wide";

  const distinctSourceArtifacts = new Set(confirmedNodes.map((node) => node.source_artifact));
  if (distinctSourceArtifacts.size > 1 || !distinctSourceArtifacts.has(targetNode.source_artifact)) {
    return "cross_layer";
  }

  const distinctNodeTypes = new Set(confirmedNodes.map((node) => node.node_type));
  if (distinctNodeTypes.size > 1 || !distinctNodeTypes.has(targetNode.node_type)) {
    return "cross_component";
  }

  return "local";
}
