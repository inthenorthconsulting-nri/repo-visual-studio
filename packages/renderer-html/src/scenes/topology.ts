import { buildTerraformSceneSubgraphs, type TerraformTopology } from "@rvs/terraform-graph";
import { renderTerraformSvg } from "@rvs/terraform-svg";
import type { TopologyScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

// Mirrors renderWorkflowScene's rationale exactly: the topology diagram
// keeps its own self-contained, deterministic palette (matching the
// Mermaid/SVG renderers' shared NODE_TYPE defaults) rather than mapping
// TerraformNodeTypes onto the design system's small color set.
export function renderTopologyScene(scene: TopologyScene, topology: TerraformTopology | undefined): string {
  if (!topology) {
    throw new Error(`Topology scene "${scene.id}" references unresolved topology_id "${scene.topology_id}"`);
  }

  const parts = buildTerraformSceneSubgraphs(topology, scene.detail_level, []);
  const subgraph = parts[scene.part_index];
  if (!subgraph) {
    throw new Error(`Topology scene "${scene.id}" references out-of-range part_index ${scene.part_index} (topology "${scene.topology_id}" has ${parts.length} part(s) at detail level "${scene.detail_level}")`);
  }

  const { svg } = renderTerraformSvg(topology, subgraph, {
    direction: scene.direction,
    highlight: scene.highlight,
  });

  return `
    <div class="scene-topology">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="topology-svg-wrap">${svg}</div>
    </div>
  `;
}
