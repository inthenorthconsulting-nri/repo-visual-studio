// A deterministic layered-DAG layout engine, wrapped behind the LayoutEngine
// interface so the graph model is never coupled to one specific algorithm or
// library. We hand-roll a Kahn's-algorithm topological layering here rather
// than pulling in ELK.js/Dagre as a new dependency — that trade-off (no
// crossing-minimization heuristics, but zero new deps and fully deterministic
// output) is documented in docs/workflow-engine.md. A future slice can swap
// in a different engine behind this same interface without touching callers.

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutInputEdge {
  id: string;
  from: string;
  to: string;
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface PositionedEdge {
  id: string;
  points: Array<{ x: number; y: number }>;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
}

export interface LayoutOptions {
  direction: "left-to-right" | "top-to-bottom";
  nodeSpacing: number;
  layerSpacing: number;
  margin: number;
}

export interface LayoutEngine {
  layout(nodes: LayoutInputNode[], edges: LayoutInputEdge[], options: LayoutOptions): GraphLayoutResult;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  direction: "top-to-bottom",
  nodeSpacing: 24,
  layerSpacing: 64,
  margin: 24,
};

// Longest-path layering: layer[v] = 1 + max(layer[u]) over all edges u->v.
// Processed in Kahn's topological order so every predecessor is resolved
// before its successors. Any nodes left over after the queue drains (i.e.
// a cycle, which should not occur in a well-formed WorkflowGraph but must
// not crash the renderer) are deterministically appended, sorted by id, one
// layer past the deepest layer seen so far.
function computeLayers(nodes: LayoutInputNode[], edges: LayoutInputEdge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue: string[] = [...nodeIds].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  const remainingInDegree = new Map(inDegree);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const currentLayer = layer.get(id) ?? 0;
    layer.set(id, currentLayer);

    const next: string[] = [];
    for (const target of (outgoing.get(id) ?? []).sort()) {
      const proposedLayer = currentLayer + 1;
      layer.set(target, Math.max(layer.get(target) ?? 0, proposedLayer));
      const remaining = (remainingInDegree.get(target) ?? 0) - 1;
      remainingInDegree.set(target, remaining);
      if (remaining <= 0 && !visited.has(target)) next.push(target);
    }
    queue.push(...next.sort());
  }

  // Deterministic fallback for cyclic remainders (shouldn't happen for valid
  // WorkflowGraphs, but layering must never throw).
  const maxLayer = layer.size > 0 ? Math.max(...layer.values()) : -1;
  const stragglers = [...nodeIds].filter((id) => !visited.has(id)).sort();
  for (const id of stragglers) {
    layer.set(id, maxLayer + 1);
  }

  return layer;
}

export class LayeredLayoutEngine implements LayoutEngine {
  layout(nodes: LayoutInputNode[], edges: LayoutInputEdge[], options: LayoutOptions): GraphLayoutResult {
    const layerOf = computeLayers(nodes, edges);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const layers = new Map<number, string[]>();
    for (const node of nodes) {
      const l = layerOf.get(node.id) ?? 0;
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l)!.push(node.id);
    }
    for (const ids of layers.values()) {
      ids.sort();
    }

    const sortedLayerIndices = [...layers.keys()].sort((a, b) => a - b);
    const positioned = new Map<string, PositionedNode>();

    let crossAxisCursor = options.margin;
    for (const layerIndex of sortedLayerIndices) {
      const ids = layers.get(layerIndex)!;
      const layerNodes = ids.map((id) => nodeById.get(id)!);
      const layerThickness =
        options.direction === "top-to-bottom"
          ? Math.max(...layerNodes.map((n) => n.height))
          : Math.max(...layerNodes.map((n) => n.width));

      let mainAxisCursor = options.margin;
      for (const node of layerNodes) {
        if (options.direction === "top-to-bottom") {
          positioned.set(node.id, {
            id: node.id,
            x: mainAxisCursor,
            y: crossAxisCursor,
            width: node.width,
            height: node.height,
            layer: layerIndex,
          });
          mainAxisCursor += node.width + options.nodeSpacing;
        } else {
          positioned.set(node.id, {
            id: node.id,
            x: crossAxisCursor,
            y: mainAxisCursor,
            width: node.width,
            height: node.height,
            layer: layerIndex,
          });
          mainAxisCursor += node.height + options.nodeSpacing;
        }
      }
      crossAxisCursor += layerThickness + options.layerSpacing;
    }

    const positionedNodes = [...positioned.values()].sort((a, b) => a.id.localeCompare(b.id));

    const positionedEdges: PositionedEdge[] = [...edges]
      .filter((e) => positioned.has(e.from) && positioned.has(e.to))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edge) => {
        const from = positioned.get(edge.from)!;
        const to = positioned.get(edge.to)!;
        const start =
          options.direction === "top-to-bottom"
            ? { x: from.x + from.width / 2, y: from.y + from.height }
            : { x: from.x + from.width, y: from.y + from.height / 2 };
        const end =
          options.direction === "top-to-bottom"
            ? { x: to.x + to.width / 2, y: to.y }
            : { x: to.x, y: to.y + to.height / 2 };
        return { id: edge.id, points: [start, end] };
      });

    const maxX = Math.max(options.margin, ...positionedNodes.map((n) => n.x + n.width)) + options.margin;
    const maxY = Math.max(options.margin, ...positionedNodes.map((n) => n.y + n.height)) + options.margin;

    return {
      width: nodes.length > 0 ? maxX : options.margin * 2,
      height: nodes.length > 0 ? maxY : options.margin * 2,
      nodes: positionedNodes,
      edges: positionedEdges,
    };
  }
}
