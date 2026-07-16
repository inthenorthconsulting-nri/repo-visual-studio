import type { ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformTopology, TerraformTopologyWarning } from "@rvs/terraform-graph";
import type { GraphLayoutResult } from "@rvs/workflow-svg";
import { truncateLabelForWidth } from "@rvs/workflow-svg";

// Pure, deterministic checks over already-computed Terraform artifacts (a
// TerraformTopology, a layout result, rendered Mermaid/SVG strings). No I/O,
// no Playwright/DOM. Sibling to workflow-checks.ts: same shape, same
// severities, run inline from `rvs create topology` the same way
// runWorkflowChecks is run inline from `rvs create workflow`. Structural
// graph-shape checks (duplicate ids, dangling edges, address collisions,
// sensitive-value redaction) already live in
// @rvs/terraform-graph's validate-structure.ts; this file only covers
// checks that need a computed layout or rendered output text, plus the
// evidence-coverage check, which for Terraform lives here rather than in
// validate-structure.ts to keep all "did the rendered artifacts turn out
// right" checks in one place alongside the divergence check they share a
// call site with.

export function checkTerraformMissingEvidence(topology: TerraformTopology): TerraformTopologyWarning[] {
  const warnings: TerraformTopologyWarning[] = [];
  for (const node of topology.nodes) {
    if (node.evidence.length === 0) {
      warnings.push({
        code: "TERRAFORM_MISSING_EVIDENCE",
        severity: "error",
        message: `Node "${node.id}" (${node.type}) has no evidence reference.`,
        sourcePath: topology.rootModulePath,
        relatedId: node.id,
        remediation: "Every node must carry at least one repository-relative evidence source.",
      });
    }
  }
  for (const edge of topology.edges) {
    if (edge.evidence.length === 0) {
      warnings.push({
        code: "TERRAFORM_MISSING_EVIDENCE",
        severity: "error",
        message: `Edge "${edge.id}" has no evidence reference.`,
        sourcePath: topology.rootModulePath,
        relatedId: edge.id,
      });
    }
  }
  return warnings;
}

export function checkTerraformLayoutOverlap(layout: GraphLayoutResult, sourcePath: string): TerraformTopologyWarning[] {
  const warnings: TerraformTopologyWarning[] = [];
  const nodes = layout.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      if (overlapsX && overlapsY) {
        warnings.push({
          code: "TERRAFORM_LAYOUT_OVERLAP",
          severity: "error",
          message: `Nodes "${a.id}" and "${b.id}" overlap in the computed layout.`,
          sourcePath,
        });
      }
    }
  }
  return warnings;
}

function isDynamicStatus(status: ArchitectureNode["status"]): boolean {
  return status === "dynamic" || status === "unresolved";
}

// @rvs/terraform-svg suffixes dynamic/unresolved node labels with " [status]"
// before truncating (see renderTerraformSvg's rawLabel), so this must
// replicate that suffix to compare against the same displayed text the SVG
// renderer actually produced.
export function checkTerraformLayoutTextOverflow(nodes: ArchitectureNode[], layout: GraphLayoutResult): TerraformTopologyWarning[] {
  const warnings: TerraformTopologyWarning[] = [];
  const positionedById = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const pos = positionedById.get(node.id);
    if (!pos) continue;
    const rawLabel = isDynamicStatus(node.status) ? `${node.label} [${node.status}]` : node.label;
    const flattened = rawLabel.replace(/\r?\n/g, " ").trim();
    const displayed = truncateLabelForWidth(flattened, pos.width);
    if (displayed !== flattened) {
      warnings.push({
        code: "TERRAFORM_LAYOUT_TEXT_OVERFLOW",
        severity: "warning",
        message: `Label for node "${node.id}" is truncated in the rendered diagram ("${flattened}" -> "${displayed}").`,
        sourcePath: node.evidence[0]?.path ?? "",
        relatedId: node.id,
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
// the SVG renderer, same as workflow-checks.ts's equivalent; undo that
// before comparing against Mermaid's unescaped comment-embedded ids.
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
// criterion at the rendered-output level, exactly mirroring
// checkWorkflowRendererDivergence — both renderers derive their node/edge
// set from the same buildTerraformSceneSubgraphs call, so any drift here is
// a real renderer bug, not an expected difference.
export function checkTerraformRendererDivergence(mermaid: string, svg: string, sourcePath: string): TerraformTopologyWarning[] {
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
      code: "TERRAFORM_RENDERER_DIVERGENCE",
      severity: "error",
      message: `Mermaid and SVG renderers disagree on node/edge coverage (mermaid-only nodes: [${mermaidOnlyNodes.join(", ")}], svg-only nodes: [${svgOnlyNodes.join(", ")}], mermaid-only edges: [${mermaidOnlyEdges.join(", ")}], svg-only edges: [${svgOnlyEdges.join(", ")}]).`,
      sourcePath,
      remediation: "Both renderers must derive their node/edge set from the same buildTerraformSceneSubgraphs call; check for divergent detail_level handling.",
    },
  ];
}

export interface TerraformCheckInputs {
  topology: TerraformTopology;
  selectedNodes: ArchitectureNode[];
  layout: GraphLayoutResult;
  mermaid?: string;
  svg?: string;
}

export function runTerraformChecks(input: TerraformCheckInputs): TerraformTopologyWarning[] {
  const warnings: TerraformTopologyWarning[] = [
    ...checkTerraformMissingEvidence(input.topology),
    ...checkTerraformLayoutOverlap(input.layout, input.topology.rootModulePath),
    ...checkTerraformLayoutTextOverflow(input.selectedNodes, input.layout),
  ];
  if (input.mermaid !== undefined && input.svg !== undefined) {
    warnings.push(...checkTerraformRendererDivergence(input.mermaid, input.svg, input.topology.rootModulePath));
  }
  return warnings;
}
