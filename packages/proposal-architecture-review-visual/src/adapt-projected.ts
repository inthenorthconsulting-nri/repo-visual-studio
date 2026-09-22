// Projected State surface (Milestone 11.3.3.2B, §14/§4.1).
//
// Graph-shaped only when the upstream `ChangeWorkbenchProjectionOutcome` is
// `"built"` and produced a usable overlay (`OverlayBuildResult.overlay`
// present); every node/edge in that graph carries an explicit
// `confirmed`/`proposed`/`modified` provenance marker. `removed` entities
// need no marker of their own: `buildChangeOverlay()` (@rvs/change-workbench)
// already deletes them from `overlay.nodes`/`overlay.edges` while keeping
// their `"removed"` fact recorded only in `node_provenance`/`edge_provenance`
// -- so every id actually present in this graph resolves to `confirmed`,
// `proposed`, or `modified`, never `removed`. A lookup miss (a defensive
// case only -- see this file's own regression test) still surfaces as an
// explicit unresolved marker rather than a silent default.
//
// An `"invalid"` overlay-build status, an `overlay` result key that is
// absent, or an upstream `"not_built"` outcome are the ONLY paths that
// produce `{ status: "not_built" }` here -- never a fabricated empty graph
// standing in for a real one.

import type { ProjectedStateOutcome } from "@rvs/proposal-architecture-review";
import { emptyVisualGraphModel } from "@rvs/visual-intelligence";
import { toVisualEdge, toVisualNode } from "./kg-adapt.js";
import { provenanceToSemanticMarker, unresolvedProvenanceMarker, type ProjectedProvenanceValue } from "./provenance-marker.js";
import type { ProjectedStateVisualPresentation } from "./contracts.js";

/** Mirrors `@rvs/change-workbench/src/overlay.ts`'s own private `edgeKey()` exactly -- the only key `edge_provenance` is ever recorded under. Not importable (overlay.ts does not export it), so restated here rather than re-derived from `edge.id`, which is a distinct synthetic value for proposal-introduced edges. */
function edgeKey(edge: { from_node_id: string; edge_type: string; to_node_id: string }): string {
  return `${edge.from_node_id}:${edge.edge_type}:${edge.to_node_id}`;
}

function isProjectedProvenanceValue(value: string | undefined): value is ProjectedProvenanceValue {
  return value === "confirmed" || value === "proposed" || value === "modified";
}

export function adaptProjectedState(projection: ProjectedStateOutcome): ProjectedStateVisualPresentation {
  if (projection.status === "not_built") {
    return { status: "not_built", reason: projection.reason };
  }

  const result = projection.result;
  if (result.status === "invalid" || !result.overlay) {
    return {
      status: "not_built",
      reason: `Projection was attempted but produced no usable overlay (build status "${result.status}"); no Projected State graph can be shown.`,
    };
  }

  const overlay = result.overlay;
  const model = emptyVisualGraphModel();

  model.nodes = overlay.nodes.map((node) => {
    const provenance = overlay.node_provenance[node.id];
    const marker = isProjectedProvenanceValue(provenance) ? provenanceToSemanticMarker(provenance) : unresolvedProvenanceMarker();
    return toVisualNode(node, [marker]);
  });

  model.edges = overlay.edges.map((edge) => {
    const provenance = overlay.edge_provenance[edgeKey(edge)];
    const marker = isProjectedProvenanceValue(provenance) ? provenanceToSemanticMarker(provenance) : unresolvedProvenanceMarker();
    return toVisualEdge(edge, [marker]);
  });

  return { status: "built", model };
}
