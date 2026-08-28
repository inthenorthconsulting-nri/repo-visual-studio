import type { VisualGraphModel, VisualNode } from "@rvs/visual-intelligence";
import { normalizeIds } from "@rvs/visual-intelligence";

// The explorer's query primitives.
//
// Every one of them is a pure function over the model, defined here rather
// than inside the runtime script, for a reason worth stating: a behaviour
// that exists only as browser code is a behaviour with no test. The runtime
// in `runtime.ts` calls exactly these algorithms, and the properties asserted
// here -- deterministic ordering, bounded reach, no invented relationship --
// are therefore properties of what the reader actually gets.
//
// None of them mutates the model, and none of them decides what is *true*.
// They select, order, and de-emphasise. An entity a lens mutes is still
// drawn, still in the document, and still reachable by search.

export type TraversalDirection = "upstream" | "downstream" | "both";

export interface SearchHit {
  node_id: string;
  source_entity_id: string;
  label: string;
  kind: string;
  /** 0 exact id/label, 1 label prefix, 2 label substring, 3 id substring. */
  rank: number;
}

/**
 * Entities matching a query, best match first.
 *
 * Ranked by *how* the query matched rather than by any notion of importance:
 * the explorer has no basis for saying one component matters more than
 * another, and inventing one would be a claim dressed as a convenience. Ties
 * break on id, so two runs over the same graph list results in one order.
 */
export function searchEntities(model: VisualGraphModel, query: string, limit = 50): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const hits: SearchHit[] = [];
  for (const node of model.nodes) {
    if (node.placeholder_for !== undefined) continue;
    const label = node.label.toLowerCase();
    const id = node.source_entity_id.toLowerCase();
    const rank =
      label === needle || id === needle
        ? 0
        : label.startsWith(needle)
          ? 1
          : label.includes(needle)
            ? 2
            : id.includes(needle)
              ? 3
              : -1;
    if (rank < 0) continue;
    hits.push({ node_id: node.id, source_entity_id: node.source_entity_id, label: node.label, kind: node.kind, rank });
  }
  hits.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.node_id < b.node_id ? -1 : 1));
  return hits.slice(0, limit);
}

export interface ReachResult {
  /** Node ids within reach, sorted, including the origin. */
  node_ids: string[];
  /** Edge ids traversed, sorted. */
  edge_ids: string[];
  /** Depth at which each node was first reached. */
  depth_of: Record<string, number>;
  /** True when the traversal stopped at `max_depth` with more graph beyond it. */
  truncated: boolean;
}

/**
 * What is reachable from an entity within a bounded number of hops.
 *
 * Bounded, and the bound is *disclosed*: `truncated` says whether the answer
 * is the whole neighbourhood or the part of it that fit. An unbounded
 * traversal on a large graph selects everything, which tells the reader
 * nothing while looking like it told them something.
 */
export function reachFrom(
  model: VisualGraphModel,
  originId: string,
  options: { direction?: TraversalDirection; max_depth?: number } = {},
): ReachResult {
  const direction = options.direction ?? "downstream";
  const maxDepth = Math.max(0, options.max_depth ?? 2);
  const known = new Set(model.nodes.map((n) => n.id));
  if (!known.has(originId)) return { node_ids: [], edge_ids: [], depth_of: {}, truncated: false };

  const outgoing = new Map<string, { to: string; edge: string }[]>();
  for (const edge of model.edges) {
    if (direction === "downstream" || direction === "both") {
      outgoing.set(edge.from_id, [...(outgoing.get(edge.from_id) ?? []), { to: edge.to_id, edge: edge.id }]);
    }
    if (direction === "upstream" || direction === "both") {
      outgoing.set(edge.to_id, [...(outgoing.get(edge.to_id) ?? []), { to: edge.from_id, edge: edge.id }]);
    }
  }

  const depthOf: Record<string, number> = { [originId]: 0 };
  const edges = new Set<string>();
  let frontier = [originId];
  let truncated = false;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const step of (outgoing.get(id) ?? []).slice().sort((a, b) => (a.edge < b.edge ? -1 : 1))) {
        edges.add(step.edge);
        if (depthOf[step.to] !== undefined) continue;
        depthOf[step.to] = depth;
        next.push(step.to);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  // Anything still on the frontier at the cutoff has unexplored neighbours.
  for (const id of frontier) {
    if ((outgoing.get(id) ?? []).some((step) => depthOf[step.to] === undefined)) truncated = true;
  }

  return {
    node_ids: normalizeIds(Object.keys(depthOf)),
    edge_ids: normalizeIds([...edges]),
    depth_of: depthOf,
    truncated,
  };
}

