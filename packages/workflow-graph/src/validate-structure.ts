import type { WorkflowGraph, WorkflowWarning } from "./types.js";

// Pure, deterministic structural + evidence checks over an already-built
// WorkflowGraph. No I/O, no Playwright — safe to run against hand-built
// graphs in unit tests as well as parser output.
export function validateGraphStructure(graph: WorkflowGraph): WorkflowWarning[] {
  const issues: WorkflowWarning[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: "WORKFLOW_DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node id "${node.id}".`,
        sourcePath: graph.sourcePath,
      });
    }
    nodeIds.add(node.id);
    if (node.type === "job" && node.metadata?.matrix) {
      issues.push({
        code: "WORKFLOW_MATRIX_COLLAPSED",
        severity: "warning",
        message: `Job "${node.id}" uses a matrix strategy; the diagram shows one representative node rather than each expanded matrix combination.`,
        sourcePath: graph.sourcePath,
        evidence: node.evidence[0],
      });
    }
    if (node.evidence.length === 0) {
      issues.push({
        code: "WORKFLOW_MISSING_EVIDENCE",
        severity: "error",
        message: `Node "${node.id}" (${node.type}) has no evidence reference.`,
        sourcePath: graph.sourcePath,
        remediation: "Every node must carry at least one repository-relative evidence source.",
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "WORKFLOW_DUPLICATE_EDGE_ID",
        severity: "error",
        message: `Duplicate edge id "${edge.id}".`,
        sourcePath: graph.sourcePath,
      });
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({
        code: "WORKFLOW_DANGLING_EDGE",
        severity: "error",
        message: `Edge "${edge.id}" references a node that does not exist (from="${edge.from}", to="${edge.to}").`,
        sourcePath: graph.sourcePath,
        evidence: edge.evidence[0],
      });
    }
    if (edge.evidence.length === 0) {
      issues.push({
        code: "WORKFLOW_MISSING_EVIDENCE",
        severity: "error",
        message: `Edge "${edge.id}" has no evidence reference.`,
        sourcePath: graph.sourcePath,
      });
    }
  }

  if (graph.triggers.length === 0) {
    issues.push({
      code: "WORKFLOW_UNSUPPORTED_TRIGGER",
      severity: "warning",
      message: `Workflow "${graph.name}" has no recognizable trigger.`,
      sourcePath: graph.sourcePath,
    });
  }

  const visibleNodeCount = graph.nodes.filter((n) => n.type !== "step").length;
  if (visibleNodeCount > 25) {
    issues.push({
      code: "WORKFLOW_TOO_LARGE",
      severity: "warning",
      message: `Workflow "${graph.name}" has ${visibleNodeCount} non-step nodes; a single diagram will need to be split.`,
      sourcePath: graph.sourcePath,
      remediation: "The narrative planner splits workflows over this size into an overview plus grouped detail scenes.",
    });
  }

  return issues;
}
