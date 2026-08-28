import type {
  VisualEdge,
  VisualEvidenceRef,
  VisualGraphModel,
  VisualGroup,
  VisualNode,
  VisualResolution,
} from "@rvs/visual-intelligence";
import { emptyVisualGraphModel, normalizeVisualGraphModel, normalizeIds } from "@rvs/visual-intelligence";

// Turning cached upstream artifacts into a presentation model.
//
// The intake shapes below are *structural*. This package imports nothing from
// @rvs/knowledge-graph, @rvs/governance-intelligence or
// @rvs/decision-intelligence, and the caller -- the CLI, which already reads
// those caches -- passes plain objects in. That is the same zero-cross-import
// convention every intelligence layer follows, and it is what lets the
// explorer be tested against fixtures rather than against a built repository.
//
// Nothing here establishes a relationship. Every edge in the output exists
// because an edge existed in the input; every state is copied verbatim.

/** A knowledge-graph node, structurally. Field names match the cached artifact so the CLI passes it through untouched. */
export interface ExplorerSourceNode {
  id: string;
  node_type: string;
  label: string;
  source_entity_id: string;
  resolution_status: string;
  confidence: string;
  evidence_refs?: readonly VisualEvidenceRef[];
}

/** A knowledge-graph edge, structurally. */
export interface ExplorerSourceEdge {
  id: string;
  edge_type: string;
  from_node_id: string;
  to_node_id: string;
  resolution_status: string;
  detail?: string;
}

/** A governance finding's severity, attached to the entity it concerns. Severity is owned upstream and copied, never derived. */
export interface ExplorerSeverityOverlay {
  entity_id: string;
  severity: "blocking" | "review_required" | "advisory" | "informational";
}

/** A decision's status, attached to the entity it concerns. */
export interface ExplorerDecisionOverlay {
  entity_id: string;
  status: "proposed" | "accepted" | "rejected" | "deprecated" | "superseded" | "unknown";
}

export interface ExplorerSourceInput {
  nodes: readonly ExplorerSourceNode[];
  edges: readonly ExplorerSourceEdge[];
  severities?: readonly ExplorerSeverityOverlay[];
  decisions?: readonly ExplorerDecisionOverlay[];
  /** Entities the reader asked about. They become focal and are never adapted away. */
  focal_entity_ids?: readonly string[];
  /** Node ids on a path the caller established as critical. Never inferred here. */
  critical_path_node_ids?: readonly string[];
}

/** Node types that act as containers when they sit at the `from` end of a `contains` edge. */
const CONTAINER_TYPES = new Set(["repository", "package", "capability_domain", "product", "workflow"]);

/** Edge resolution values that mean "this relationship is not fully established". */
const UNRESOLVED_EDGE = new Set(["unresolved", "partial", "unresolved_target", "unresolved_source"]);

function resolutionOf(value: string): VisualResolution {
  return value === "unresolved" || value === "partial" ? value : "resolved";
}

function confidenceOf(value: string): VisualNode["confidence"] {
  return value === "qualified" || value === "unverifiable" ? value : "confirmed";
}

/**
 * Which container each node belongs to.
 *
 * A node can be `contains`-ed by more than one container in a graph built
 * from several artifacts. Picking the lexicographically smallest container id
 * is arbitrary but *stable*, and stability is the property that matters: a
 * content-dependent choice would move boxes between two runs over the same
 * repository.
 */
function containment(edges: readonly ExplorerSourceEdge[], typeOf: ReadonlyMap<string, string>): Map<string, string> {
  const byChild = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "contains") continue;
    if (!CONTAINER_TYPES.has(typeOf.get(edge.from_node_id) ?? "")) continue;
    byChild.set(edge.to_node_id, [...(byChild.get(edge.to_node_id) ?? []), edge.from_node_id]);
  }
  const chosen = new Map<string, string>();
  for (const [child, parents] of byChild) chosen.set(child, normalizeIds(parents)[0]);
  return chosen;
}

