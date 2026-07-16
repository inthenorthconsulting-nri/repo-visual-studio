import type { WorkflowDetailLevel, WorkflowGraph, WorkflowNode, WorkflowWarning } from "@rvs/workflow-graph";
import type { GraphLayoutResult } from "@rvs/workflow-svg";
import { truncateLabelForWidth } from "@rvs/workflow-svg";

// Pure, deterministic checks over already-computed workflow artifacts (a
// WorkflowGraph, a layout result, rendered Mermaid/SVG strings). No I/O, no
// Playwright/DOM — unlike checks.ts, these never need a browser, so they can
// run directly against `rvs create workflow` output during `rvs validate`.

export function checkWorkflowStepDetailCollapsed(graph: WorkflowGraph, detailLevel: WorkflowDetailLevel): WorkflowWarning[] {
  if (detailLevel === "full") return [];
  const stepCount = graph.nodes.filter((n) => n.type === "step").length;
  if (stepCount === 0) return [];
  return [
    {
      code: "WORKFLOW_STEP_DETAIL_COLLAPSED",
      severity: "warning",
      message: `${stepCount} step node(s) are hidden at detail level "${detailLevel}"; use "full" to inspect step-level evidence.`,
      sourcePath: graph.sourcePath,
      remediation: 'Render with detail_level "full" (or "jobs-and-key-steps") if step-level detail is required for this audience.',
    },
  ];
}

export function checkWorkflowLayoutOverlap(layout: GraphLayoutResult, sourcePath: string): WorkflowWarning[] {
  const warnings: WorkflowWarning[] = [];
  const nodes = layout.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      if (overlapsX && overlapsY) {
        warnings.push({
          code: "WORKFLOW_LAYOUT_OVERLAP",
          severity: "error",
          message: `Nodes "${a.id}" and "${b.id}" overlap in the computed layout.`,
          sourcePath,
        });
      }
    }
  }
  return warnings;
}

export function checkWorkflowLayoutTextOverflow(nodes: WorkflowNode[], layout: GraphLayoutResult): WorkflowWarning[] {
  const warnings: WorkflowWarning[] = [];
  const positionedById = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const pos = positionedById.get(node.id);
    if (!pos) continue;
    const flattened = node.label.replace(/\r?\n/g, " ").trim();
    const displayed = truncateLabelForWidth(flattened, pos.width);
    if (displayed !== flattened) {
      warnings.push({
        code: "WORKFLOW_LAYOUT_TEXT_OVERFLOW",
        severity: "warning",
        message: `Label for node "${node.id}" is truncated in the rendered diagram ("${flattened}" -> "${displayed}").`,
        sourcePath: node.evidence[0]?.path ?? "",
        evidence: node.evidence[0],
      });
    }
  }
  return warnings;
}

interface ExtractedIds {
  nodes: Set<string>;
  edges: Set<string>;
}

function extractMermaidIds(mermaid: string): ExtractedIds {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const line of mermaid.split("\n")) {
    const nodeMatch = line.match(/^\s*%% node (\S+) evidence=/);
    if (nodeMatch) nodes.add(nodeMatch[1]);
    const edgeMatch = line.match(/^\s*%% edge (\S+) evidence=/);
    if (edgeMatch) edges.add(edgeMatch[1]);
  }
  return { nodes, edges };
}

// data-node-id/data-edge-id attribute values are XML-attribute-escaped by
// the SVG renderer (WorkflowGraph ids frequently contain a literal ">",
// e.g. "edge:a->b:needs", which XML requires escaping to "&gt;" inside a
// quoted attribute). Undo that before comparing against Mermaid's unescaped
// comment-embedded ids.
function unescapeXmlAttr(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractSvgIds(svg: string): ExtractedIds {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const m of svg.matchAll(/data-node-id="([^"]+)"/g)) nodes.add(unescapeXmlAttr(m[1]));
  for (const m of svg.matchAll(/data-edge-id="([^"]+)"/g)) edges.add(unescapeXmlAttr(m[1]));
  return { nodes, edges };
}

// Guards the "Mermaid and SVG cover the same nodes/edges" acceptance
// criterion at the rendered-output level, not just at the shared
// selectSceneSubgraph call site — so it still catches a future regression
// where one renderer's filtering drifts from the other's.
export function checkWorkflowRendererDivergence(mermaid: string, svg: string, sourcePath: string): WorkflowWarning[] {
  const m = extractMermaidIds(mermaid);
  const s = extractSvgIds(svg);

  const mermaidOnlyNodes = [...m.nodes].filter((id) => !s.nodes.has(id)).sort();
  const svgOnlyNodes = [...s.nodes].filter((id) => !m.nodes.has(id)).sort();
  const mermaidOnlyEdges = [...m.edges].filter((id) => !s.edges.has(id)).sort();
  const svgOnlyEdges = [...s.edges].filter((id) => !m.edges.has(id)).sort();

  if (!mermaidOnlyNodes.length && !svgOnlyNodes.length && !mermaidOnlyEdges.length && !svgOnlyEdges.length) {
    return [];
  }

  return [
    {
      code: "WORKFLOW_RENDERER_DIVERGENCE",
      severity: "error",
      message: `Mermaid and SVG renderers disagree on node/edge coverage (mermaid-only nodes: [${mermaidOnlyNodes.join(", ")}], svg-only nodes: [${svgOnlyNodes.join(", ")}], mermaid-only edges: [${mermaidOnlyEdges.join(", ")}], svg-only edges: [${svgOnlyEdges.join(", ")}]).`,
      sourcePath,
      remediation: "Both renderers must derive their node/edge set from the same selectSceneSubgraph call; check for divergent detail_level or focus_nodes handling.",
    },
  ];
}

export interface WorkflowCheckInputs {
  graph: WorkflowGraph;
  detailLevel: WorkflowDetailLevel;
  selectedNodes: WorkflowNode[];
  layout: GraphLayoutResult;
  mermaid?: string;
  svg?: string;
}

export function runWorkflowChecks(input: WorkflowCheckInputs): WorkflowWarning[] {
  const warnings: WorkflowWarning[] = [
    ...checkWorkflowStepDetailCollapsed(input.graph, input.detailLevel),
    ...checkWorkflowLayoutOverlap(input.layout, input.graph.sourcePath),
    ...checkWorkflowLayoutTextOverflow(input.selectedNodes, input.layout),
  ];
  if (input.mermaid !== undefined && input.svg !== undefined) {
    warnings.push(...checkWorkflowRendererDivergence(input.mermaid, input.svg, input.graph.sourcePath));
  }
  return warnings;
}
