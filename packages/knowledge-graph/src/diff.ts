// rvs graph compare --from <snapshot> --to <snapshot>. A pure Map<id,
// entity>-based diff for nodes/edges, plus three targeted re-runs of
// path-finding.ts / impact-analysis.ts / root-cause.ts for the
// path/impact/root-cause-specific facets. Disclosed scope trim: dependency-
// path and impact-radius comparison only run for entity ids the caller
// explicitly supplies (via `pathQueries`/`impactQueryEntityIds`) -- an
// unscoped all-pairs comparison would be combinatorially unbounded on a
// densely connected graph, so this package never attempts it silently.

import type { GraphChangeSet, KnowledgeEdge, KnowledgeNode, RootCauseGroup } from "./contracts.js";
import { buildChangeSetId } from "./ids.js";
import { buildGenericGraph, findCycles, findOrphanNodes, normalizeCycleKey, type GenericEdge } from "./graph-core.js";
import { groupRootCauses } from "./root-cause.js";
import { runImpactAnalysis } from "./impact-analysis.js";
import { findShortestPath } from "./path-finding.js";
import type { DecisionStateLookup } from "./decision-impact.js";
import { DEFAULT_MAX_TRAVERSAL_DEPTH } from "./constants.js";

export interface GraphSnapshotState {
  snapshotId: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface DiffOptions {
  decisionStateLookup: DecisionStateLookup;
  /** Entity ids present in both snapshots to compare impact radius for. Empty by default -- see module header. */
  impactQueryEntityIds?: string[];
  /** (from, to) node-id pairs present in both snapshots to compare shortest path for. Empty by default -- see module header. */
  pathQueries?: Array<{ from: string; to: string }>;
}

function toGenericEdges(edges: KnowledgeEdge[]): GenericEdge<string>[] {
  return edges.map((edge) => ({ from: edge.from_node_id, to: edge.to_node_id, kind: edge.edge_type }));
}

function cycleKeySet(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): Set<string> {
  const graph = buildGenericGraph(nodes.map((node) => node.id), toGenericEdges(edges));
  return new Set(findCycles(graph).map(normalizeCycleKey));
}

function touchingEdgeIds(edges: KnowledgeEdge[], nodeId: string): Set<string> {
  return new Set(edges.filter((edge) => edge.from_node_id === nodeId || edge.to_node_id === nodeId).map((edge) => edge.id));
}

function edgeSetsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const value of a) if (!b.has(value)) return true;
  return false;
}

function rootCauseKey(group: RootCauseGroup): string {
  return `${group.classification}:${group.finding_node_ids.join(",")}`;
}

