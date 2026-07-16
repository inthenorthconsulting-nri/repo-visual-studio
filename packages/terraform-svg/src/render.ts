import type { ArchitectureEdge, ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformNodeType, TerraformSceneSubgraph, TerraformTopology } from "@rvs/terraform-graph";
import {
  DEFAULT_LAYOUT_OPTIONS,
  LayeredLayoutEngine,
  escapeSvgText,
  estimateLabelWidth,
  truncateLabelForWidth,
  type GraphLayoutResult,
  type LayoutEngine,
  type LayoutInputEdge,
  type LayoutInputNode,
  type NodeColors,
} from "@rvs/workflow-svg";
import { DEFAULT_NODE_COLORS, NODE_TYPE_HEIGHTS, NODE_TYPE_LABELS, renderNodeShape } from "./node-shapes.js";

export interface RenderTerraformSvgOptions {
  direction?: "left-to-right" | "top-to-bottom";
  highlight?: string[];
  // Callers with a live design-token instance (e.g. renderer-html) may
  // override the default per-type palette to better match the active
  // design system; this renderer itself has no dependency on tokens.js.
  colors?: Partial<Record<TerraformNodeType, NodeColors>>;
  layoutEngine?: LayoutEngine;
}

export interface RenderTerraformSvgResult {
  svg: string;
  layout: GraphLayoutResult;
}

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const LEGEND_SWATCH = 16;
const LEGEND_ROW_HEIGHT = 24;
const LEGEND_ITEM_GAP = 20;

const EDGE_LABELS: Partial<Record<ArchitectureEdge["type"], string>> = {
  "calls-module": "calls",
  "uses-provider": "uses",
  "reads-from": "reads",
  "produces-output": "produces",
  "passes-input": "input",
  exports: "exports",
  "unresolved-reference": "unresolved",
};

function evidenceAttr(refs: Array<{ path: string; lines?: string }>): string {
  return refs.map((ref) => (ref.lines ? `${ref.path}:${ref.lines}` : ref.path)).join(";");
}

function isDynamicStatus(status: ArchitectureNode["status"]): boolean {
  return status === "dynamic" || status === "unresolved";
}

function renderLegend(typesPresent: TerraformNodeType[], colors: Record<TerraformNodeType, NodeColors>, top: number, canvasWidth: number): { markup: string; height: number; width: number } {
  if (typesPresent.length <= 1) return { markup: "", height: 0, width: canvasWidth };

  const items = typesPresent.map((type) => ({
    type,
    label: NODE_TYPE_LABELS[type],
    width: LEGEND_SWATCH + 6 + NODE_TYPE_LABELS[type].length * 7.6 + LEGEND_ITEM_GAP,
  }));

  let x = 8;
  let y = top + 16;
  const rows: string[] = [];
  const margin = 8;
  for (const item of items) {
    if (x + item.width > canvasWidth - margin && x > margin) {
      x = 8;
      y += LEGEND_ROW_HEIGHT;
    }
    const palette = colors[item.type];
    rows.push(
      `<rect x="${x}" y="${y}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="3" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.5" />` +
        `<text x="${x + LEGEND_SWATCH + 6}" y="${y + LEGEND_SWATCH - 3}" font-family="${FONT_STACK}" font-size="14" fill="#334155">${escapeSvgText(item.label)}</text>`,
    );
    x += item.width;
  }
  const height = y + LEGEND_ROW_HEIGHT - top;
  return { markup: `<g class="tf-legend" data-testid="tf-legend">${rows.join("")}</g>`, height, width: canvasWidth };
}

