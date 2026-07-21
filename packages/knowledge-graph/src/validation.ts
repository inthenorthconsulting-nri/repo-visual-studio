// rvs graph validate --ci. Two kinds of checks, matching decisions
// validate --ci's shape (one flat code per finding, `blocking` decides the
// exit code): structural checks over an already-built graph (NODE/EDGE/
// IDENTITY/REFERENCE/CYCLE/ROOT_CAUSE/DECISION/COMPATIBILITY families) and
// request-shape guards over a not-yet-run query (IMPACT/PATH families) --
// the latter reject unbounded traversal requests before they run, rather
// than letting an unbounded query silently degrade.

import type { ImpactQuery, KnowledgeEdge, KnowledgeNode, RootCauseGroup, ValidationFinding } from "./contracts.js";
import type { KnowledgeGraphBuildResult } from "./graph-builder.js";
import type { PathQueryOptions } from "./path-finding.js";
import { buildValidationFindingId } from "./ids.js";
import { buildGenericGraph, findCycles, type GenericEdge } from "./graph-core.js";
import { DEFAULT_MAX_ALL_PATHS_DEPTH } from "./constants.js";

/** Disclosed ceilings -- requests above these are rejected rather than silently run to completion or silently truncated. */
export const MAX_ALLOWED_QUERY_DEPTH = 50;

const CONTAINMENT_EDGE_TYPES = ["contains"] as const;
const CAUSAL_CYCLE_EDGE_TYPES = ["contains", "depends_on", "invokes", "implements", "produces", "consumes"] as const;

function finding(code: string, subjectId: string, message: string, blocking: boolean): ValidationFinding {
  return { id: buildValidationFindingId(code, subjectId), code, message, subject_id: subjectId, blocking };
}

function toGenericEdges(edges: KnowledgeEdge[], allowed: readonly string[]): GenericEdge<string>[] {
  return edges
    .filter((edge) => (allowed as readonly string[]).includes(edge.edge_type))
    .map((edge) => ({ from: edge.from_node_id, to: edge.to_node_id, kind: edge.edge_type }));
}

function sortFindings(findings: ValidationFinding[]): ValidationFinding[] {
  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Structural validation of an already-built graph. */
export function validateGraph(result: KnowledgeGraphBuildResult, rootCauseGroups: RootCauseGroup[] = []): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const nodes: KnowledgeNode[] = result.nodes;
  const edges: KnowledgeEdge[] = result.edges;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const seenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      findings.push(finding("GRAPH_NODE_DUPLICATE_ID", node.id, `Node id "${node.id}" appears more than once in the final node set.`, true));
    }
    seenNodeIds.add(node.id);
  }

  for (const edge of edges) {
    if (edge.from_node_id === edge.to_node_id) {
      findings.push(finding("GRAPH_EDGE_SELF_LINK", edge.id, `Edge "${edge.id}" links a node to itself.`, false));
    }
    if (!nodeById.has(edge.from_node_id) || !nodeById.has(edge.to_node_id)) {
      findings.push(
        finding("GRAPH_EDGE_MISSING_ENDPOINT", edge.id, `Edge "${edge.id}" references a node id not present in the graph's final node set.`, true),
      );
    }
  }
  for (const duplicate of result.duplicate_edge_findings) {
    findings.push(
      finding(
        "GRAPH_EDGE_DUPLICATE",
        duplicate.edge_id,
        `Two or more upstream artifacts declared the relationship "${duplicate.edge_key}" with conflicting details/resolution statuses: ${duplicate.conflicting_resolution_statuses.join(", ")}.`,
        false,
      ),
    );
  }

  for (const collision of result.identity_collisions) {
    findings.push(
      finding(
        "GRAPH_IDENTITY_COLLISION",
        collision.identity_key,
        `Distinct identities "${collision.identity_key}" all resolved to the same node id: ${collision.node_ids.join(", ")}.`,
        true,
      ),
    );
  }

  for (const edge of edges) {
    const toNode = nodeById.get(edge.to_node_id);
    const fromNode = nodeById.get(edge.from_node_id);
    if (toNode?.node_type === "unresolved_reference" || fromNode?.node_type === "unresolved_reference") {
      findings.push(
        finding("GRAPH_REFERENCE_BROKEN", edge.id, `Edge "${edge.id}" could not be fully resolved against the graph's known entities.`, false),
      );
    }
  }

  const containmentGraph = buildGenericGraph(nodes.map((node) => node.id), toGenericEdges(edges, CONTAINMENT_EDGE_TYPES));
  for (const cycle of findCycles(containmentGraph)) {
    findings.push(
      finding(
        "GRAPH_CYCLE_INVALID_CONTAINMENT",
        cycle[0] ?? "unknown",
        `Containment cycle detected (${cycle.join(" -> ")}); containment must form a DAG.`,
        true,
      ),
    );
  }
  const causalGraph = buildGenericGraph(nodes.map((node) => node.id), toGenericEdges(edges, CAUSAL_CYCLE_EDGE_TYPES));
  for (const cycle of findCycles(causalGraph)) {
    findings.push(
      finding("GRAPH_CYCLE_DETECTED", cycle[0] ?? "unknown", `Cycle detected among causal edges (${cycle.join(" -> ")}).`, false),
    );
  }

  for (const group of rootCauseGroups) {
    if (group.classification !== "unresolved") continue;
    findings.push(
      finding(
        "GRAPH_ROOT_CAUSE_INSUFFICIENT_ANCHOR",
        group.finding_node_ids[0] ?? group.id,
        `Root-cause analysis could not be computed for ${group.finding_node_ids.join(", ")}: ${group.detail}`,
        false,
      ),
    );
  }

  for (const edge of edges) {
    const fromNode = nodeById.get(edge.from_node_id);
    if (fromNode?.node_type !== "decision") continue;
    const toNode = nodeById.get(edge.to_node_id);
    if (toNode?.node_type === "unresolved_reference") {
      findings.push(
        finding("GRAPH_DECISION_UNRESOLVED_REFERENCE", edge.id, `Decision edge "${edge.id}" references an entity that could not be resolved.`, false),
      );
    }
  }

  if (result.compatibility.status === "incompatible") {
    findings.push(
      finding(
        "GRAPH_COMPATIBILITY_INCOMPATIBLE_SET",
        result.repository_id,
        `Upstream artifact set is incompatible: ${result.compatibility.reasons.join("; ")}`,
        true,
      ),
    );
  } else if (result.compatibility.status === "partial") {
    findings.push(
      finding(
        "GRAPH_COMPATIBILITY_PARTIAL_SET",
        result.repository_id,
        `Upstream artifact set is only partially available: ${result.compatibility.reasons.join("; ")}`,
        false,
      ),
    );
  } else if (result.compatibility.status === "compatible_with_warnings") {
    findings.push(
      finding(
        "GRAPH_COMPATIBILITY_WARNING",
        result.repository_id,
        `Upstream artifact set is compatible with warnings: ${result.compatibility.reasons.join("; ")}`,
        false,
      ),
    );
  }

  return sortFindings(findings);
}

