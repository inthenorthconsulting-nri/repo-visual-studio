// Namespaced under its own cache subdirectory, mirroring
// @rvs/decision-intelligence/src/constants.ts's DECISION_CACHE_DIR
// convention.

export const KNOWLEDGE_GRAPH_CACHE_DIR = ".rvs/cache/knowledge-graph";

/**
 * Output filenames a full `rvs graph build` (+ subsequent query/report
 * commands) run can produce, written under KNOWLEDGE_GRAPH_CACHE_DIR. This
 * extends the 9 files the Milestone 9 spec suggested with 3 more
 * (decisionImpact, graphNarrative, graphPlan) to match every sibling
 * package's narrative/plan/report split -- a disclosed deviation, not a
 * hidden one (see docs/architecture-knowledge-graph.md's "Known
 * limitations").
 */
export const KNOWLEDGE_GRAPH_OUTPUT_FILES = {
  graphSnapshot: "graph-snapshot.json",
  nodes: "nodes.json",
  edges: "edges.json",
  unresolvedLinks: "unresolved-links.json",
  impactResults: "impact-results.json",
  rootCauseGroups: "root-cause-groups.json",
  decisionImpact: "decision-impact.json",
  graphChanges: "graph-changes.json",
  changePlan: "change-plan.json",
  graphNarrative: "graph-narrative.json",
  graphPlan: "graph-plan.json",
  graphReport: "graph-report.json",
} as const;

/** The "this could actually cause that" edge-type set used by root-cause grouping and change-planning -- structural/causal relationships only, never a merely-referential one. */
export const CAUSAL_EDGE_TYPES = ["contains", "depends_on", "invokes", "implements", "produces", "consumes"] as const;

/** Default traversal bounds -- deliberately conservative so a single `rvs graph impact`/`path --all` call stays bounded even against the 2,000-node/5,000-edge scale fixture. */
export const DEFAULT_MAX_TRAVERSAL_DEPTH = 12;
export const DEFAULT_MAX_ALL_PATHS_DEPTH = 8;
export const DEFAULT_RESULT_LIMIT = 500;
