import type { EvidenceManifest } from "@rvs/core";
import type { RepositoryModel } from "@rvs/repository-model";
import { buildTerraformSceneSubgraphs, type TerraformTopology } from "@rvs/terraform-graph";
import type { Scene, TopologyScene, VisualDoc, WorkflowScene } from "@rvs/visualdoc-schema";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "@rvs/workflow-graph";
import { selectSceneSubgraph } from "@rvs/workflow-graph";
import type { NarrativeBrief } from "./brief.js";

interface ArchitectureNode {
  id: string;
  label: string;
}

// Mirrors validate-structure.ts's WORKFLOW_TOO_LARGE threshold: a workflow
// whose job-level node count exceeds this gets split into an overview scene
// plus grouped detail scenes rather than one overcrowded diagram (documented
// in docs/workflow-engine.md).
const LARGE_WORKFLOW_NODE_THRESHOLD = 25;

// Detail scenes stay small enough to read even inside a connected component
// larger than this: a component over the limit is chunked further, in
// deterministic sorted-id order, accepting that a chunk boundary may cut a
// "needs"/"calls" edge that crosses it (the full graph remains available via
// the overview scene and via `rvs create workflow --renderer both`).
const WORKFLOW_GROUP_SIZE = 10;

// Deterministic weakly-connected-components partition of the job-level graph
// (triggers/jobs/reusable-workflows/environments/approvals), so each detail
// scene groups nodes that are actually related by a real edge in the
// workflow YAML rather than an arbitrary alphabetical slice. Components are
// ordered by their smallest node id for reproducibility; oversized
// components are chunked by sorted id.
function groupWorkflowNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[][] {
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  for (const edge of edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }

  const componentsByRoot = new Map<string, WorkflowNode[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const list = componentsByRoot.get(root) ?? [];
    list.push(node);
    componentsByRoot.set(root, list);
  }
  const components = [...componentsByRoot.values()].map((list) =>
    list.slice().sort((a, b) => a.id.localeCompare(b.id)),
  );
  components.sort((a, b) => a[0].id.localeCompare(b[0].id));

  const groups: WorkflowNode[][] = [];
  for (const component of components) {
    if (component.length <= WORKFLOW_GROUP_SIZE) {
      groups.push(component);
      continue;
    }
    for (let i = 0; i < component.length; i += WORKFLOW_GROUP_SIZE) {
      groups.push(component.slice(i, i + WORKFLOW_GROUP_SIZE));
    }
  }
  return groups;
}

// Workflow scenes carry their own node/edge-level evidence inside the
// referenced WorkflowGraph (surfaced as `data-evidence` attributes on the
// rendered SVG, guarded by validate-structure.ts's WORKFLOW_MISSING_EVIDENCE
// check) rather than through the M1 evidence-manifest claim system, so
// `scene.evidence` is intentionally left empty here.
export function buildWorkflowScenes(graph: WorkflowGraph, nextId: () => string): WorkflowScene[] {
  const { nodes: jobNodes, edges: jobEdges } = selectSceneSubgraph(graph, "jobs");

  if (jobNodes.length <= LARGE_WORKFLOW_NODE_THRESHOLD) {
    return [
      {
        id: nextId(),
        type: "workflow",
        headline: `${graph.name} workflow`,
        graph_id: graph.id,
        detail_level: "jobs",
        direction: "top-to-bottom",
        highlight: [],
        annotations: [],
        evidence: [],
      },
    ];
  }

  const groups = groupWorkflowNodes(jobNodes, jobEdges);
  const scenes: WorkflowScene[] = [
    {
      id: nextId(),
      type: "workflow",
      headline: `${graph.name} workflow (overview)`,
      graph_id: graph.id,
      detail_level: "summary",
      direction: "top-to-bottom",
      highlight: [],
      annotations: [],
      evidence: [],
    },
  ];
  groups.forEach((group, index) => {
    scenes.push({
      id: nextId(),
      type: "workflow",
      headline: `${graph.name} workflow — detail ${index + 1}/${groups.length}`,
      graph_id: graph.id,
      detail_level: "jobs-and-key-steps",
      direction: "top-to-bottom",
      highlight: [],
      annotations: [],
      focus_nodes: group.map((n) => n.id),
      evidence: [],
    });
  });
  return scenes;
}

// Mirrors buildWorkflowScenes' detail-level default and single-vs-split
// behavior, but the split itself is computed once by
// @rvs/terraform-graph's buildTerraformSceneSubgraphs (module-boundary
// grouping) rather than re-derived here — each returned part only needs its
// index persisted onto the scene (see TopologySceneSchema's part_index).
const TOPOLOGY_DETAIL_LEVEL = "modules-and-key-resources" as const;

