import { humanizeDisplayLabel, selectSceneSubgraph, type WorkflowDetailLevel, type WorkflowGraph, type WorkflowNodeType } from "@rvs/workflow-graph";
import { escapeSvgText } from "./escape.js";
import {
  DEFAULT_LAYOUT_OPTIONS,
  LayeredLayoutEngine,
  type GraphLayoutResult,
  type LayoutEngine,
  type LayoutInputEdge,
  type LayoutInputNode,
} from "./layout.js";
import { estimateLabelWidth, truncateLabelForWidth } from "./measure-text.js";
import { DEFAULT_NODE_COLORS, NODE_TYPE_HEIGHTS, NODE_TYPE_LABELS, renderNodeShape, type NodeColors } from "./node-shapes.js";

export interface RenderSvgOptions {
  detailLevel?: WorkflowDetailLevel;
  direction?: "left-to-right" | "top-to-bottom";
  focusNodeIds?: string[];
  highlight?: string[];
  // Callers with a live design-token instance (e.g. renderer-html) may
  // override the default per-type palette to better match the active
  // design system; the SVG renderer itself has no dependency on tokens.js.
  colors?: Partial<Record<WorkflowNodeType, NodeColors>>;
  layoutEngine?: LayoutEngine;
}

export interface RenderSvgResult {
  svg: string;
  layout: GraphLayoutResult;
}

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const LEGEND_SWATCH = 16;
const LEGEND_ROW_HEIGHT = 24;
const LEGEND_ITEM_GAP = 20;

function evidenceAttr(refs: Array<{ path: string; lines?: string }>): string {
  return refs.map((ref) => (ref.lines ? `${ref.path}:${ref.lines}` : ref.path)).join(";");
}

function renderLegend(typesPresent: WorkflowNodeType[], colors: Record<WorkflowNodeType, NodeColors>, top: number, canvasWidth: number): { markup: string; height: number; width: number } {
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
  return { markup: `<g class="wf-legend" data-testid="wf-legend">${rows.join("")}</g>`, height, width: canvasWidth };
}

