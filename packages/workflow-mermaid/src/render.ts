import { selectSceneSubgraph, type WorkflowDetailLevel, type WorkflowGraph } from "@rvs/workflow-graph";
import { escapeMermaidLabel, mermaidId } from "./escape.js";
import { NODE_TYPE_CLASS_DEFS, NODE_TYPE_LABELS, wrapNodeShape } from "./node-shapes.js";

export interface RenderMermaidOptions {
  detailLevel?: WorkflowDetailLevel;
  direction?: "left-to-right" | "top-to-bottom";
  focusNodeIds?: string[];
  highlight?: string[];
}

function evidenceComment(ref: { path: string; lines?: string }): string {
  return ref.lines ? `${ref.path}:${ref.lines}` : ref.path;
}

// Consumes a WorkflowGraph directly (via the shared, renderer-neutral
// selectSceneSubgraph) and produces valid Mermaid flowchart syntax. Never
// the reverse — Mermaid syntax never flows back into the graph model.
export function renderWorkflowMermaid(graph: WorkflowGraph, options: RenderMermaidOptions = {}): string {
  const detailLevel = options.detailLevel ?? "jobs";
  const direction = options.direction === "left-to-right" ? "LR" : "TD";
  const highlight = new Set(options.highlight ?? []);

  const { nodes, edges } = selectSceneSubgraph(graph, detailLevel, options.focusNodeIds);
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);
  lines.push(`%% Workflow: ${graph.name} (${graph.sourcePath})`);
  lines.push("%% Generated deterministically from repository evidence. Do not hand-edit — re-run `rvs create workflow`.");
  lines.push("");

  const typesPresent = new Set<string>();
  const dynamicIds = new Set<string>();

  for (const node of sortedNodes) {
    typesPresent.add(node.type);
    const id = mermaidId(node.id);
    const isDynamic = node.confidence === "dynamic" || node.confidence === "unsupported";
    if (isDynamic) dynamicIds.add(id);
    const labelSuffix = isDynamic ? ` [${node.confidence}]` : "";
    const label = escapeMermaidLabel(node.label + labelSuffix);
    const evidenceRefs = node.evidence.map(evidenceComment).join(", ") || "no evidence";
    lines.push(`  %% node ${node.id} evidence=${evidenceRefs}`);
    lines.push(`  ${wrapNodeShape(node.type, id, label)}`);
  }

  lines.push("");

  for (const edge of sortedEdges) {
    const fromId = mermaidId(edge.from);
    const toId = mermaidId(edge.to);
    const isDynamic = edge.confidence === "dynamic" || edge.confidence === "unsupported";
    const isConditional = edge.type === "conditional";
    const dashed = isConditional || isDynamic;
    const evidenceRefs = edge.evidence.map(evidenceComment).join(", ") || "no evidence";
    lines.push(`  %% edge ${edge.id} evidence=${evidenceRefs}`);
    const arrow = dashed ? "-.->" : "-->";
    if (edge.label) {
      lines.push(`  ${fromId} ${arrow}|${escapeMermaidLabel(edge.label)}| ${toId}`);
    } else {
      lines.push(`  ${fromId} ${arrow} ${toId}`);
    }
  }

  lines.push("");

  for (const type of Object.keys(NODE_TYPE_CLASS_DEFS)) {
    if (typesPresent.has(type)) {
      lines.push(`  classDef ${type} ${NODE_TYPE_CLASS_DEFS[type as keyof typeof NODE_TYPE_CLASS_DEFS]}`);
    }
  }
  lines.push("  classDef highlight stroke:#f97316,stroke-width:4px");
  lines.push("  classDef dynamic stroke-dasharray: 4 2");

  for (const node of sortedNodes) {
    const id = mermaidId(node.id);
    const classes: string[] = [node.type];
    if (highlight.has(node.id)) classes.push("highlight");
    if (dynamicIds.has(id)) classes.push("dynamic");
    lines.push(`  class ${id} ${classes.join(",")}`);
  }

  if (typesPresent.size > 1) {
    lines.push("");
    lines.push("  subgraph Legend");
    lines.push("    direction TB");
    for (const type of Object.keys(NODE_TYPE_LABELS)) {
      if (!typesPresent.has(type)) continue;
      const legendId = `legend_${mermaidId(type)}`;
      lines.push(`    ${wrapNodeShape(type as keyof typeof NODE_TYPE_LABELS, legendId, NODE_TYPE_LABELS[type as keyof typeof NODE_TYPE_LABELS])}:::${type}`);
    }
    lines.push("  end");
  }

  return `${lines.join("\n")}\n`;
}
