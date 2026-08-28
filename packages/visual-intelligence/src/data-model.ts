import type { VisualEvidenceRef } from "./contracts.js";

// The renderer-neutral presentation model.
//
// These are *presentation* structures, not architectural ones. Every node
// carries `source_entity_id` back to the upstream entity it depicts, and
// nothing here may hold a relationship that upstream intelligence did not
// establish -- a VisualEdge exists because a KnowledgeEdge (or an equivalent
// upstream fact) exists, never because two labels looked similar.
//
// Grammar renderers consume this and only this, plus a spec and design
// tokens. That is what keeps @rvs/visual-grammar free of any import from
// @rvs/knowledge-graph, @rvs/governance-intelligence, or
// @rvs/decision-intelligence: an adapter upstream reduces those artifacts to
// the shapes below, and the drawing layer never sees the originals.

/** How a node should be treated visually, derived from upstream facts -- never from layout convenience. */
export type VisualEmphasis =
  /** Explicitly requested by the reader (focus, route endpoint). Never adapted away. */
  | "focal"
  /** On the primary semantic path of the view. */
  | "primary"
  /** Ordinary content. */
  | "normal"
  /** Present for context; the first candidate for clustering. */
  | "supporting"
  /** Deliberately de-emphasised by an active lens or focus mode. Still drawn, still in the DOM. */
  | "muted";

/** Echoes @rvs/knowledge-graph's ResolutionStatus verbatim. A non-`resolved` node is never silently dropped by adaptation. */
export type VisualResolution = "resolved" | "partial" | "unresolved";

/** Echoes @rvs/knowledge-graph's ConfidenceLevel verbatim. Preserved through adaptation; never restated by an audience policy. */
export type VisualConfidence = "confirmed" | "qualified" | "unverifiable";

/**
 * Governance severity as owned by @rvs/governance-intelligence.
 *
 * Carried through so a renderer can *emphasise* a blocking finding. A
 * renderer may never downgrade one because of a layout constraint -- see
 * degradation.ts, where blocking findings sit above every collapse rule.
 */
export type VisualSeverity = "blocking" | "review_required" | "advisory" | "informational";

/** Decision status as owned by @rvs/decision-intelligence. Status is not correctness: nothing in this package maps a status to a success/failure colour. */
export type VisualDecisionStatus = "proposed" | "accepted" | "rejected" | "deprecated" | "superseded" | "unknown";

export interface VisualNode {
  id: string;
  /** The upstream entity this node depicts. Always present; always traceable. */
  source_entity_id: string;
  label: string;
  /** Upstream entity kind, verbatim (e.g. "component", "capability", "decision"). Used as a selection signal and a lens key, never re-interpreted. */
  kind: string;
  emphasis: VisualEmphasis;
  resolution: VisualResolution;
  confidence: VisualConfidence;
  /** Group id when the node belongs to a container (module, domain, lane). */
  group_id?: string;
  /** Set only for nodes representing a governance finding. */
  severity?: VisualSeverity;
  /** Set only for nodes representing a decision. */
  decision_status?: VisualDecisionStatus;
  /** Numeric measure when the upstream model carried one (used by `metric_row`/`matrix`). */
  measure?: { value: number; unit?: string; display: string };
  /** Ordered position when the upstream model carried a sequence/timeline position. */
  order?: number;
  /** Set only on a synthetic stand-in for entities that left the primary view. Never a source entity. */
  placeholder_for?: VisualPlaceholder;
  evidence_refs: VisualEvidenceRef[];
}

/**
 * What a placeholder node stands in for.
 *
 * A view that reduced 48 entities to 3 and drew only those 3 is not an
 * overview, it is a different diagram: the reader has no way to tell that
 * four domains exist, let alone ask to see one. So every collapsed group and
 * every split view leaves a stand-in behind, and the stand-in names the
 * destination.
 *
 * A placeholder is *not* an entity. It is excluded from fidelity accounting
 * entirely -- it appears in no receipt bucket, since counting it as preserved
 * would let a view claim credit for drawing something that does not exist.
 */
export interface VisualPlaceholder {
  /** The `CollapsedGroup` this node represents. */
  collapsed_group_id: string;
  /** The detail view the members were moved to, when they were moved rather than collapsed in place. */
  split_view_id?: string;
  /** How many source entities it stands for. */
  entity_count: number;
  /** The source entity ids it stands for, sorted. */
  source_entity_ids: string[];
}

export interface VisualEdge {
  id: string;
  from_id: string;
  to_id: string;
  /** Upstream relationship kind, verbatim (e.g. "depends_on", "invalidates"). */
  kind: string;
  /** Drawn only when the grammar and the audience policy both allow it. */
  label?: string;
  emphasis: VisualEmphasis;
  resolution: VisualResolution;
  /** True when upstream established this edge participates in a cycle. Never inferred here. */
  in_cycle: boolean;
  evidence_refs: VisualEvidenceRef[];
}

/** A container: a Terraform module, a capability domain, a package, or a cluster produced by adaptation. */
export interface VisualGroup {
  id: string;
  label: string;
  kind: string;
  /** Member node ids, sorted. */
  member_ids: string[];
  /** Parent group id for nested containment. */
  parent_id?: string;
  /** True when this group was produced by adaptation rather than established upstream. Such a group is always disclosed in the fidelity receipt. */
  synthetic: boolean;
}

