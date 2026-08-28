// Ephemeral graph overlay construction. Builds a `ChangeOverlay` -- plain
// `KnowledgeNode[]`/`KnowledgeEdge[]` arrays scoped to one call, never a
// `GraphSnapshot`, never persisted, never mutating the caller's confirmed
// arrays -- by applying a `ProposedChangeSet`'s operations against a
// repository-boundary-filtered base.
//
// Mandatory repository_id-stamping invariant: every node this function ever
// places in the overlay (confirmed or synthesized) has
// `repository_id === changeSet.repository_id`. Confirmed nodes get there by
// being filtered to that repository_id before anything else happens
// (mirroring `traverse()`'s own `repositoryBoundary: "single"` filter in
// @rvs/knowledge-graph/src/traversal.ts); synthesized nodes get there
// because `validation.ts` already rejects an `add_entity` whose
// `repository_id` disagrees with the proposal's own.
//
// When an operation's ref cannot be resolved against the repository-
// boundary-filtered confirmed set, that operation's effect is skipped (never
// guessed) and the overall build status degrades to "unresolved" -- it is
// never silently dropped and never treated as "ok".

import { KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "@rvs/knowledge-graph";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { ChangeOverlay, OverlayBuildIssue, OverlayBuildResult, OverlayEntityProvenance, ProposalOperation, ProposedChangeSet } from "./contracts.js";
import { applySupportedEdgeAttributes, applySupportedNodeAttributes } from "./attribute-support.js";
import { buildSyntheticEdgeId } from "./ids.js";

export interface OverlayBuildParams {
  changeSet: ProposedChangeSet;
  confirmedNodes: readonly KnowledgeNode[];
  confirmedEdges: readonly KnowledgeEdge[];
  baseSnapshotDigest: string;
}

function edgeKey(edge: { from_node_id: string; edge_type: string; to_node_id: string }): string {
  return `${edge.from_node_id}:${edge.edge_type}:${edge.to_node_id}`;
}

export function buildChangeOverlay(params: OverlayBuildParams): OverlayBuildResult {
  const { changeSet, confirmedNodes, confirmedEdges, baseSnapshotDigest } = params;
  const issues: OverlayBuildIssue[] = [];

  // Repository-boundary filter -- the mandatory invariant. Any confirmed
  // node/edge outside this proposal's declared repository_id never enters
  // the overlay, exactly as traverse() never crosses a repository boundary
  // when repositoryBoundary is "single".
  const baseNodes = confirmedNodes.filter((node) => node.repository_id === changeSet.repository_id);
  const baseNodeIds = new Set(baseNodes.map((node) => node.id));
  const baseEdges = confirmedEdges.filter((edge) => baseNodeIds.has(edge.from_node_id) && baseNodeIds.has(edge.to_node_id));

  const nodesById = new Map<string, KnowledgeNode>(baseNodes.map((node) => [node.id, node]));
  const nodeProvenance: Record<string, OverlayEntityProvenance> = {};
  for (const node of baseNodes) nodeProvenance[node.id] = "confirmed";

  const edgesByKey = new Map<string, KnowledgeEdge>(baseEdges.map((edge) => [edgeKey(edge), edge]));
  const edgeProvenance: Record<string, OverlayEntityProvenance> = {};
  for (const edge of baseEdges) edgeProvenance[edgeKey(edge)] = "confirmed";

  const indexed = changeSet.operations.map((operation, index) => ({ operation, index }));

  applyRemovals(indexed, nodesById, edgesByKey, nodeProvenance, edgeProvenance, issues);
  applyAdditions(indexed, nodesById, edgesByKey, nodeProvenance, edgeProvenance, issues);
  applyModifications(indexed, nodesById, edgesByKey, nodeProvenance, edgeProvenance, issues);

  const hasBlocking = issues.some((issue) => issue.blocking);
  const hasUnresolved = issues.some((issue) => !issue.blocking);
  const status: OverlayBuildResult["status"] = hasBlocking ? "invalid" : hasUnresolved ? "unresolved" : "ok";

  const overlay: ChangeOverlay = {
    repository_id: changeSet.repository_id,
    base_snapshot_digest: baseSnapshotDigest,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
    node_provenance: nodeProvenance,
    edge_provenance: edgeProvenance,
  };

  return { status, overlay: status === "invalid" ? undefined : overlay, issues: sortIssues(issues) };
}

function sortIssues(issues: OverlayBuildIssue[]): OverlayBuildIssue[] {
  return [...issues].sort((a, b) => (a.operation_index ?? -1) - (b.operation_index ?? -1) || a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail));
}

