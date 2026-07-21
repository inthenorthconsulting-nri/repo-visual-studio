// rvs graph path <from> <to>. Default is unweighted BFS shortest path
// (edges carry no weight -- this is a reachability graph, not a cost
// graph). `findAllPaths` enumerates bounded simple paths, capped rather
// than exhaustive, per the plan's disclosed scope trim.

import type { KnowledgeEdge, KnowledgeNode, KnowledgePath, KnowledgeEdgeType, TraversalDirection } from "./contracts.js";
import { buildPathId } from "./ids.js";
import { buildEdgeIndex, collectCandidateEdges } from "./traversal.js";
import { DEFAULT_MAX_ALL_PATHS_DEPTH, DEFAULT_RESULT_LIMIT } from "./constants.js";

export interface PathQueryOptions {
  maxDepth: number;
  allowedEdgeTypes?: KnowledgeEdgeType[];
  allowedNodeTypes?: KnowledgeNode["node_type"][];
  direction: TraversalDirection;
}

function lexCompare(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

function buildKnowledgePath(fromNodeId: string, toNodeId: string, nodeIds: string[], edgeIds: string[]): KnowledgePath {
  return {
    id: buildPathId(fromNodeId, toNodeId, nodeIds),
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    node_ids: nodeIds,
    edge_ids: edgeIds,
    length: edgeIds.length,
  };
}

/**
 * Layered BFS that, among all shortest paths, deterministically selects the
 * one whose ordered edge-id sequence sorts lexicographically smallest --
 * independent of input/traversal order. Every same-depth candidate reaching
 * a given neighbor is compared before any is committed, so the result does
 * not depend on frontier iteration order.
 */
export function findShortestPath(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  fromNodeId: string,
  toNodeId: string,
  options: PathQueryOptions,
): KnowledgePath | undefined {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return undefined;
  if (fromNodeId === toNodeId) return buildKnowledgePath(fromNodeId, toNodeId, [fromNodeId], []);

  const index = buildEdgeIndex(edges);
  const bestEdgePath = new Map<string, string[]>([[fromNodeId, []]]);
  const bestNodePath = new Map<string, string[]>([[fromNodeId, [fromNodeId]]]);

  let frontier = [fromNodeId];
  let depth = 0;

  while (frontier.length > 0 && depth < options.maxDepth) {
    depth += 1;
    const candidates = new Map<string, { edgePath: string[]; nodePath: string[] }>();
    for (const currentId of frontier) {
      const candidateEdges = collectCandidateEdges(currentId, options.direction, index);
      for (const edge of candidateEdges) {
        if (options.allowedEdgeTypes && !options.allowedEdgeTypes.includes(edge.edge_type)) continue;
        const neighborId = edge.from_node_id === currentId ? edge.to_node_id : edge.from_node_id;
        if (bestEdgePath.has(neighborId)) continue;
        const neighborNode = nodeById.get(neighborId);
        if (!neighborNode) continue;
        if (options.allowedNodeTypes && !options.allowedNodeTypes.includes(neighborNode.node_type)) continue;
        const candidateEdgePath = [...bestEdgePath.get(currentId)!, edge.id];
        const candidateNodePath = [...bestNodePath.get(currentId)!, neighborId];
        const existing = candidates.get(neighborId);
        if (!existing || lexCompare(candidateEdgePath, existing.edgePath) < 0) {
          candidates.set(neighborId, { edgePath: candidateEdgePath, nodePath: candidateNodePath });
        }
      }
    }
    if (candidates.size === 0) break;
    for (const [neighborId, candidate] of candidates) {
      bestEdgePath.set(neighborId, candidate.edgePath);
      bestNodePath.set(neighborId, candidate.nodePath);
    }
    if (bestEdgePath.has(toNodeId)) break;
    frontier = Array.from(candidates.keys());
  }

  if (!bestEdgePath.has(toNodeId)) return undefined;
  return buildKnowledgePath(fromNodeId, toNodeId, bestNodePath.get(toNodeId)!, bestEdgePath.get(toNodeId)!);
}

export interface AllPathsResult {
  paths: KnowledgePath[];
  truncated: boolean;
}

/**
 * Bounded simple-path enumeration (no repeated nodes within a path), capped
 * at `DEFAULT_MAX_ALL_PATHS_DEPTH` and `DEFAULT_RESULT_LIMIT` total paths --
 * a documented, disclosed limit, never silently exhaustive on
 * highly-connected graphs.
 */
export function findAllPaths(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  fromNodeId: string,
  toNodeId: string,
  options: Partial<PathQueryOptions> = {},
): AllPathsResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return { paths: [], truncated: false };

  const maxDepth = options.maxDepth ?? DEFAULT_MAX_ALL_PATHS_DEPTH;
  const direction = options.direction ?? "downstream";
  const index = buildEdgeIndex(edges);

  const paths: KnowledgePath[] = [];
  let truncated = false;
  const onPath = new Set<string>([fromNodeId]);
  const nodeStack = [fromNodeId];
  const edgeStack: string[] = [];

  function visit(currentId: string): void {
    if (truncated) return;
    if (currentId === toNodeId && edgeStack.length > 0) {
      paths.push(buildKnowledgePath(fromNodeId, toNodeId, [...nodeStack], [...edgeStack]));
      if (paths.length >= DEFAULT_RESULT_LIMIT) {
        truncated = true;
      }
      return;
    }
    if (nodeStack.length - 1 >= maxDepth) {
      if (currentId !== toNodeId) truncated = true;
      return;
    }
    const candidateEdges = collectCandidateEdges(currentId, direction, index);
    for (const edge of candidateEdges) {
      if (truncated) return;
      if (options.allowedEdgeTypes && !options.allowedEdgeTypes.includes(edge.edge_type)) continue;
      const neighborId = edge.from_node_id === currentId ? edge.to_node_id : edge.from_node_id;
      if (onPath.has(neighborId)) continue;
      const neighborNode = nodeById.get(neighborId);
      if (!neighborNode) continue;
      if (options.allowedNodeTypes && !options.allowedNodeTypes.includes(neighborNode.node_type)) continue;
      onPath.add(neighborId);
      nodeStack.push(neighborId);
      edgeStack.push(edge.id);
      visit(neighborId);
      edgeStack.pop();
      nodeStack.pop();
      onPath.delete(neighborId);
    }
  }

  visit(fromNodeId);

  paths.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return lexCompare(a.edge_ids, b.edge_ids);
  });

  return { paths, truncated };
}