// Consumes an already-selected TerraformSceneSubgraph (see
// @rvs/terraform-graph's buildTerraformSceneSubgraphs) and computes its own
// deterministic layout via @rvs/workflow-svg's LayeredLayoutEngine — the
// same layout engine Milestone 2 Slice 1 built, reused here rather than
// re-implemented (spec: no separate Terraform-only rendering architecture).
// This is NOT an SVG-from-Mermaid conversion; Mermaid and this renderer are
// two independent, replaceable views over the same TerraformTopology.
export function renderTerraformSvg(topology: Pick<TerraformTopology, "name" | "rootModulePath">, subgraph: TerraformSceneSubgraph, options: RenderTerraformSvgOptions = {}): RenderTerraformSvgResult {
  const direction = options.direction ?? "top-to-bottom";
  const highlight = new Set(options.highlight ?? []);
  const colors: Record<TerraformNodeType, NodeColors> = { ...DEFAULT_NODE_COLORS, ...options.colors };
  const engine = options.layoutEngine ?? new LayeredLayoutEngine();

  const sortedNodes = [...subgraph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...subgraph.edges].sort((a, b) => a.id.localeCompare(b.id));

  const layoutInputNodes: LayoutInputNode[] = sortedNodes.map((n) => ({
    id: n.id,
    width: estimateLabelWidth(n.label),
    height: NODE_TYPE_HEIGHTS[n.type as TerraformNodeType],
  }));
  const layoutInputEdges: LayoutInputEdge[] = sortedEdges.map((e) => ({ id: e.id, from: e.source, to: e.target }));

  const layout = engine.layout(layoutInputNodes, layoutInputEdges, { ...DEFAULT_LAYOUT_OPTIONS, direction });

  const positionedNodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const positionedEdgeById = new Map(layout.edges.map((e) => [e.id, e]));
  const typesPresent = [...new Set(sortedNodes.map((n) => n.type as TerraformNodeType))].sort();

  const body: string[] = [];

  body.push(
    `<defs><marker id="rvs-tf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#475569" /></marker></defs>`,
  );

  for (const edge of sortedEdges) {
    const positioned = positionedEdgeById.get(edge.id);
    if (!positioned || positioned.points.length < 2) continue;
    const start = positioned.points[0];
    const end = positioned.points[positioned.points.length - 1];
    const isContains = edge.type === "contains";
    const isUnresolved = edge.type === "unresolved-reference";
    const dashed = isUnresolved || isDynamicStatus(edge.status);
    const dashAttr = dashed ? ' stroke-dasharray="6 4"' : "";
    const evidence = evidenceAttr(edge.evidence);
    // Containment edges are structural, not directional data flow — drawn
    // thin, muted, and without an arrowhead, mirroring how
    // @rvs/terraform-mermaid renders `contains` as an undirected `---` link.
    const stroke = isContains ? "#cbd5e1" : "#475569";
    const strokeWidth = isContains ? 1 : 1.5;
    const markerAttr = isContains ? "" : ' marker-end="url(#rvs-tf-arrow)"';

    body.push(`<g class="tf-edge tf-edge-${edge.type}" data-edge-id="${escapeSvgText(edge.id)}" data-evidence="${escapeSvgText(evidence)}" data-status="${edge.status ?? ""}">`);
    body.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${markerAttr} />`);
    const label = !isContains ? (edge.label ?? EDGE_LABELS[edge.type]) : undefined;
    if (label) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const escapedLabel = escapeSvgText(label);
      const boxWidth = escapedLabel.length * 7.9 + 10;
      body.push(`<rect x="${midX - boxWidth / 2}" y="${midY - 11}" width="${boxWidth}" height="20" fill="#ffffff" opacity="0.9" />`);
      body.push(`<text x="${midX}" y="${midY + 4}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" fill="#334155">${escapedLabel}</text>`);
    }
    body.push(`</g>`);
  }

  for (const node of sortedNodes) {
    const pos = positionedNodeById.get(node.id);
    if (!pos) continue;
    const type = node.type as TerraformNodeType;
    const palette = colors[type];
    const isDynamic = isDynamicStatus(node.status);
    const isHighlighted = highlight.has(node.id);
    const shape = renderNodeShape(type, pos.x, pos.y, pos.width, pos.height, {
      fill: palette.fill,
      stroke: isHighlighted ? "#f97316" : palette.stroke,
      dashed: isDynamic,
      strokeWidth: isHighlighted ? 3.5 : 1.5,
    });

    const rawLabel = isDynamic ? `${node.label} [${node.status}]` : node.label;
    const displayLabel = escapeSvgText(truncateLabelForWidth(rawLabel, pos.width));
    const fullLabel = escapeSvgText(rawLabel);
    const evidence = evidenceAttr(node.evidence);
    const textY = pos.y + pos.height / 2 + 4;
    const textX = pos.x + pos.width / 2;

    body.push(
      `<g class="tf-node tf-node-${type}" data-node-id="${escapeSvgText(node.id)}" data-node-type="${type}" data-status="${node.status ?? ""}" data-evidence="${escapeSvgText(evidence)}" data-full-label="${fullLabel}">`,
    );
    body.push(`<title>${fullLabel}</title>`);
    body.push(shape);
    body.push(`<text x="${textX}" y="${textY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" fill="${palette.text}">${displayLabel}</text>`);
    body.push(`</g>`);
  }

  const legend = renderLegend(typesPresent, colors, layout.height, layout.width);
  const totalWidth = Math.max(layout.width, legend.width);
  const totalHeight = layout.height + legend.height;

  const title = `${topology.name} Terraform topology diagram`;
  const desc = `Native SVG rendering of the ${topology.name} Terraform topology (${topology.rootModulePath || "."}), detail level "${subgraph.detailLevel}", part ${subgraph.partIndex + 1} of ${subgraph.partCount}, ${sortedNodes.length} nodes and ${sortedEdges.length} edges, ${subgraph.hiddenNodeCount} node(s) hidden at this detail level.`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="${escapeSvgText(title)}" font-family="${FONT_STACK}">`,
    `<title>${escapeSvgText(title)}</title>`,
    `<desc>${escapeSvgText(desc)}</desc>`,
    `<rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff" />`,
    ...body,
    legend.markup,
    `</svg>`,
  ].join("\n");

  return { svg, layout };
}