type Indexed = { operation: ProposalOperation; index: number };

function applyRemovals(
  indexed: Indexed[],
  nodesById: Map<string, KnowledgeNode>,
  edgesByKey: Map<string, KnowledgeEdge>,
  nodeProvenance: Record<string, OverlayEntityProvenance>,
  edgeProvenance: Record<string, OverlayEntityProvenance>,
  issues: OverlayBuildIssue[],
): void {
  const removeEntities = indexed.filter((entry) => entry.operation.kind === "remove_entity").sort((a, b) => (a.operation as { ref: string }).ref.localeCompare((b.operation as { ref: string }).ref));
  for (const entry of removeEntities) {
    const ref = (entry.operation as { ref: string }).ref;
    if (!nodesById.has(ref)) {
      issues.push({ code: "unresolved_remove_entity_target", operation_index: entry.index, detail: `remove_entity target "${ref}" is not present in this proposal's repository-scoped confirmed graph.`, blocking: false });
      continue;
    }
    nodesById.delete(ref);
    nodeProvenance[ref] = "removed";
    for (const [key, edge] of [...edgesByKey.entries()]) {
      if (edge.from_node_id === ref || edge.to_node_id === ref) {
        edgesByKey.delete(key);
        edgeProvenance[key] = "removed";
      }
    }
  }

  const removeRelations = indexed.filter((entry) => entry.operation.kind === "remove_relation").sort((a, b) => tripleOf(a.operation).localeCompare(tripleOf(b.operation)));
  for (const entry of removeRelations) {
    const op = entry.operation as { from_ref: string; to_ref: string; edge_type: string };
    const key = `${op.from_ref}:${op.edge_type}:${op.to_ref}`;
    if (!edgesByKey.has(key)) {
      issues.push({ code: "unresolved_remove_relation_target", operation_index: entry.index, detail: `remove_relation target "${key}" is not present in this proposal's repository-scoped confirmed graph.`, blocking: false });
      continue;
    }
    edgesByKey.delete(key);
    edgeProvenance[key] = "removed";
  }
}

function tripleOf(operation: ProposalOperation): string {
  if (operation.kind === "add_relation" || operation.kind === "remove_relation" || operation.kind === "modify_relation") {
    return `${operation.from_ref}:${operation.edge_type}:${operation.to_ref}`;
  }
  return "";
}