/**
 * Builds the presentation model the explorer draws and queries.
 *
 * Containers become `VisualGroup`s and stop being nodes, because a box that is
 * both the frame around six things and a seventh thing inside the frame reads
 * as a mistake. Their `contains` edges are dropped with them: containment is
 * drawn as containment, not as an arrow that duplicates it.
 */
export function buildExplorerModel(input: ExplorerSourceInput): VisualGraphModel {
  const typeOf = new Map(input.nodes.map((n) => [n.id, n.node_type] as const));
  const groupOf = containment(input.edges, typeOf);
  const containerIds = new Set([...groupOf.values()]);

  const focal = new Set(input.focal_entity_ids ?? []);
  const critical = new Set(input.critical_path_node_ids ?? []);
  const severityOf = new Map((input.severities ?? []).map((s) => [s.entity_id, s.severity] as const));
  const statusOf = new Map((input.decisions ?? []).map((d) => [d.entity_id, d.status] as const));

  const nodes: VisualNode[] = input.nodes
    .filter((n) => !containerIds.has(n.id))
    .map((n) => {
      const severity = severityOf.get(n.id) ?? severityOf.get(n.source_entity_id);
      const status = statusOf.get(n.id) ?? statusOf.get(n.source_entity_id);
      return {
        id: n.id,
        source_entity_id: n.source_entity_id,
        label: n.label,
        kind: n.node_type,
        emphasis: focal.has(n.id) || focal.has(n.source_entity_id)
          ? "focal"
          : critical.has(n.id)
            ? "primary"
            : "normal",
        resolution: resolutionOf(n.resolution_status),
        confidence: confidenceOf(n.confidence),
        ...(groupOf.has(n.id) ? { group_id: groupOf.get(n.id) } : {}),
        ...(severity === undefined ? {} : { severity }),
        ...(status === undefined ? {} : { decision_status: status }),
        evidence_refs: [...(n.evidence_refs ?? [])],
      } satisfies VisualNode;
    });

  const drawn = new Set(nodes.map((n) => n.id));
  const edges: VisualEdge[] = input.edges
    .filter((e) => e.edge_type !== "contains" && drawn.has(e.from_node_id) && drawn.has(e.to_node_id))
    .map((e) => ({
      id: e.id,
      from_id: e.from_node_id,
      to_id: e.to_node_id,
      kind: e.edge_type,
      emphasis: critical.has(e.from_node_id) && critical.has(e.to_node_id) ? "primary" : "normal",
      resolution: UNRESOLVED_EDGE.has(e.resolution_status) ? "unresolved" : "resolved",
      // Cycles are an upstream fact. This builder has not been told about one,
      // so it says nothing rather than running its own detection and calling
      // the answer evidence.
      in_cycle: false,
      evidence_refs: [],
    } satisfies VisualEdge));

  const labelOf = new Map(input.nodes.map((n) => [n.id, n.label] as const));
  const groups: VisualGroup[] = [...containerIds]
    .filter((id) => nodes.some((n) => n.group_id === id))
    .map((id) => ({
      id,
      label: labelOf.get(id) ?? id,
      kind: typeOf.get(id) ?? "container",
      member_ids: normalizeIds(nodes.filter((n) => n.group_id === id).map((n) => n.id)),
      synthetic: false,
    }));

  const criticalNodeIds = normalizeIds(nodes.filter((n) => critical.has(n.id)).map((n) => n.id));

  return normalizeVisualGraphModel({
    ...emptyVisualGraphModel(),
    nodes,
    edges,
    groups,
    paths:
      criticalNodeIds.length < 2
        ? []
        : [
            {
              id: "explorer-critical-path",
              node_ids: criticalNodeIds,
              edge_ids: normalizeIds(
                edges.filter((e) => critical.has(e.from_id) && critical.has(e.to_id)).map((e) => e.id),
              ),
              critical: true,
            },
          ],
    containment_depth: groups.length > 0 ? 1 : 0,
  });
}
