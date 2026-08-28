import {
  emptyVisualGraphModel,
  type VisualEdge,
  type VisualGraphModel,
  type VisualNode,
} from "@rvs/visual-intelligence";

export function node(id: string, over: Partial<VisualNode> = {}): VisualNode {
  return {
    id,
    source_entity_id: over.source_entity_id ?? id,
    label: over.label ?? `${id} service`,
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

const id = (i: number) => `n${String(i).padStart(3, "0")}`;

/**
 * A model large enough that every detail mode has to do something, carrying
 * one of each upstream state so the terminology-invariant proof has
 * something to hold on to.
 */
export function estateModel(count = 48): VisualGraphModel {
  const domains = ["edge", "core", "data", "governance"];
  const nodes = Array.from({ length: count }, (_, i) =>
    node(id(i), {
      group_id: domains[i % domains.length],
      order: i,
      evidence_refs: [{ path: `src/${domains[i % domains.length]}/${id(i)}.ts`, lines: "1-20" }],
      ...(i === 0 ? { emphasis: "focal" as const, kind: "runtime_entrypoint" } : {}),
      ...(i === 3 ? { severity: "blocking" as const } : {}),
      ...(i === 5 ? { severity: "review_required" as const } : {}),
      ...(i === 7 ? { decision_status: "superseded" as const } : {}),
      ...(i === 9 ? { resolution: "unresolved" as const } : {}),
      ...(i === 11 ? { resolution: "partial" as const, confidence: "qualified" as const } : {}),
    }),
  );
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
  return model({
    nodes,
    edges,
    groups: domains.map((d) => ({
      id: d,
      label: `${d} domain`,
      kind: "container",
      synthetic: false,
      member_ids: nodes.filter((n) => n.group_id === d).map((n) => n.id),
    })),
    annotations: [
      { id: "a1", target_id: id(0), text: "entry point for all public traffic", evidence_refs: [] },
      { id: "a2", target_id: id(3), text: "blocking policy violation", evidence_refs: [{ path: "policies/net.yml" }] },
      { id: "a3", target_id: id(20), text: "scheduled for retirement", evidence_refs: [] },
    ],
    paths: [{ id: "p1", node_ids: [id(0), id(1), id(2)], edge_ids: [`${id(0)}->${id(1)}`, `${id(1)}->${id(2)}`], critical: true }],
    containment_depth: 1,
  });
}

/**
 * An estate with no containers to split along.
 *
 * The container-shaped fixture above is deliberately *insensitive* to detail
 * mode: its primary view is one stand-in per domain plus whatever protection
 * holds back, and that count is set by how many domains exist rather than by
 * the budget. To watch the budget itself bite, the model has to offer nothing
 * but ordinary reducible entities.
 */
export function flatModel(count = 40): VisualGraphModel {
  const nodes = Array.from({ length: count }, (_, i) =>
    node(id(i), {
      order: i,
      evidence_refs: [{ path: `src/${id(i)}.ts`, lines: "1-20" }],
      ...(i === 0 ? { emphasis: "focal" as const, kind: "runtime_entrypoint" } : {}),
    }),
  );
  return model({ nodes, edges: nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id)) });
}

/** A model small enough that nothing is reduced at any detail mode. */
export function tinyModel(): VisualGraphModel {
  return model({
    nodes: [node("a", { emphasis: "focal" }), node("b"), node("c")],
    edges: [edge("a", "b"), edge("b", "c")],
  });
}

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

export function shuffleModel(m: VisualGraphModel, seed: number): VisualGraphModel {
  return {
    ...m,
    nodes: shuffle(m.nodes, seed),
    edges: shuffle(m.edges, seed + 1),
    groups: shuffle(m.groups, seed + 2),
    annotations: shuffle(m.annotations, seed + 3),
    paths: shuffle(m.paths, seed + 4),
  };
}
