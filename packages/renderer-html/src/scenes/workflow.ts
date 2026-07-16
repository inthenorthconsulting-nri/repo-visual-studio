import type { WorkflowGraph } from "@rvs/workflow-graph";
import { renderWorkflowSvg } from "@rvs/workflow-svg";
import type { WorkflowScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

// The workflow diagram keeps its own self-contained, deterministic palette
// (mirroring the same intentional choice already made for the Mermaid
// renderer) rather than mapping the 8 WorkflowNodeTypes onto the design
// system's small, general-purpose color set — that mapping would be lossy
// and arbitrary. Design tokens still drive the surrounding scene chrome
// (headline, annotation list, citations) via the shared CSS variables.
export function renderWorkflowScene(scene: WorkflowScene, graph: WorkflowGraph | undefined): string {
  if (!graph) {
    throw new Error(`Workflow scene "${scene.id}" references unresolved graph_id "${scene.graph_id}"`);
  }

  const { svg } = renderWorkflowSvg(graph, {
    detailLevel: scene.detail_level,
    direction: scene.direction,
    highlight: scene.highlight,
    focusNodeIds: scene.focus_nodes,
  });

  const annotationsHtml =
    scene.annotations.length > 0
      ? `<ul class="workflow-annotations">${scene.annotations
          .map((a) => `<li><code>${escapeHtml(a.target)}</code> — ${escapeHtml(a.text)}</li>`)
          .join("")}</ul>`
      : "";

  return `
    <div class="scene-workflow">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="workflow-svg-wrap">${svg}</div>
      ${annotationsHtml}
    </div>
  `;
}
