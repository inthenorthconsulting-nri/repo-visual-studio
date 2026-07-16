import type { ArchitectureEdge, ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformDetailLevel, TerraformTopology, TerraformTopologyWarning } from "./types.js";

export interface TerraformSceneSubgraph {
  detailLevel: TerraformDetailLevel;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  hiddenNodeCount: number;
  partIndex: number;
  partCount: number;
}

const MAX_VISIBLE_NODES = 25;
const MODULE_TYPES = new Set(["root-module", "child-module", "external-module"]);
const RESOURCE_TYPES = new Set(["resource", "data-source"]);

function degree(nodeId: string, edges: ArchitectureEdge[]): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.type === "contains") continue;
    if (edge.source === nodeId || edge.target === nodeId) count++;
  }
  return count;
}

// Spec section 9's four detail levels, applied to the full node set of one
// topology. "modules-and-key-resources" (the default) shows only resources
// that participate in at least one non-containment relationship, so a
// scene isn't cluttered with isolated leaf resources that carry no
// architectural signal.
export function selectDetailLevelNodes(topology: TerraformTopology, detailLevel: TerraformDetailLevel): ArchitectureNode[] {
  if (detailLevel === "full") return topology.nodes;
  if (detailLevel === "modules") return topology.nodes.filter((n) => MODULE_TYPES.has(n.type));
  if (detailLevel === "modules-and-resources") return topology.nodes.filter((n) => MODULE_TYPES.has(n.type) || RESOURCE_TYPES.has(n.type));
  return topology.nodes.filter((n) => {
    if (MODULE_TYPES.has(n.type)) return true;
    if (!RESOURCE_TYPES.has(n.type)) return false;
    return degree(n.id, topology.edges) > 0;
  });
}

function inducedEdges(nodes: ArchitectureNode[], allEdges: ArchitectureEdge[]): ArchitectureEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return allEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

// Groups visible nodes by their nearest containing module (walking
// `contains` edges) so a too-large scene splits along module boundaries —
// deterministic, and never cuts a module's resources across two scenes.
function groupByModule(nodes: ArchitectureNode[], allEdges: ArchitectureEdge[]): ArchitectureNode[][] {
  const containerOf = new Map<string, string>();
  for (const edge of allEdges) {
    if (edge.type === "contains") containerOf.set(edge.target, edge.source);
  }
  const moduleNodes = nodes.filter((n) => MODULE_TYPES.has(n.type));
  const byModule = new Map<string, ArchitectureNode[]>();
  for (const m of moduleNodes) byModule.set(m.id, [m]);
  const fallbackBucket: ArchitectureNode[] = [];
  for (const node of nodes) {
    if (MODULE_TYPES.has(node.type)) continue;
    let owner = containerOf.get(node.id);
    while (owner && !byModule.has(owner)) owner = containerOf.get(owner);
    const bucket = owner ? byModule.get(owner) : undefined;
    if (bucket) bucket.push(node);
    else fallbackBucket.push(node);
  }
  const groups = [...byModule.values()].filter((g) => g.length > 0);
  if (fallbackBucket.length > 0) groups.push(fallbackBucket);
  return groups;
}

// Selects the visible subgraph for one topology scene at a given detail
// level, deterministically splitting into multiple scenes (spec section 9:
// ">25 visible nodes triggers deterministic splitting") along module
// boundaries when necessary. Pushes a TERRAFORM_COMPONENT_SPLIT warning
// onto `warnings` when a split occurs.
export function buildTerraformSceneSubgraphs(topology: TerraformTopology, detailLevel: TerraformDetailLevel, warnings: TerraformTopologyWarning[]): TerraformSceneSubgraph[] {
  const selected = selectDetailLevelNodes(topology, detailLevel);
  const hiddenNodeCount = topology.nodes.length - selected.length;

  if (selected.length <= MAX_VISIBLE_NODES) {
    return [{ detailLevel, nodes: selected, edges: inducedEdges(selected, topology.edges), hiddenNodeCount, partIndex: 0, partCount: 1 }];
  }

  const groups = groupByModule(selected, topology.edges);
  const parts: ArchitectureNode[][] = [];
  let current: ArchitectureNode[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > MAX_VISIBLE_NODES) {
      parts.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) parts.push(current);

  warnings.push({
    code: "TERRAFORM_COMPONENT_SPLIT",
    severity: "informational",
    message: `Topology scene at detail level "${detailLevel}" has ${selected.length} visible nodes (limit ${MAX_VISIBLE_NODES}); split into ${parts.length} scenes along module boundaries.`,
    sourcePath: topology.rootModulePath,
  });

  return parts.map((nodes, index) => ({
    detailLevel,
    nodes,
    edges: inducedEdges(nodes, topology.edges),
    hiddenNodeCount,
    partIndex: index,
    partCount: parts.length,
  }));
}
