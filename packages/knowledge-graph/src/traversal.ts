// Single shared bounded-BFS traversal engine (O(V+E)) used by
// impact-analysis.ts, blast-radius.ts, root-cause.ts, decision-impact.ts,
// and change-planning.ts. Never all-simple-paths -- that combinatorial mode
// is reserved for path-finding.ts's explicit bounded `--all`.

import type { KnowledgeEdge, KnowledgeNode, TraversalDirection, TraversalOptions, TraversalResult, TraversedNode } from "./contracts.js";

interface EdgeIndex {
  outgoing: Map<string, KnowledgeEdge[]>;
  incoming: Map<string, KnowledgeEdge[]>;
}

export function buildEdgeIndex(edges: KnowledgeEdge[]): EdgeIndex {
  const outgoing = new Map<string, KnowledgeEdge[]>();
  const incoming = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges) {
    const out = outgoing.get(edge.from_node_id) ?? [];
    out.push(edge);
    outgoing.set(edge.from_node_id, out);
    const inc = incoming.get(edge.to_node_id) ?? [];
    inc.push(edge);
    incoming.set(edge.to_node_id, inc);
  }
  for (const bucket of outgoing.values()) bucket.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const bucket of incoming.values()) bucket.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { outgoing, incoming };
}

export function collectCandidateEdges(nodeId: string, direction: TraversalDirection, index: EdgeIndex): KnowledgeEdge[] {
  if (direction === "downstream") return index.outgoing.get(nodeId) ?? [];
  if (direction === "upstream") return index.incoming.get(nodeId) ?? [];
  return [...(index.outgoing.get(nodeId) ?? []), ...(index.incoming.get(nodeId) ?? [])];
}

/**
 * Bounded BFS from rootNodeId. A visited-set gives O(1) cycle protection.
 * Hitting `resultLimit` or `maxDepth` while a frontier remains sets
 * `truncated: true` rather than silently returning a partial list as if it
 * were complete.
 */
export function traverse(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  rootNodeId: string,
  options: TraversalOptions,
): TraversalResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootNode = nodeById.get(rootNodeId);
  if (!rootNode) {
    return { root_node_id: rootNodeId, nodes: [], edges_traversed: [], truncated: false };
  }

  const index = buildEdgeIndex(edges);
  const visited = new Map<string, TraversedNode>();
  const edgesTraversedSet = new Set<string>();
  let truncated = false;

  visited.set(rootNodeId, { node_id: rootNodeId, depth: 0 });
  let frontier: string[] = [rootNodeId];
  let depth = 0;

  while (frontier.length > 0 && depth < options.maxDepth) {
    depth += 1;
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      const candidateEdges = collectCandidateEdges(currentId, options.direction, index);
      for (const edge of candidateEdges) {
        if (options.allowedEdgeTypes && !options.allowedEdgeTypes.includes(edge.edge_type)) continue;
        const neighborId = edge.from_node_id === currentId ? edge.to_node_id : edge.from_node_id;
        if (visited.has(neighborId)) continue;
        const neighborNode = nodeById.get(neighborId);
        if (!neighborNode) continue;
        if (options.allowedNodeTypes && !options.allowedNodeTypes.includes(neighborNode.node_type)) continue;
        if (options.repositoryBoundary === "single" && neighborNode.repository_id !== rootNode.repository_id) continue;
        if (visited.size >= options.resultLimit) {
          truncated = true;
          continue;
        }
        visited.set(neighborId, { node_id: neighborId, depth, via_edge_id: edge.id });
        edgesTraversedSet.add(edge.id);
        nextFrontier.push(neighborId);
      }
    }
    frontier = nextFrontier;
  }
  if (frontier.length > 0 && depth >= options.maxDepth) {
    // A non-empty next frontier at the depth boundary does not by itself mean anything was cut
    // off -- the frontier's own nodes may simply have no further unvisited/unfiltered neighbors
    // (e.g. the chain legitimately ends there). Only report truncated when at least one frontier
    // node actually has a reachable, not-yet-visited neighbor that maxDepth prevented us from
    // recording, using the same edge/node/repository filters the main loop applies.
    truncated = frontier.some((currentId) => {
      const candidateEdges = collectCandidateEdges(currentId, options.direction, index);
      return candidateEdges.some((edge) => {
        if (options.allowedEdgeTypes && !options.allowedEdgeTypes.includes(edge.edge_type)) return false;
        const neighborId = edge.from_node_id === currentId ? edge.to_node_id : edge.from_node_id;
        if (visited.has(neighborId)) return false;
        const neighborNode = nodeById.get(neighborId);
        if (!neighborNode) return false;
        if (options.allowedNodeTypes && !options.allowedNodeTypes.includes(neighborNode.node_type)) return false;
        if (options.repositoryBoundary === "single" && neighborNode.repository_id !== rootNode.repository_id) return false;
        return true;
      });
    });
  }

  return {
    root_node_id: rootNodeId,
    nodes: Array.from(visited.values()).sort((a, b) => (a.node_id < b.node_id ? -1 : 1)),
    edges_traversed: Array.from(edgesTraversedSet).sort(),
    truncated,
  };
}
