// Generic graph engine, reimplemented locally rather than imported from
// @rvs/decision-intelligence/src/decision-graph.ts -- same pattern (bounded
// simple-path cycle detection via a stack + onStack set, rotation-invariant
// cycle dedup), zero cross-package import, per the repo's structural
// decoupling convention.

export interface GenericEdge<T extends string> {
  from: string;
  to: string;
  kind: T;
}

export interface GenericGraph<T extends string> {
  nodeIds: string[];
  edges: GenericEdge<T>[];
  adjacency: Map<string, GenericEdge<T>[]>;
}

/** Builds a sorted-node-id adjacency map; edges per node sorted by (to, kind) so downstream consumers get deterministic iteration order regardless of input order. */
export function buildGenericGraph<T extends string>(
  nodeIds: Iterable<string>,
  edges: GenericEdge<T>[],
): GenericGraph<T> {
  const sortedNodeIds = Array.from(new Set(nodeIds)).sort();
  const adjacency = new Map<string, GenericEdge<T>[]>();
  for (const nodeId of sortedNodeIds) {
    adjacency.set(nodeId, []);
  }
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  for (const edge of sortedEdges) {
    const bucket = adjacency.get(edge.from);
    if (bucket) {
      bucket.push(edge);
    }
  }
  return { nodeIds: sortedNodeIds, edges: sortedEdges, adjacency };
}

export function normalizeCycleKey(cycle: string[]): string {
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIndex]) {
      minIndex = i;
    }
  }
  const rotated = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
  return rotated.join(">");
}

/**
 * Bounded simple-path DFS cycle detection. A revisit of a node currently on
 * the stack closes a cycle only when that node is the path's own start node
 * -- any other stack revisit is pruned rather than followed, which keeps
 * this bounded rather than exponential on densely connected graphs.
 */
export function findCycles<T extends string>(graph: GenericGraph<T>): string[][] {
  const cycles = new Map<string, string[]>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  function visit(startNode: string, current: string): void {
    const neighbors = graph.adjacency.get(current) ?? [];
    for (const edge of neighbors) {
      if (edge.to === startNode && stack.length > 0) {
        const cycle = [...stack];
        const key = normalizeCycleKey(cycle);
        if (!cycles.has(key)) {
          cycles.set(key, cycle);
        }
        continue;
      }
      if (onStack.has(edge.to)) {
        continue;
      }
      stack.push(edge.to);
      onStack.add(edge.to);
      visit(startNode, edge.to);
      onStack.delete(edge.to);
      stack.pop();
    }
  }

  for (const nodeId of graph.nodeIds) {
    stack.push(nodeId);
    onStack.add(nodeId);
    visit(nodeId, nodeId);
    onStack.delete(nodeId);
    stack.pop();
  }

  return Array.from(cycles.keys())
    .sort()
    .map((key) => cycles.get(key)!);
}

export function findOrphanNodes<T extends string>(graph: GenericGraph<T>): string[] {
  const reachableAsTarget = new Set<string>();
  for (const edge of graph.edges) {
    reachableAsTarget.add(edge.to);
  }
  return graph.nodeIds.filter(
    (nodeId) => (graph.adjacency.get(nodeId)?.length ?? 0) === 0 && !reachableAsTarget.has(nodeId),
  );
}
