// Shared, hand-authored, deterministic fixtures for @rvs/proposal-review's
// test suite. No Date.now()/Math.random()/argless `new Date()` anywhere in
// this file.
//
// Evaluations are built via the real `@rvs/change-workbench` public API
// (`composeProposedChangeSet` + `evaluateProposedChange`), never a
// hand-rolled `ChangeWorkbenchEvaluation`-shaped object -- so these tests
// exercise the adapter against genuine Workbench output, not a shape that
// could drift from what evaluateProposedChange() actually produces.

import type { ChangeWorkbenchEvaluation, ConfirmedEntityRef, ProposalOperation, ProposedChangeSet, ProposedEntityRef } from "@rvs/change-workbench";
import { composeProposedChangeSet, evaluateProposedChange, mutateExistingEntityRef, proposeEntityRef, tryConfirmEntityRef } from "@rvs/change-workbench";
import type { ContentDigestVerification, GraphSnapshot, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { buildGraphContentDigest, buildGraphSnapshot, KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "@rvs/knowledge-graph";

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
 * exercise `PROPOSAL_REVIEW_BASELINE_DIGEST_MISMATCH` detection);
 * `content_digest` is the genuine KG-owned content digest of
 * `baseFixtureGraph()`'s own nodes/edges, computed via the canonical
 * `buildGraphContentDigest()` primitive rather than an arbitrary
 * placeholder -- Milestone 11.3.3A-P's own self-consistency and
 * transported-attestation content-binding checks (see adapter.ts) require
 * this to be genuine, not nominal, or every "ok"-path test pairing this
 * fixture with an unmodified `baseFixtureGraph()` would fail those checks.
 * `node_count`/`edge_count` are hand-pinned to `baseFixtureGraph()`'s
 * actual shape (3 nodes, 2 edges) -- if that fixture graph's shape ever
 * changes, these must change with it, or the adapter's node/edge-count
 * checks (`PROPOSAL_REVIEW_BASELINE_GRAPH_NODE_COUNT_MISMATCH`/
 * `_EDGE_COUNT_MISMATCH`) will surface the drift as a test failure.
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

/**
 * The REAL `buildGraphSnapshot()` membership digest of `baseFixtureGraph()`'s
 * own node/edge id sets -- not an arbitrary literal. This is @rvs/change-workbench's
 * `baseSnapshotDigest` parameter to `evaluateProposedChange()` (a distinct,
 * still-required Workbench-owned concept: the id-membership digest Workbench
 * checks a proposal's confirmed-entity refs against), separate from and
 * unrelated to Milestone 11.3.3A-P's own `buildGraphContentDigest()`-based
 * baseline content binding inside this package's adapter.ts -- retiring the
 * latter's now-removed candidate-baseline membership check does not change
 * what Workbench itself still requires here.
 */
export const BASE_SNAPSHOT_DIGEST: string = buildGraphSnapshot({
  repositoryId: REPOSITORY_ID,
  upstreamArtifacts: [],
  nodes: baseFixtureGraph().nodes,
  edges: baseFixtureGraph().edges,
}).digest;

/** The exact `ProposedChangeSet` `validEvaluation()` computes from -- a single source of truth for that fixture's operations, so `evaluation.proposal_id` and a caller-supplied `proposal` in a test always agree. */
export function validProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "new-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** A valid, sufficient proposal: adds one entity related to comp-a. Produces a "built" projection with a non-empty overlay and "valid_sufficient"/"valid_partial" validation. */
export function validEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const changeSet = validProposal();
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

/**
 * Like `validEvaluation()`, but additionally transports a caller-computed
 * `baselineContentAttestation` onto `evaluation.baseline_content_attestation`
 * -- exercising Milestone 11.3.3A-P's four-state baseline content-binding
 * contract. Passing `undefined` leaves the envelope key entirely absent
 * (the `"undefined"` transport state), exactly like `validEvaluation()`
 * itself -- `evaluateProposedChange()` only sets the key when its own
 * `baselineContentAttestation` parameter is not `undefined`.
 */
export function validEvaluationWithAttestation(attestation: ContentDigestVerification | undefined, baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const changeSet = validProposal();
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest, baselineContentAttestation: attestation });
}

/** A genuine `"attested"` `ContentDigestVerification` for `baseFixtureGraph()`'s own content -- `expected`/`actual` both equal the real `buildGraphContentDigest()` recomputation, so this attestation is self-consistent by construction. */
export function attestedBaselineContentAttestation(): ContentDigestVerification {
  const { nodes, edges } = baseFixtureGraph();
  const digest = buildGraphContentDigest(nodes, edges);
  return { status: "attested", expected: digest, actual: digest };
}

/** A genuine `"missing"` `ContentDigestVerification` for `baseFixtureGraph()`'s own content -- the persisted snapshot had no recorded content digest, so only `actual` (the real recomputation) is present. */
export function missingBaselineContentAttestation(): ContentDigestVerification {
  const { nodes, edges } = baseFixtureGraph();
  return { status: "missing", actual: buildGraphContentDigest(nodes, edges) };
}

/** A genuine `"mismatch"` `ContentDigestVerification` for `baseFixtureGraph()`'s own content -- `actual` is the real recomputation, but `expected` is a different, hand-picked persisted digest, so upstream verification already found the persisted baseline corrupt. */
export function mismatchBaselineContentAttestation(): ContentDigestVerification {
  const { nodes, edges } = baseFixtureGraph();
  return { status: "mismatch", expected: "persisted-digest-that-does-not-match", actual: buildGraphContentDigest(nodes, edges) };
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
export function invalidProposal(): ProposedChangeSet {
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "invalid-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "invalid-1", label: "Invalid", repository_id: "wrong-repo-id" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

export function invalidEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const changeSet = invalidProposal();
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

/** A proposal touching a removal, a modification, and an addition -- exercises "removed"/"modified"/"proposed"/"confirmed" overlay provenance all at once. */
export function mixedProvenanceProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("proposal-review-fixture", "new-mixed");
  const operations: ProposalOperation[] = [
    { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) },
    { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } },
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-mixed", label: "New Mixed", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

export function mixedProvenanceEvaluation(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  const changeSet = mixedProvenanceProposal();
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}
