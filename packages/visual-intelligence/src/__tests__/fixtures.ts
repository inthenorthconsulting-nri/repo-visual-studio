import {
  emptyVisualGraphModel,
  type VisualEdge,
  type VisualGraphModel,
  type VisualNode,
} from "../data-model.js";

/** Minimal node with sane defaults, so a test only states the field it is actually about. */
export function node(id: string, over: Partial<VisualNode> = {}): VisualNode {
  return {
    id,
    source_entity_id: over.source_entity_id ?? id,
    label: over.label ?? id,
    kind: over.kind ?? "component",
    emphasis: over.emphasis ?? "normal",
    resolution: over.resolution ?? "resolved",
    confidence: over.confidence ?? "confirmed",
    evidence_refs: over.evidence_refs ?? [],
    ...over,
  };
}

export function edge(from: string, to: string, over: Partial<VisualEdge> = {}): VisualEdge {
  return {
    id: over.id ?? `${from}->${to}`,
    from_id: from,
    to_id: to,
    kind: over.kind ?? "depends_on",
    emphasis: over.emphasis ?? "normal",
    resolution: over.resolution ?? "resolved",
    in_cycle: over.in_cycle ?? false,
    evidence_refs: over.evidence_refs ?? [],
    ...over,
  };
}

export function model(over: Partial<VisualGraphModel> = {}): VisualGraphModel {
  return { ...emptyVisualGraphModel(), ...over };
}

/** A chain a -> b -> c -> ... of `count` resolved components. */
export function chain(count: number, prefix = "n"): VisualGraphModel {
  const nodes = Array.from({ length: count }, (_, i) => node(`${prefix}${String(i).padStart(3, "0")}`));
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
  return model({ nodes, edges });
}

/**
 * A deterministic shuffle.
 *
 * Deliberately not `Math.random()`: a determinism proof that shuffles
 * randomly can only fail intermittently, which is the least useful way for a
 * determinism bug to be reported. This permutation is reproducible, so a
 * failure is reproducible too.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed * 2654435761 + 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffles every ordered collection of a model, leaving its content identical. */
export function shuffleModel(m: VisualGraphModel, seed: number): VisualGraphModel {
  return {
    ...m,
    nodes: shuffle(m.nodes, seed),
    edges: shuffle(m.edges, seed + 1),
    groups: shuffle(m.groups, seed + 2),
    lanes: shuffle(m.lanes, seed + 3),
    stages: shuffle(m.stages, seed + 4),
    metrics: shuffle(m.metrics, seed + 5),
    annotations: shuffle(m.annotations, seed + 6),
    boundaries: shuffle(m.boundaries, seed + 7),
    paths: shuffle(m.paths, seed + 8),
    changes: shuffle(m.changes, seed + 9),
  };
}