/** A horizontal band of responsibility (swimlane) or a vertical actor column (sequence). */
export interface VisualLane {
  id: string;
  label: string;
  /** Member node ids in lane order. */
  member_ids: string[];
  order: number;
}

/** One ordered step of a process, workflow, or timeline. */
export interface VisualStage {
  id: string;
  label: string;
  order: number;
  member_ids: string[];
}

/** A standalone labelled measure (metric scenes, distribution summaries). */
export interface VisualMetric {
  id: string;
  label: string;
  display: string;
  value?: number;
  unit?: string;
  evidence_refs: VisualEvidenceRef[];
}

/** Explanatory text bound to a node, edge, group, or the view itself. Annotation depth is an audience decision (audience.ts), never a layout one. */
export interface VisualAnnotation {
  id: string;
  target_id?: string;
  text: string;
  evidence_refs: VisualEvidenceRef[];
}

/** A trust/security/ownership boundary established upstream. Crossing edges are never hidden without disclosure. */
export interface VisualBoundary {
  id: string;
  label: string;
  kind: string;
  member_ids: string[];
}

/** A route through the model, already established upstream (a KnowledgePath, an impact path, a request path). Never re-derived here. */
export interface VisualPath {
  id: string;
  node_ids: string[];
  edge_ids: string[];
  /** True when the path must survive adaptation intact. */
  critical: boolean;
}

/**
 * One view's complete renderer-neutral content.
 *
 * `changes` is populated only for `delta` grammar views and is copied
 * verbatim from an upstream diff artifact -- this layer never computes a
 * diff, never decides what "changed" means, and never infers a change type
 * that upstream did not emit.
 */
export interface VisualGraphModel {
  nodes: VisualNode[];
  edges: VisualEdge[];
  groups: VisualGroup[];
  lanes: VisualLane[];
  stages: VisualStage[];
  metrics: VisualMetric[];
  annotations: VisualAnnotation[];
  boundaries: VisualBoundary[];
  paths: VisualPath[];
  changes: VisualChange[];
  /** True when upstream established at least one cycle among `edges`. */
  has_cycles: boolean;
  /** Maximum containment nesting depth established upstream. */
  containment_depth: number;
}

/**
 * A change fact, copied verbatim from an upstream comparison artifact.
 *
 * The `kind` union is exactly the set upstream already produces -- Milestone
 * 10 adds no new change semantics and infers no architectural meaning that
 * @rvs/knowledge-graph's `GraphChangeSet` or @rvs/governance-intelligence's
 * comparison did not already establish.
 */
export type VisualChangeKind =
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "rerouted"
  | "regressed"
  | "resolved"
  | "qualified"
  | "unresolved";

export interface VisualChange {
  id: string;
  kind: VisualChangeKind;
  /** The entity this change is about. Always a node id present in `nodes`, or an edge id present in `edges`. */
  subject_id: string;
  subject_type: "node" | "edge";
  detail: string;
  evidence_refs: VisualEvidenceRef[];
}

/** An empty model, so callers building one incrementally never have to restate the ten empty arrays. */
export function emptyVisualGraphModel(): VisualGraphModel {
  return {
    nodes: [],
    edges: [],
    groups: [],
    lanes: [],
    stages: [],
    metrics: [],
    annotations: [],
    boundaries: [],
    paths: [],
    changes: [],
    has_cycles: false,
    containment_depth: 0,
  };
}

/**
 * Sorts every collection into canonical order.
 *
 * Determinism gate: adaptation, grammar selection, layout, and digesting all
 * run over a normalized model, so shuffling the caller's input arrays cannot
 * change a single output byte. Nodes sort by id; edges by (from, kind, to);
 * ordered collections by (order, id) so a caller's partial ordering is
 * honoured but ties never fall to insertion order.
 */
export function normalizeVisualGraphModel(model: VisualGraphModel): VisualGraphModel {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byOrderThenId = (a: { id: string; order: number }, b: { id: string; order: number }) =>
    a.order !== b.order ? a.order - b.order : byId(a, b);
  return {
    nodes: [...model.nodes].sort(byId).map((n) => ({ ...n, evidence_refs: [...n.evidence_refs] })),
    edges: [...model.edges].sort((a, b) => {
      if (a.from_id !== b.from_id) return a.from_id < b.from_id ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      if (a.to_id !== b.to_id) return a.to_id < b.to_id ? -1 : 1;
      return byId(a, b);
    }),
    groups: [...model.groups].sort(byId).map((g) => ({ ...g, member_ids: [...g.member_ids].sort() })),
    lanes: [...model.lanes].sort(byOrderThenId),
    stages: [...model.stages].sort(byOrderThenId),
    metrics: [...model.metrics].sort(byId),
    annotations: [...model.annotations].sort(byId),
    boundaries: [...model.boundaries].sort(byId).map((b) => ({ ...b, member_ids: [...b.member_ids].sort() })),
    paths: [...model.paths].sort(byId),
    changes: [...model.changes].sort(byId),
    has_cycles: model.has_cycles,
    containment_depth: model.containment_depth,
  };
}
