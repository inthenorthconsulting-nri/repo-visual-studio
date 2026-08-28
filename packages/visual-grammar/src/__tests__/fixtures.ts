import {
  buildVisualCommunicationSpec,
  emptyVisualGraphModel,
  type VisualCommunicationSpec,
  type VisualEdge,
  type VisualGrammar,
  type VisualGraphModel,
  type VisualNode,
} from "@rvs/visual-intelligence";

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

/**
 * A model exercising every feature a grammar can draw: containers, lanes,
 * stages, a critical path, a boundary, changes, a cycle, and nodes carrying
 * every state a renderer maps to a visual treatment.
 */
export function richModel(): VisualGraphModel {
  const nodes = [
    node("api", { kind: "runtime_entrypoint", emphasis: "focal", group_id: "edge", order: 0 }),
    node("auth", { kind: "component", group_id: "edge", order: 1, severity: "review_required" }),
    node("core", { kind: "component", group_id: "core", order: 2, emphasis: "primary" }),
    node("store", { kind: "datastore", group_id: "core", order: 3, resolution: "partial" }),
    node("legacy", { kind: "component", group_id: "core", order: 4, resolution: "unresolved" }),
    node("policy", { kind: "policy", group_id: "governance", order: 5, severity: "blocking" }),
    node("adr", { kind: "decision", group_id: "governance", order: 6, decision_status: "superseded" }),
    node("cost", { kind: "metric", group_id: "governance", order: 7, measure: { value: 42, unit: "%", display: "42%" } }),
  ];
  return model({
    nodes,
    edges: [
      edge("api", "auth"),
      edge("auth", "core"),
      edge("core", "store", { label: "reads" }),
      edge("core", "legacy", { resolution: "unresolved" }),
      edge("legacy", "core", { in_cycle: true }),
      edge("policy", "core", { kind: "constrains", emphasis: "primary" }),
      edge("adr", "policy", { kind: "invalidates" }),
    ],
    groups: [
      { id: "edge", label: "Edge", kind: "domain", member_ids: ["api", "auth"], synthetic: false },
      { id: "core", label: "Core", kind: "domain", member_ids: ["core", "store", "legacy"], synthetic: false },
      { id: "governance", label: "Governance", kind: "domain", member_ids: ["policy", "adr", "cost"], synthetic: false },
    ],
    lanes: [
      { id: "lane-edge", label: "Edge team", member_ids: ["api", "auth"], order: 0 },
      { id: "lane-core", label: "Platform team", member_ids: ["core", "store", "legacy"], order: 1 },
      { id: "lane-gov", label: "Governance", member_ids: ["policy", "adr", "cost"], order: 2 },
    ],
    stages: [
      { id: "s1", label: "Ingress", order: 0, member_ids: ["api", "auth"] },
      { id: "s2", label: "Processing", order: 1, member_ids: ["core", "store"] },
      { id: "s3", label: "Review", order: 2, member_ids: ["policy", "adr", "cost", "legacy"] },
    ],
    boundaries: [{ id: "b1", label: "Public", kind: "trust", member_ids: ["api"] }],
    paths: [{ id: "p1", node_ids: ["api", "auth", "core"], edge_ids: ["api->auth", "auth->core"], critical: true }],
    changes: [
      { id: "c1", kind: "added", subject_id: "cost", subject_type: "node", detail: "new metric", evidence_refs: [] },
      { id: "c2", kind: "removed", subject_id: "legacy", subject_type: "node", detail: "retired", evidence_refs: [] },
      { id: "c3", kind: "changed", subject_id: "core", subject_type: "node", detail: "reworked", evidence_refs: [] },
    ],
    has_cycles: true,
    containment_depth: 1,
  });
}

/** Builds a real spec, then overrides the grammar so a test can exercise one engine directly. */
export function specFor(grammar: VisualGrammar, m: VisualGraphModel = richModel()): VisualCommunicationSpec {
  const built = buildVisualCommunicationSpec({
    producer: "test",
    subject: `subject-${grammar}`,
    semantic_intent: "architecture",
    model: m,
    audience: "engineering",
    detail_mode: "faithful",
    format: "slide",
  });
  return { ...built.spec, visual_grammar: grammar };
}

/** A deterministic shuffle, so a determinism failure is reproducible rather than intermittent. */
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
    lanes: shuffle(m.lanes, seed + 3),
    stages: shuffle(m.stages, seed + 4),
    metrics: shuffle(m.metrics, seed + 5),
    annotations: shuffle(m.annotations, seed + 6),
    boundaries: shuffle(m.boundaries, seed + 7),
    paths: shuffle(m.paths, seed + 8),
    changes: shuffle(m.changes, seed + 9),
  };
}
