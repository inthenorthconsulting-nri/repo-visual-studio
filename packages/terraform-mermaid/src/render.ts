import type { ArchitectureEdge, ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformNodeType, TerraformSceneSubgraph, TerraformTopology } from "@rvs/terraform-graph";
import { escapeMermaidLabel, mermaidId } from "./escape.js";
import { NODE_TYPE_CLASS_DEFS, NODE_TYPE_LABELS, wrapNodeShape } from "./node-shapes.js";

export interface RenderTerraformMermaidOptions {
  direction?: "left-to-right" | "top-to-bottom";
  highlight?: string[];
}

const EDGE_LABELS: Partial<Record<ArchitectureEdge["type"], string>> = {
  "calls-module": "calls",
  "uses-provider": "uses",
  "reads-from": "reads",
  "produces-output": "produces",
  "passes-input": "input",
  exports: "exports",
  "unresolved-reference": "unresolved",
};

function evidenceComment(ref: { path: string; lines?: string }): string {
  return ref.lines ? `${ref.path}:${ref.lines}` : ref.path;
}

function isDynamicStatus(status: ArchitectureNode["status"]): boolean {
  return status === "dynamic" || status === "unresolved";
}

// Consumes an already-selected TerraformSceneSubgraph (see
// @rvs/terraform-graph's buildTerraformSceneSubgraphs — one call per
// rendered scene/slide) and produces valid Mermaid flowchart syntax. Never
// the reverse — Mermaid syntax never flows back into the topology model.
// Mirrors @rvs/workflow-mermaid's renderWorkflowMermaid shape (flat nodes +
// edges + class-based legend), deliberately not nesting modules as Mermaid
// subgraphs — containment is rendered as a de-emphasized structural edge
// instead, matching how workflow-mermaid renders job/step containment.
export function renderTerraformMermaid(topology: Pick<TerraformTopology, "name" | "rootModulePath">, subgraph: TerraformSceneSubgraph, options: RenderTerraformMermaidOptions = {}): string {
  const direction = options.direction === "left-to-right" ? "LR" : "TD";
  const highlight = new Set(options.highlight ?? []);

  const sortedNodes = [...subgraph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...subgraph.edges].sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);
  lines.push(`%% Terraform topology: ${topology.name} (${topology.rootModulePath || "."})`);
  lines.push(`%% Detail level: ${subgraph.detailLevel}, part ${subgraph.partIndex + 1} of ${subgraph.partCount}, ${subgraph.hiddenNodeCount} node(s) hidden at this detail level.`);
  lines.push("%% Generated deterministically from repository evidence. Do not hand-edit — re-run `rvs create topology`.");
  lines.push("");

  const typesPresent = new Set<string>();
  const dynamicIds = new Set<string>();

  for (const node of sortedNodes) {
    const type = node.type as TerraformNodeType;
    typesPresent.add(type);
    const id = mermaidId(node.id);
    const dynamic = isDynamicStatus(node.status);
    if (dynamic) dynamicIds.add(id);
    const labelSuffix = dynamic ? ` [${node.status}]` : "";
    const label = escapeMermaidLabel(node.label + labelSuffix);
    const evidenceRefs = node.evidence.map(evidenceComment).join(", ") || "no evidence";
    lines.push(`  %% node ${node.id} evidence=${evidenceRefs}`);
    lines.push(`  ${wrapNodeShape(type, id, label)}`);
  }

  lines.push("");

  for (const edge of sortedEdges) {
    const fromId = mermaidId(edge.source);
    const toId = mermaidId(edge.target);
    const isContains = edge.type === "contains";
    const isUnresolved = edge.type === "unresolved-reference";
    const dashed = isUnresolved || isDynamicStatus(edge.status);
    const evidenceRefs = edge.evidence.map(evidenceComment).join(", ") || "no evidence";
    lines.push(`  %% edge ${edge.id} evidence=${evidenceRefs}`);
    const arrow = isContains ? "---" : dashed ? "-.->" : "-->";
    const label = edge.label ?? EDGE_LABELS[edge.type];
    if (!isContains && label) {
      lines.push(`  ${fromId} ${arrow}|${escapeMermaidLabel(label)}| ${toId}`);
    } else {
      lines.push(`  ${fromId} ${arrow} ${toId}`);
    }
  }

  lines.push("");

  for (const type of Object.keys(NODE_TYPE_CLASS_DEFS)) {
    if (typesPresent.has(type)) {
      lines.push(`  classDef ${type} ${NODE_TYPE_CLASS_DEFS[type as TerraformNodeType]}`);
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
      lines.push(`    ${wrapNodeShape(type as TerraformNodeType, legendId, NODE_TYPE_LABELS[type as TerraformNodeType])}:::${type}`);
    }
    lines.push("  end");
  }

  return `${lines.join("\n")}\n`;
}
