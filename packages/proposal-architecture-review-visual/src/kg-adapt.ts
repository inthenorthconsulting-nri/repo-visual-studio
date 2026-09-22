// Shared KnowledgeNode/KnowledgeEdge -> VisualNode/VisualEdge field mapping,
// used identically by both graph surfaces (Observed Baseline and Projected
// State) so the two surfaces differ only in *which* entities they show and
// whether they carry a provenance marker -- never in how an individual
// entity's ordinary fields are adapted (Milestone 11.3.3.2B, §13/§14/§40).
//
// This module imports no `@rvs/knowledge-graph` value -- only the already
// upstream-typed shapes flowing through `ObservedBaselineGraph`/
// `ChangeOverlay["nodes"|"edges"]` (both re-exported, ultimately, from
// `@rvs/proposal-architecture-review`). No second identity scheme: visual
// node/edge ids are derived from the exact upstream entity id via
// `buildVisualNodeId`/`buildVisualEdgeId`, the same functions every other
// M10 adapter uses (§41).

import type { VisualEdge, VisualEvidenceRef, VisualNode, VisualResolution, VisualSemanticMarker } from "@rvs/visual-intelligence";
import { buildVisualEdgeId, buildVisualNodeId } from "@rvs/visual-intelligence";

/** Structural shape this package relies on for a node -- exactly `KnowledgeNode`'s fields it uses, named identically so no local re-declaration drifts from the upstream contract. */
export interface StructuralKnowledgeNode {
  id: string;
  node_type: string;
  label: string;
  resolution_status: "resolved" | "unresolved" | "partial";
  confidence: "confirmed" | "qualified" | "unverifiable";
  evidence_refs: readonly { path?: string; lines?: string; source_artifact?: string; detail?: string }[];
}

/** Structural shape this package relies on for an edge -- widens `resolution_status` to the real five-value `EdgeResolutionStatus`, mapped down to `VisualResolution`'s three values below. */
export interface StructuralKnowledgeEdge {
  id: string;
  edge_type: string;
  from_node_id: string;
  to_node_id: string;
  resolution_status: "resolved" | "unresolved" | "partial" | "ambiguous" | "incompatible";
  evidence_refs: readonly { path?: string; lines?: string; source_artifact?: string; detail?: string }[];
}

function toVisualEvidenceRefs(refs: readonly { path?: string; lines?: string; source_artifact?: string; detail?: string }[]): VisualEvidenceRef[] {
  return refs.map((ref) => ({
    path: ref.path,
    lines: ref.lines,
    source_artifact: ref.source_artifact,
    detail: ref.detail,
  }));
}

/**
 * `KnowledgeEdge.resolution_status` (`EdgeResolutionStatus`, five values) is
 * strictly wider than `VisualResolution` (three values) -- this mapping is
 * the one place that narrows it, deterministically and without ever
 * upgrading an edge's trustworthiness: `"ambiguous"` (more than one
 * candidate resolution exists) maps to `"partial"` (some correspondence
 * established, not fully reliable); `"incompatible"` (the candidate
 * resolution was structurally rejected) maps to `"unresolved"` (no usable
 * correspondence).
 */
function narrowEdgeResolution(status: StructuralKnowledgeEdge["resolution_status"]): VisualResolution {
  switch (status) {
    case "resolved":
      return "resolved";
    case "partial":
    case "ambiguous":
      return "partial";
    case "unresolved":
    case "incompatible":
      return "unresolved";
  }
}

/** Adapts one architecture node into its generic visual presentation, with no proposal-provenance marker -- callers attach `semantic_markers` themselves where warranted (Projected State only; see adapt-projected.ts). */
export function toVisualNode(node: StructuralKnowledgeNode, semanticMarkers?: readonly VisualSemanticMarker[]): VisualNode {
  return {
    id: buildVisualNodeId(node.id),
    source_entity_id: node.id,
    label: node.label,
    kind: node.node_type,
    emphasis: "normal",
    resolution: node.resolution_status,
    confidence: node.confidence,
    // Never inferred: no upstream containment fact is available in this
    // structural intake, so no `in_cycle`/cycle-bearing group is invented.
    semantic_markers: semanticMarkers,
    evidence_refs: toVisualEvidenceRefs(node.evidence_refs),
  };
}

/** Adapts one architecture relation into its generic visual presentation. `in_cycle` is always `false` -- this structural intake carries no cycle fact, and none is inferred (matches @rvs/visual-explorer's and @rvs/visual-change-review's own source adapters). */
export function toVisualEdge(edge: StructuralKnowledgeEdge, semanticMarkers?: readonly VisualSemanticMarker[]): VisualEdge {
  return {
    id: buildVisualEdgeId(edge.edge_type, edge.from_node_id, edge.to_node_id),
    from_id: buildVisualNodeId(edge.from_node_id),
    to_id: buildVisualNodeId(edge.to_node_id),
    kind: edge.edge_type,
    emphasis: "normal",
    resolution: narrowEdgeResolution(edge.resolution_status),
    in_cycle: false,
    semantic_markers: semanticMarkers,
    evidence_refs: toVisualEvidenceRefs(edge.evidence_refs),
  };
}