export function diffGraphs(source: GraphSnapshotState, target: GraphSnapshotState, options: DiffOptions): GraphChangeSet {
  const sourceNodeById = new Map(source.nodes.map((node) => [node.id, node]));
  const targetNodeById = new Map(target.nodes.map((node) => [node.id, node]));
  const sourceEdgeById = new Map(source.edges.map((edge) => [edge.id, edge]));
  const targetEdgeById = new Map(target.edges.map((edge) => [edge.id, edge]));

  const nodesAdded = Array.from(targetNodeById.keys()).filter((id) => !sourceNodeById.has(id)).sort();
  const nodesRemoved = Array.from(sourceNodeById.keys()).filter((id) => !targetNodeById.has(id)).sort();
  const edgesAdded = Array.from(targetEdgeById.keys()).filter((id) => !sourceEdgeById.has(id)).sort();
  const edgesRemoved = Array.from(sourceEdgeById.keys()).filter((id) => !targetEdgeById.has(id)).sort();

  const entityTypesChanged: string[] = [];
  for (const [id, sourceNode] of sourceNodeById) {
    const targetNode = targetNodeById.get(id);
    if (targetNode && targetNode.node_type !== sourceNode.node_type) entityTypesChanged.push(id);
  }

  const relationshipsChanged: string[] = [];
  for (const [id, sourceEdge] of sourceEdgeById) {
    const targetEdge = targetEdgeById.get(id);
    if (targetEdge && (targetEdge.resolution_status !== sourceEdge.resolution_status || targetEdge.detail !== sourceEdge.detail)) {
      relationshipsChanged.push(id);
    }
  }

  const dependencyPathsChanged: string[] = [];
  for (const query of options.pathQueries ?? []) {
    if (![query.from, query.to].every((id) => sourceNodeById.has(id) && targetNodeById.has(id))) continue;
    const sourcePath = findShortestPath(source.nodes, source.edges, query.from, query.to, {
      maxDepth: DEFAULT_MAX_TRAVERSAL_DEPTH,
      direction: "downstream",
    });
    const targetPath = findShortestPath(target.nodes, target.edges, query.from, query.to, {
      maxDepth: DEFAULT_MAX_TRAVERSAL_DEPTH,
      direction: "downstream",
    });
    if ((sourcePath?.id ?? null) !== (targetPath?.id ?? null)) {
      dependencyPathsChanged.push(`${query.from}->${query.to}`);
    }
  }

  const impactRadiusIncreased: string[] = [];
  const impactRadiusDecreased: string[] = [];
  for (const entityId of options.impactQueryEntityIds ?? []) {
    if (!sourceNodeById.has(entityId) || !targetNodeById.has(entityId)) continue;
    const sourceImpact = runImpactAnalysis(
      source.nodes,
      source.edges,
      { entity_node_id: entityId, max_depth: DEFAULT_MAX_TRAVERSAL_DEPTH, direction: "downstream" },
      options.decisionStateLookup,
    );
    const targetImpact = runImpactAnalysis(
      target.nodes,
      target.edges,
      { entity_node_id: entityId, max_depth: DEFAULT_MAX_TRAVERSAL_DEPTH, direction: "downstream" },
      options.decisionStateLookup,
    );
    const sourceCount = sourceImpact.directly_affected.length + sourceImpact.transitively_affected.length;
    const targetCount = targetImpact.directly_affected.length + targetImpact.transitively_affected.length;
    if (targetCount > sourceCount) impactRadiusIncreased.push(entityId);
    else if (targetCount < sourceCount) impactRadiusDecreased.push(entityId);
  }

  const sourceOrphans = new Set(findOrphanNodes(buildGenericGraph(source.nodes.map((node) => node.id), toGenericEdges(source.edges))));
  const targetOrphans = findOrphanNodes(buildGenericGraph(target.nodes.map((node) => node.id), toGenericEdges(target.edges)));
  const newOrphans = targetOrphans.filter((id) => !sourceOrphans.has(id));

  const sourceCycleKeys = cycleKeySet(source.nodes, source.edges);
  const targetCycleKeys = cycleKeySet(target.nodes, target.edges);
  const newCycles = Array.from(targetCycleKeys).filter((key) => !sourceCycleKeys.has(key)).sort();

  const sourceRootCauses = groupRootCauses(source.nodes, source.edges);
  const targetRootCauses = groupRootCauses(target.nodes, target.edges);
  const sourceRootCauseKeys = new Set(sourceRootCauses.map(rootCauseKey));
  const targetRootCauseKeys = new Set(targetRootCauses.map(rootCauseKey));
  const rootCausesIntroduced = targetRootCauses
    .filter((group) => !sourceRootCauseKeys.has(rootCauseKey(group)))
    .map((group) => group.id)
    .sort();
  const rootCausesResolved = sourceRootCauses
    .filter((group) => !targetRootCauseKeys.has(rootCauseKey(group)))
    .map((group) => group.id)
    .sort();

  const decisionDependenciesChanged = new Set<string>();
  const governanceReachChanged = new Set<string>();
  for (const [id, sourceNode] of sourceNodeById) {
    const targetNode = targetNodeById.get(id);
    if (!targetNode || sourceNode.node_type !== targetNode.node_type) continue;
    if (sourceNode.node_type !== "decision" && sourceNode.node_type !== "governance_finding") continue;
    const changed = edgeSetsDiffer(touchingEdgeIds(source.edges, id), touchingEdgeIds(target.edges, id));
    if (!changed) continue;
    if (sourceNode.node_type === "decision") decisionDependenciesChanged.add(id);
    else governanceReachChanged.add(id);
  }

  return {
    id: buildChangeSetId(source.snapshotId, target.snapshotId),
    schema_version: 1,
    source_snapshot_id: source.snapshotId,
    target_snapshot_id: target.snapshotId,
    nodes_added: nodesAdded,
    nodes_removed: nodesRemoved,
    edges_added: edgesAdded,
    edges_removed: edgesRemoved,
    entity_types_changed: entityTypesChanged.sort(),
    relationships_changed: relationshipsChanged.sort(),
    dependency_paths_changed: dependencyPathsChanged.sort(),
    impact_radius_increased: impactRadiusIncreased.sort(),
    impact_radius_decreased: impactRadiusDecreased.sort(),
    new_orphans: newOrphans.sort(),
    new_cycles: newCycles,
    root_causes_introduced: rootCausesIntroduced,
    root_causes_resolved: rootCausesResolved,
    decision_dependencies_changed: Array.from(decisionDependenciesChanged).sort(),
    governance_reach_changed: Array.from(governanceReachChanged).sort(),
  };
}