// Topology scenes carry their own node/edge-level evidence inside the
// referenced TerraformTopology (surfaced as `data-evidence` attributes on
// the rendered SVG) rather than through the M1 evidence-manifest claim
// system, so `scene.evidence` is intentionally left empty here — mirrors
// buildWorkflowScenes' identical rationale for workflow scenes.
export function buildTopologyScenes(topology: TerraformTopology, nextId: () => string): TopologyScene[] {
  const parts = buildTerraformSceneSubgraphs(topology, TOPOLOGY_DETAIL_LEVEL, []);

  if (parts.length === 1) {
    return [
      {
        id: nextId(),
        type: "topology",
        headline: `${topology.name} Terraform topology`,
        topology_id: topology.id,
        detail_level: TOPOLOGY_DETAIL_LEVEL,
        direction: "top-to-bottom",
        highlight: [],
        part_index: 0,
        evidence: [],
      },
    ];
  }

  return parts.map((part) => ({
    id: nextId(),
    type: "topology",
    headline: `${topology.name} Terraform topology — detail ${part.partIndex + 1}/${part.partCount}`,
    topology_id: topology.id,
    detail_level: TOPOLOGY_DETAIL_LEVEL,
    direction: "top-to-bottom",
    highlight: [],
    part_index: part.partIndex,
    evidence: [],
  }));
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Nodes come only from directly observed file-inventory groupings (or, as a
// fallback, detected languages) — never inferred dependency relationships —
// so no edges are drawn unless a future adapter supplies real evidence of
// them (see blueprint principle: never invent technical relationships).
function topLevelNodes(model: RepositoryModel, max = 6): ArchitectureNode[] {
  const counts = new Map<string, number>();
  for (const path of model.files.sampledPaths) {
    const segment = path.includes("/") ? path.split("/")[0] : path;
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  if (sorted.length >= 2) {
    return sorted.map(([segment, count], i) => ({ id: `dir-${i}`, label: `${segment} (${count})` }));
  }
  if (model.tech_stack.languages.length > 0) {
    return model.tech_stack.languages.slice(0, max).map((lang, i) => ({ id: `lang-${i}`, label: lang }));
  }
  return [{ id: "root", label: model.project_name }];
}

export function buildVisualDoc(
  model: RepositoryModel,
  evidence: EvidenceManifest,
  brief: NarrativeBrief,
  themeId: string,
  workflowGraphs: WorkflowGraph[] = [],
  terraformTopologies: TerraformTopology[] = [],
): VisualDoc {
  const scenes: Scene[] = [];
  let sceneCounter = 0;
  const nextId = () => `scene-${(sceneCounter += 1)}`;
  const bySectionId = new Map(brief.sections.map((s) => [s.id, s]));

  scenes.push({
    id: nextId(),
    type: "title",
    headline: brief.title,
    subheadline: truncate(brief.core_message, 160),
    evidence: [],
  });

  const context = bySectionId.get("context");
  if (context) {
    scenes.push({ id: nextId(), type: "section-divider", headline: "Context", index: 1, evidence: [] });
    scenes.push({
      id: nextId(),
      type: "headline",
      headline: "Why this project exists",
      body: [context.text].filter(Boolean),
      evidence: context.evidence_claim_ids,
    });
  }

  const architecture = bySectionId.get("architecture") ?? bySectionId.get("target_state");
  if (architecture) {
    scenes.push({ id: nextId(), type: "section-divider", headline: "Architecture", index: 2, evidence: [] });
    scenes.push({
      id: nextId(),
      type: "architecture",
      headline: "Technology and structure",
      nodes: topLevelNodes(model),
      edges: [],
      evidence: architecture.evidence_claim_ids,
    });
    const metricEvidence = evidence.claims
      .filter((c) => /^(repository contains|development activity)/i.test(c.claim))
      .map((c) => c.claim_id);
    scenes.push({
      id: nextId(),
      type: "metric",
      headline: "By the numbers",
      evidence: metricEvidence,
      metrics: [
        { label: "Files scanned", value: String(model.files.total) },
        { label: "Contributors (90d)", value: String(model.git.contributorCount) },
        { label: "Commits (90d)", value: String(model.git.commitsLast90Days) },
      ],
    });
  }

  if (workflowGraphs.length > 0) {
    scenes.push({ id: nextId(), type: "section-divider", headline: "Workflows", index: 2, evidence: [] });
    for (const graph of [...workflowGraphs].sort((a, b) => a.id.localeCompare(b.id))) {
      scenes.push(...buildWorkflowScenes(graph, nextId));
    }
  }

  if (terraformTopologies.length > 0) {
    scenes.push({ id: nextId(), type: "section-divider", headline: "Infrastructure", index: 2, evidence: [] });
    for (const topology of [...terraformTopologies].sort((a, b) => a.id.localeCompare(b.id))) {
      scenes.push(...buildTopologyScenes(topology, nextId));
    }
  }

  const status = bySectionId.get("status");
  if (status) {
    scenes.push({ id: nextId(), type: "section-divider", headline: "Status", index: 3, evidence: [] });
    scenes.push({
      id: nextId(),
      type: "headline",
      headline: "Current status",
      body: [status.text].filter(Boolean),
      evidence: status.evidence_claim_ids,
    });
  }

  const decision = bySectionId.get("decision");
  if (decision) {
    scenes.push({
      id: nextId(),
      type: "headline",
      headline: "Decision requested",
      body: [decision.text].filter(Boolean),
      evidence: [],
    });
  }

  return {
    version: 1,
    document: {
      type: "presentation",
      title: brief.title,
      aspect_ratio: "16:9",
      audience: brief.audience,
      theme: themeId,
    },
    scenes,
  };
}
