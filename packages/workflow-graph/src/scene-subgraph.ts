import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "./types.js";

// Mirrors visualdoc-schema's WorkflowDetailLevelSchema values. Kept as a
// plain string union (not imported from @rvs/visualdoc-schema) so this
// foundational package stays dependency-free of the scene layer above it.
export type WorkflowDetailLevel = "summary" | "jobs" | "jobs-and-key-steps" | "full";

export interface SceneSubgraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const JOB_LEVEL_NODE_TYPES = new Set(["trigger", "job", "reusable-workflow", "environment", "approval"]);
const JOB_LEVEL_EDGE_TYPES = new Set(["starts", "needs", "conditional", "calls", "deploys-to"]);

// Deterministic detail-level rules (documented in docs/workflow-engine.md):
//   summary / jobs  -> triggers + jobs + reusable-workflow/environment/approval
//                      nodes only; no steps, no artifacts.
//   jobs-and-key-steps -> the above, plus each job's "key" steps: any step
//                      that produces/consumes an artifact, plus each job's
//                      first and last step (so the shape of the job is
//                      still visible without rendering every command).
//   full            -> the entire graph, unfiltered.
// Shared by both the Mermaid and native SVG renderers so their node/edge
// sets are always identical for the same (graph, detail_level, focus_nodes).
export function selectSceneSubgraph(
  graph: WorkflowGraph,
  detailLevel: WorkflowDetailLevel,
  focusNodeIds?: string[],
): SceneSubgraph {
  let nodes: WorkflowNode[];
  let edges: WorkflowEdge[];

  if (detailLevel === "full") {
    nodes = graph.nodes;
    edges = graph.edges;
  } else if (detailLevel === "jobs-and-key-steps") {
    const jobLevelIds = new Set(graph.nodes.filter((n) => JOB_LEVEL_NODE_TYPES.has(n.type)).map((n) => n.id));

    const artifactAdjacentStepIds = new Set(
      graph.edges.filter((e) => e.type === "produces" || e.type === "consumes").flatMap((e) => [e.from, e.to]),
    );

    const stepsByJob = new Map<string, WorkflowNode[]>();
    for (const edge of graph.edges) {
      if (edge.type !== "contains") continue;
      const stepNode = graph.nodes.find((n) => n.id === edge.to);
      if (!stepNode) continue;
      const list = stepsByJob.get(edge.from) ?? [];
      list.push(stepNode);
      stepsByJob.set(edge.from, list);
    }

    const keyStepIds = new Set<string>();
    for (const steps of stepsByJob.values()) {
      steps.forEach((step, index) => {
        if (artifactAdjacentStepIds.has(step.id) || index === 0 || index === steps.length - 1) {
          keyStepIds.add(step.id);
        }
      });
    }

    const keyArtifactIds = new Set(
      graph.edges
        .filter((e) => (e.type === "produces" || e.type === "consumes") && (keyStepIds.has(e.from) || keyStepIds.has(e.to)))
        .flatMap((e) => [e.from, e.to])
        .filter((id) => graph.nodes.find((n) => n.id === id)?.type === "artifact"),
    );

    const visibleIds = new Set<string>([...jobLevelIds, ...keyStepIds, ...keyArtifactIds]);
    nodes = graph.nodes.filter((n) => visibleIds.has(n.id));
    edges = graph.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  } else {
    // summary / jobs
    nodes = graph.nodes.filter((n) => JOB_LEVEL_NODE_TYPES.has(n.type));
    const visibleIds = new Set(nodes.map((n) => n.id));
    edges = graph.edges.filter((e) => JOB_LEVEL_EDGE_TYPES.has(e.type) && visibleIds.has(e.from) && visibleIds.has(e.to));
  }

  if (focusNodeIds && focusNodeIds.length > 0) {
    const focusSet = new Set(focusNodeIds);
    nodes = nodes.filter((n) => focusSet.has(n.id));
    const visibleIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  }

  return { nodes, edges };
}