export interface RouteResult {
  /** Node ids from origin to destination, in order. Empty when no route exists. */
  node_ids: string[];
  /** Edge ids traversed, in order. */
  edge_ids: string[];
  found: boolean;
}

/**
 * The shortest route between two entities.
 *
 * Shortest, and among equally short routes the one whose edge ids sort first.
 * "Any shortest path" would be a correct answer and a useless artifact: two
 * runs would draw different routes through the same architecture and a reader
 * comparing them would be comparing coin flips.
 */
export function traceRoute(
  model: VisualGraphModel,
  fromId: string,
  toId: string,
  options: { direction?: TraversalDirection } = {},
): RouteResult {
  const direction = options.direction ?? "downstream";
  const known = new Set(model.nodes.map((n) => n.id));
  if (!known.has(fromId) || !known.has(toId)) return { node_ids: [], edge_ids: [], found: false };
  if (fromId === toId) return { node_ids: [fromId], edge_ids: [], found: true };

  const steps = new Map<string, { to: string; edge: string }[]>();
  const add = (from: string, to: string, edge: string) =>
    steps.set(from, [...(steps.get(from) ?? []), { to, edge }]);
  for (const edge of model.edges) {
    if (direction === "downstream" || direction === "both") add(edge.from_id, edge.to_id, edge.id);
    if (direction === "upstream" || direction === "both") add(edge.to_id, edge.from_id, edge.id);
  }

  const cameFrom = new Map<string, { node: string; edge: string }>();
  const seen = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const step of (steps.get(id) ?? []).slice().sort((a, b) => (a.edge < b.edge ? -1 : 1))) {
        if (seen.has(step.to)) continue;
        seen.add(step.to);
        cameFrom.set(step.to, { node: id, edge: step.edge });
        if (step.to === toId) {
          const nodeIds = [toId];
          const edgeIds: string[] = [];
          let cursor = toId;
          while (cursor !== fromId) {
            const prev = cameFrom.get(cursor)!;
            nodeIds.unshift(prev.node);
            edgeIds.unshift(prev.edge);
            cursor = prev.node;
          }
          return { node_ids: nodeIds, edge_ids: edgeIds, found: true };
        }
        next.push(step.to);
      }
    }
    frontier = next;
  }
  return { node_ids: [], edge_ids: [], found: false };
}

export type ExplorerLens = "none" | "governance" | "decisions" | "unresolved" | "evidence";

export interface LensDefinition {
  id: ExplorerLens;
  label: string;
  /** What the lens brings forward, stated for the reader rather than left to the colour. */
  description: string;
}

/**
 * The lenses, published as data.
 *
 * A lens changes emphasis and nothing else. It cannot remove an entity,
 * because a reader who cannot see that something was excluded cannot tell an
 * empty answer from an unasked question -- and every lens here answers a
 * question where that distinction is the whole point.
 */
export const EXPLORER_LENSES: readonly LensDefinition[] = [
  { id: "none", label: "No lens", description: "Every entity at its own emphasis." },
  { id: "governance", label: "Governance", description: "Brings forward entities carrying a governance finding." },
  { id: "decisions", label: "Decisions", description: "Brings forward entities carrying a decision status." },
  { id: "unresolved", label: "Unresolved", description: "Brings forward entities whose reference upstream could not resolve." },
  { id: "evidence", label: "Evidence", description: "Brings forward entities with at least one evidence reference." },
];

function matchesLens(node: VisualNode, lens: ExplorerLens): boolean {
  switch (lens) {
    case "governance":
      return node.severity !== undefined;
    case "decisions":
      return node.decision_status !== undefined;
    case "unresolved":
      return node.resolution !== "resolved" || node.confidence !== "confirmed";
    case "evidence":
      return node.evidence_refs.length > 0;
    default:
      return true;
  }
}

/**
 * Applies a lens and an optional focus set as *emphasis*.
 *
 * Nothing is removed. A node outside the lens or outside the focus set is
 * muted -- still drawn, still in the document, still found by search, still
 * announced by a screen reader. Muting is a way of saying "not what you
 * asked about"; hiding would be a way of saying "not there".
 *
 * Focal nodes are never muted: the reader named them.
 */
export function applyLens(
  model: VisualGraphModel,
  lens: ExplorerLens,
  focusNodeIds?: readonly string[],
): VisualGraphModel {
  const focus = focusNodeIds === undefined ? undefined : new Set(focusNodeIds);
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      if (node.emphasis === "focal") return node;
      const inLens = matchesLens(node, lens);
      const inFocus = focus === undefined || focus.has(node.id);
      if (inLens && inFocus) return node;
      return { ...node, emphasis: "muted" as const };
    }),
  };
}
