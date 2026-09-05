// Shared, hand-authored, deterministic fixtures for @rvs/proposal-review's
// test suite. No Date.now()/Math.random()/argless `new Date()` anywhere in
// this file.
//
// Evaluations are built via the real `@rvs/change-workbench` public API
// (`composeProposedChangeSet` + `evaluateProposedChange`), never a
// hand-rolled `ChangeWorkbenchEvaluation`-shaped object -- so these tests
// exercise the adapter against genuine Workbench output, not a shape that
// could drift from what evaluateProposedChange() actually produces.

import type { ChangeWorkbenchEvaluation, ConfirmedEntityRef, ProposalOperation, ProposedEntityRef } from "@rvs/change-workbench";
import { composeProposedChangeSet, evaluateProposedChange, mutateExistingEntityRef, proposeEntityRef, tryConfirmEntityRef } from "@rvs/change-workbench";
import type { GraphSnapshot, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { buildGraphContentDigest, KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "@rvs/knowledge-graph";

export const REPOSITORY_ID = "fixture-repo";

export function makeNode(overrides: Partial<KnowledgeNode> & { id: string }): KnowledgeNode {
  return {
    node_type: "component",
    source_artifact: "architecture",
    source_entity_id: overrides.id,
    label: overrides.id,
    evidence_refs: [],
    resolution_status: "resolved",
    schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    repository_id: REPOSITORY_ID,
    confidence: "confirmed",
    ...overrides,
  };
}

export function makeEdge(overrides: Partial<KnowledgeEdge> & { id: string; from_node_id: string; to_node_id: string }): KnowledgeEdge {
  return {
    edge_type: "depends_on",
    direction: "directed",
    evidence_refs: [],
    resolution_status: "resolved",
    detail: "",
    ...overrides,
  };
}

/** comp-a -> comp-b -> comp-c, all in REPOSITORY_ID. */
export function baseFixtureGraph(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const compA = makeNode({ id: "comp-a", label: "Component A" });
  const compB = makeNode({ id: "comp-b", label: "Component B" });
  const compC = makeNode({ id: "comp-c", label: "Component C" });
  const edgeAB = makeEdge({ id: "edge-a-b", from_node_id: "comp-a", to_node_id: "comp-b" });
  const edgeBC = makeEdge({ id: "edge-b-c", from_node_id: "comp-b", to_node_id: "comp-c" });
  return { nodes: [compA, compB, compC], edges: [edgeAB, edgeBC] };
}

export function confirmedRef(id: string, nodes: readonly KnowledgeNode[]): ConfirmedEntityRef {
  const ref = tryConfirmEntityRef(id, nodes);
  if (!ref) throw new Error(`fixture setup error: "${id}" is not a confirmed node in the supplied fixture graph`);
  return ref;
}

/**
 * A `GraphSnapshot` whose repository_id/digest are exactly what the fixture
 * graph's evaluation was checked against -- i.e. compatible with
 * `baseSnapshotDigest()`'s evaluations by construction. `digest` stays a
 * caller-supplied parameter (deliberately mismatched by some callers to
 * exercise digest-inconsistency detection); `content_digest` is the genuine
 * KG-owned content digest of `baseFixtureGraph()`'s own nodes/edges,
 * computed via the canonical `buildGraphContentDigest()` primitive rather
 * than an arbitrary placeholder.
 */
export function compatibleObservedBaseline(baseSnapshotDigest: string): GraphSnapshot {
  const { nodes, edges } = baseFixtureGraph();
  return {
    id: `fixture-snapshot:${REPOSITORY_ID}:${baseSnapshotDigest}`,
    schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    repository_id: REPOSITORY_ID,
    upstream_artifacts: [],
    node_count: 3,
    edge_count: 2,
    digest: baseSnapshotDigest,
    content_digest: buildGraphContentDigest(nodes, edges),
  };
}

export const BASE_SNAPSHOT_DIGEST = "fixture-base-snapshot-digest-0001";

/** A valid, sufficient proposal: adds one entity related to comp-a. Produces a "built" projection with a non-empty overlay and "valid_sufficient"/"valid_partial" validation. */
export function validEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "new-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  const changeSet = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

/**
 * An invalid proposal: `add_entity`'s own `repository_id` disagrees with
 * the proposal's declared `repository_id` -- a `blocking: true`
 * `repository_id_mismatch` issue (validation.ts), forcing
 * `proposal_validation.status === "invalid"` and, consequently,
 * `projection.status === "not_built"` (evaluation.ts never attempts
 * `buildChangeOverlay()` against an invalid proposal). Deliberately not a
 * merely-`unresolved` case (e.g. a `remove_entity` targeting an
 * unconfirmed ref, which validation.ts treats as `blocking: false`) --
 * this fixture exists specifically to exercise the `not_built` path.
 */
export function invalidEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "invalid-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "invalid-1", label: "Invalid", repository_id: "wrong-repo-id" },
  ];
  const changeSet = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

/** A proposal touching a removal, a modification, and an addition -- exercises "removed"/"modified"/"proposed"/"confirmed" overlay provenance all at once. */
export function mixedProvenanceEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "new-mixed");
  const operations: ProposalOperation[] = [
    { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) },
    { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } },
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-mixed", label: "New Mixed", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  const changeSet = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}