/** Request-shape guard for `rvs graph impact` -- rejects an unbounded traversal request before it runs. */
export function validateImpactQuery(query: ImpactQuery): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!Number.isInteger(query.max_depth) || query.max_depth <= 0) {
    findings.push(
      finding("GRAPH_IMPACT_INVALID_DEPTH", query.entity_node_id, `max_depth must be a positive integer, received ${query.max_depth}.`, true),
    );
  } else if (query.max_depth > MAX_ALLOWED_QUERY_DEPTH) {
    findings.push(
      finding(
        "GRAPH_IMPACT_UNBOUNDED_DEPTH",
        query.entity_node_id,
        `Requested max_depth ${query.max_depth} exceeds the allowed ceiling of ${MAX_ALLOWED_QUERY_DEPTH}.`,
        true,
      ),
    );
  }
  return sortFindings(findings);
}

/** Request-shape guard for `rvs graph path` -- flags depths that risk an unstable/expensive `--all` enumeration. */
export function validatePathQuery(
  fromNodeId: string,
  toNodeId: string,
  options: PathQueryOptions,
  allPaths: boolean,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const subjectId = `${fromNodeId}->${toNodeId}`;
  if (!Number.isInteger(options.maxDepth) || options.maxDepth <= 0) {
    findings.push(finding("GRAPH_PATH_INVALID_DEPTH", subjectId, `maxDepth must be a positive integer, received ${options.maxDepth}.`, true));
  } else if (options.maxDepth > MAX_ALLOWED_QUERY_DEPTH) {
    findings.push(
      finding("GRAPH_PATH_UNBOUNDED_DEPTH", subjectId, `Requested maxDepth ${options.maxDepth} exceeds the allowed ceiling of ${MAX_ALLOWED_QUERY_DEPTH}.`, true),
    );
  } else if (allPaths && options.maxDepth > DEFAULT_MAX_ALL_PATHS_DEPTH) {
    findings.push(
      finding(
        "GRAPH_PATH_ALL_PATHS_DEPTH_HIGH",
        subjectId,
        `--all requested with maxDepth ${options.maxDepth}, above the default bounded depth of ${DEFAULT_MAX_ALL_PATHS_DEPTH}; results are still deterministic but enumeration cost grows quickly.`,
        false,
      ),
    );
  }
  return sortFindings(findings);
}
