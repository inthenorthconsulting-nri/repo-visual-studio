// Shared graph structure for dependencies.ts, supersession.ts, conflicts.ts,
// and blast-radius.ts -- built once and cycle-tested once rather than four
// ad-hoc traversals. Every traversal below iterates nodes/edges in a fixed,
// id-sorted order so cycle enumeration is deterministic regardless of the
// order decisions/links were discovered in.

export interface DecisionGraphEdge<T extends string = string> {
  from: string;
  to: string;
  kind: T;
}

export interface DecisionGraph<T extends string = string> {
  nodeIds: string[];
  edges: DecisionGraphEdge<T>[];
  adjacency: Map<string, DecisionGraphEdge<T>[]>;
}

export function buildDecisionGraph<T extends string>(nodeIds: string[], edges: DecisionGraphEdge<T>[]): DecisionGraph<T> {
  const sortedNodeIds = [...new Set(nodeIds)].sort();
  const adjacency = new Map<string, DecisionGraphEdge<T>[]>();
  for (const id of sortedNodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => (a.to === b.to ? a.kind.localeCompare(b.kind) : a.to.localeCompare(b.to)));
  }
  return { nodeIds: sortedNodeIds, edges, adjacency };
}

/**
 * Finds every simple cycle reachable via edges whose kind is in
 * `cycleEdgeKinds`, deduplicated by a rotation-invariant key. Only a
 * revisit of the cycle's own start node closes a cycle; any other revisit
 * is pruned, which keeps this a bounded simple-path search rather than an
 * exponential all-walks enumeration.
 */
export function findCycles<T extends string>(graph: DecisionGraph<T>, cycleEdgeKinds: readonly T[]): string[][] {
  const kindSet = new Set<string>(cycleEdgeKinds);
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();

  for (const startId of graph.nodeIds) {
    const stack: string[] = [startId];
    const onStack = new Set<string>([startId]);
    visit(startId);

    function visit(current: string): void {
      for (const edge of graph.adjacency.get(current) ?? []) {
        if (!kindSet.has(edge.kind)) continue;

        if (edge.to === startId) {
          const key = normalizeCycleKey(stack);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push([...stack]);
          }
          continue;
        }

        if (onStack.has(edge.to)) continue;

        stack.push(edge.to);
        onStack.add(edge.to);
        visit(edge.to);
        stack.pop();
        onStack.delete(edge.to);
      }
    }
  }

  return cycles;
}

function normalizeCycleKey(cycle: string[]): string {
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if (cycle[i] < cycle[minIndex]) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)].join(">");
}