function applyAdditions(
  indexed: Indexed[],
  nodesById: Map<string, KnowledgeNode>,
  edgesByKey: Map<string, KnowledgeEdge>,
  nodeProvenance: Record<string, OverlayEntityProvenance>,
  edgeProvenance: Record<string, OverlayEntityProvenance>,
  issues: OverlayBuildIssue[],
): void {
  const addEntities = indexed.filter((entry) => entry.operation.kind === "add_entity").sort((a, b) => (a.operation as { ref: string }).ref.localeCompare((b.operation as { ref: string }).ref));
  for (const entry of addEntities) {
    const op = entry.operation as Extract<ProposalOperation, { kind: "add_entity" }>;
    const asserted = applySupportedNodeAttributes({ label: op.label, evidence_refs: op.evidence_refs ?? [] }, op.attributes ?? {});
    const node: KnowledgeNode = {
      id: op.ref,
      node_type: op.node_type,
      source_artifact: op.source_artifact,
      source_entity_id: op.proposed_source_entity_id,
      label: asserted.label,
      evidence_refs: asserted.evidence_refs,
      resolution_status: "resolved",
      schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
      repository_id: op.repository_id,
      confidence: "qualified",
    };
    nodesById.set(node.id, node);
    nodeProvenance[node.id] = "proposed";
  }

  const addRelations = indexed.filter((entry) => entry.operation.kind === "add_relation").sort((a, b) => tripleOf(a.operation).localeCompare(tripleOf(b.operation)));
  for (const entry of addRelations) {
    const op = entry.operation as Extract<ProposalOperation, { kind: "add_relation" }>;
    if (!nodesById.has(op.from_ref) || !nodesById.has(op.to_ref)) {
      issues.push({ code: "unresolved_add_relation_endpoint", operation_index: entry.index, detail: `add_relation endpoint "${!nodesById.has(op.from_ref) ? op.from_ref : op.to_ref}" is not present in this proposal's overlay (neither confirmed nor introduced by a prior add_entity).`, blocking: false });
      continue;
    }
    const key = `${op.from_ref}:${op.edge_type}:${op.to_ref}`;
    const edge: KnowledgeEdge = {
      id: buildSyntheticEdgeId(op.from_ref, op.to_ref, op.edge_type),
      edge_type: op.edge_type,
      from_node_id: op.from_ref,
      to_node_id: op.to_ref,
      direction: "directed",
      evidence_refs: op.evidence_refs ?? [],
      resolution_status: "resolved",
      detail: op.detail ?? "",
    };
    edgesByKey.set(key, edge);
    edgeProvenance[key] = "proposed";
  }
}

function applyModifications(
  indexed: Indexed[],
  nodesById: Map<string, KnowledgeNode>,
  edgesByKey: Map<string, KnowledgeEdge>,
  nodeProvenance: Record<string, OverlayEntityProvenance>,
  edgeProvenance: Record<string, OverlayEntityProvenance>,
  issues: OverlayBuildIssue[],
): void {
  const modifyAttrs = indexed.filter((entry) => entry.operation.kind === "modify_attributes").sort((a, b) => (a.operation as { ref: string }).ref.localeCompare((b.operation as { ref: string }).ref));
  for (const entry of modifyAttrs) {
    const op = entry.operation as Extract<ProposalOperation, { kind: "modify_attributes" }>;
    const existing = nodesById.get(op.ref);
    if (!existing) {
      issues.push({ code: "unresolved_modify_attributes_target", operation_index: entry.index, detail: `modify_attributes target "${op.ref}" is not present in this proposal's repository-scoped overlay (already removed, or never confirmed).`, blocking: false });
      continue;
    }
    const next = applySupportedNodeAttributes(existing, op.attributes);
    nodesById.set(op.ref, next);
    nodeProvenance[op.ref] = "modified";
  }

  const modifyRelations = indexed.filter((entry) => entry.operation.kind === "modify_relation").sort((a, b) => tripleOf(a.operation).localeCompare(tripleOf(b.operation)));
  for (const entry of modifyRelations) {
    const op = entry.operation as Extract<ProposalOperation, { kind: "modify_relation" }>;
    const key = `${op.from_ref}:${op.edge_type}:${op.to_ref}`;
    const existing = edgesByKey.get(key);
    if (!existing) {
      issues.push({ code: "unresolved_modify_relation_target", operation_index: entry.index, detail: `modify_relation target "${key}" is not present in this proposal's repository-scoped overlay (already removed, or never confirmed).`, blocking: false });
      continue;
    }
    const next = applySupportedEdgeAttributes(existing, op.attributes);
    edgesByKey.set(key, next);
    edgeProvenance[key] = "modified";
  }
}