// Consumes a WorkflowGraph directly (via the shared, renderer-neutral
// selectSceneSubgraph) and computes its own deterministic layout — this is
// NOT a Mermaid-to-SVG conversion. Mermaid and this renderer are two
// independent, replaceable views over the same graph model.
export function renderWorkflowSvg(graph: WorkflowGraph, options: RenderSvgOptions = {}): RenderSvgResult {
  const detailLevel = options.detailLevel ?? "jobs";
  const direction = options.direction ?? "top-to-bottom";
  const highlight = new Set(options.highlight ?? []);
  const colors: Record<WorkflowNodeType, NodeColors> = { ...DEFAULT_NODE_COLORS, ...options.colors };
  const engine = options.layoutEngine ?? new LayeredLayoutEngine();

  const { nodes, edges } = selectSceneSubgraph(graph, detailLevel, options.focusNodeIds);
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));

  const layoutInputNodes: LayoutInputNode[] = sortedNodes.map((n) => ({
    id: n.id,
    width: estimateLabelWidth(humanizeDisplayLabel(n.label)),
    height: NODE_TYPE_HEIGHTS[n.type],
  }));
  const layoutInputEdges: LayoutInputEdge[] = sortedEdges.map((e) => ({ id: e.id, from: e.from, to: e.to }));

  const layout = engine.layout(layoutInputNodes, layoutInputEdges, { ...DEFAULT_LAYOUT_OPTIONS, direction });

  const positionedNodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const positionedEdgeById = new Map(layout.edges.map((e) => [e.id, e]));
  const typesPresent = [...new Set(sortedNodes.map((n) => n.type))].sort();

  const body: string[] = [];

  body.push(
    `<defs><marker id="rvs-wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#475569" /></marker></defs>`,
  );

  for (const edge of sortedEdges) {
    const positioned = positionedEdgeById.get(edge.id);
    if (!positioned || positioned.points.length < 2) continue;
    const start = positioned.points[0];
    const end = positioned.points[positioned.points.length - 1];
    const isDynamic = edge.confidence === "dynamic" || edge.confidence === "unsupported";
    const dashed = edge.type === "conditional" || isDynamic;
    const dashAttr = dashed ? ' stroke-dasharray="6 4"' : "";
    const evidence = evidenceAttr(edge.evidence);

    body.push(`<g class="wf-edge wf-edge-${edge.type}" data-edge-id="${escapeSvgText(edge.id)}" data-evidence="${escapeSvgText(evidence)}" data-confidence="${edge.confidence}">`);
    body.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#475569" stroke-width="1.5"${dashAttr} marker-end="url(#rvs-wf-arrow)" />`);
    if (edge.label) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const label = escapeSvgText(edge.label);
      const boxWidth = label.length * 7.9 + 10;
      body.push(`<rect x="${midX - boxWidth / 2}" y="${midY - 11}" width="${boxWidth}" height="20" fill="#ffffff" opacity="0.9" />`);
      body.push(`<text x="${midX}" y="${midY + 4}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" fill="#334155">${label}</text>`);
    }
    body.push(`</g>`);
  }

  for (const node of sortedNodes) {
    const pos = positionedNodeById.get(node.id);
    if (!pos) continue;
    const palette = colors[node.type];
    const isDynamic = node.confidence === "dynamic" || node.confidence === "unsupported";
    const isHighlighted = highlight.has(node.id);
    const shape = renderNodeShape(node.type, pos.x, pos.y, pos.width, pos.height, {
      fill: palette.fill,
      stroke: isHighlighted ? "#f97316" : palette.stroke,
      dashed: isDynamic,
      strokeWidth: isHighlighted ? 3.5 : 1.5,
    });

    const humanizedLabel = humanizeDisplayLabel(node.label);
    const visibleLabel = isDynamic ? `${humanizedLabel} [${node.confidence}]` : humanizedLabel;
    const displayLabel = escapeSvgText(truncateLabelForWidth(visibleLabel, pos.width));
    // The <title>/data-full-label tooltip always carries the raw source label
    // (plus confidence) so the original trigger name/expression is never lost
    // to humanization or truncation — only the on-canvas text is simplified.
    const sourceLabel = isDynamic ? `${node.label} [${node.confidence}]` : node.label;
    const fullLabel = escapeSvgText(node.label === humanizedLabel ? sourceLabel : `${sourceLabel} (${humanizedLabel})`);
    const evidence = evidenceAttr(node.evidence);
    const textY = pos.y + pos.height / 2 + 4;
    const textX = pos.x + pos.width / 2;

    body.push(
      `<g class="wf-node wf-node-${node.type}" data-node-id="${escapeSvgText(node.id)}" data-node-type="${node.type}" data-confidence="${node.confidence}" data-evidence="${escapeSvgText(evidence)}" data-full-label="${fullLabel}">`,
    );
    body.push(`<title>${fullLabel}</title>`);
    body.push(shape);
    body.push(`<text x="${textX}" y="${textY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" fill="${palette.text}">${displayLabel}</text>`);
    body.push(`</g>`);
  }

  const legend = renderLegend(typesPresent, colors, layout.height, layout.width);
  const totalWidth = Math.max(layout.width, legend.width);
  const totalHeight = layout.height + legend.height;

  const title = `${graph.name} workflow diagram`;
  const desc = `Native SVG rendering of the ${graph.name} GitHub Actions workflow graph (${graph.sourcePath}), detail level "${detailLevel}", ${sortedNodes.length} nodes and ${sortedEdges.length} edges.`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="${escapeSvgText(title)}" font-family="${FONT_STACK}">`,
    `<title>${escapeSvgText(title)}</title>`,
    `<desc>${escapeSvgText(desc)}</desc>`,
    // No opaque background rect here on purpose: this SVG is embedded inside
    // a slide whose own background may be light or dark, and an opaque white
    // canvas behind it reads as a mismatched "white box" on dark themes. Node
    // shapes and their own fills/strokes already provide sufficient contrast.
    ...body,
    legend.markup,
    `</svg>`,
  ].join("\n");

  return { svg, layout };
}
