// Shared, hand-authored, deterministic fixtures for
// @rvs/proposal-architecture-review's test suite.
//
// Mirrors @rvs/proposal-review's own fixtures.ts convention: a genuine
// `ProposalReviewVisualInput` is built by driving the REAL upstream public
// APIs (`@rvs/change-workbench`'s `composeProposedChangeSet` +
// `evaluateProposedChange`, `@rvs/knowledge-graph`'s `buildGraphSnapshot` +
// `buildGraphContentDigest`, and @rvs/proposal-review's own
// `buildProposalReviewVisualInput`) rather than a hand-rolled object that
// could drift from what those functions actually produce. These three
// packages are devDependencies only (test-only reuse) -- this package's
// sole PRODUCTION dependency remains @rvs/proposal-review; see
// package-dag.test.ts.
//
// No Date.now()/Math.random()/argless `new Date()` anywhere in this file.

import type { ChangeWorkbenchEvaluation, ConfirmedEntityRef, ProposalOperation, ProposedChangeSet, ProposedEntityRef } from "@rvs/change-workbench";
import { composeProposedChangeSet, evaluateProposedChange, mutateExistingEntityRef, proposeEntityRef, tryConfirmEntityRef } from "@rvs/change-workbench";
import type { GraphSnapshot, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { buildGraphContentDigest, buildGraphSnapshot, KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "@rvs/knowledge-graph";
import type { ProposalReviewVisualInput } from "@rvs/proposal-review";
import { buildProposalReviewVisualInput } from "@rvs/proposal-review";

export const REPOSITORY_ID = "par-fixture-repo";

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

function confirmedRef(id: string, nodes: readonly KnowledgeNode[]): ConfirmedEntityRef {
  const ref = tryConfirmEntityRef(id, nodes);
  if (!ref) throw new Error(`fixture setup error: "${id}" is not a confirmed node in the supplied fixture graph`);
  return ref;
}

export const BASE_SNAPSHOT_DIGEST: string = buildGraphSnapshot({
  repositoryId: REPOSITORY_ID,
  upstreamArtifacts: [],
  nodes: baseFixtureGraph().nodes,
  edges: baseFixtureGraph().edges,
}).digest;

/** A `GraphSnapshot` compatible with `baseFixtureGraph()`'s own content -- see @rvs/proposal-review's own fixtures.ts for why `content_digest` must be the genuine `buildGraphContentDigest()` recomputation, not a nominal placeholder. */
export function observedBaselineSnapshot(baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): GraphSnapshot {
  const { nodes, edges } = baseFixtureGraph();
  return {
    id: `par-fixture-snapshot:${REPOSITORY_ID}:${baseSnapshotDigest}`,
    schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    repository_id: REPOSITORY_ID,
    upstream_artifacts: [],
    node_count: 3,
    edge_count: 2,
    digest: baseSnapshotDigest,
    content_digest: buildGraphContentDigest(nodes, edges),
  };
}

/** Adds one entity related to comp-a. Produces a "built" projection with a non-empty overlay and "valid_sufficient" validation. */
export function addEntityProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("par-fixture", "new-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** Removes comp-c, modifies comp-b's label, adds a new entity related to comp-a -- exercises "removed"/"modified"/"proposed"/"confirmed" overlay provenance all at once. */
export function mixedProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const newRef: ProposedEntityRef = proposeEntityRef("par-fixture", "new-mixed");
  const operations: ProposalOperation[] = [
    { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) },
    { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } },
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-mixed", label: "New Mixed", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** Removes the edge comp-a -> comp-b, referencing it purely by its confirmed endpoints. */
export function removeRelationProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const operations: ProposalOperation[] = [{ kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-b", nodes), edge_type: "depends_on" }];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** Changes the comp-a -> comp-b edge's `detail` (the one caller-assertable edge attribute). */
export function modifyRelationProposal(): ProposedChangeSet {
  const { nodes } = baseFixtureGraph();
  const operations: ProposalOperation[] = [
    { kind: "modify_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-b", nodes), edge_type: "depends_on", attributes: { detail: "critical dependency" } },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** `add_entity`'s own `repository_id` disagrees with the proposal's declared `repository_id` -- forces `proposal_validation.status === "invalid"` and, consequently, `projection.status === "not_built"`. */
export function invalidProposal(): ProposedChangeSet {
  const newRef: ProposedEntityRef = proposeEntityRef("par-fixture", "invalid-1");
  const operations: ProposalOperation[] = [
    { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "invalid-1", label: "Invalid", repository_id: "wrong-repo-id" },
  ];
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
}

/** Zero operations, evaluated against an EMPTY confirmed graph -- `buildChangeOverlay()` always seeds `overlay.nodes`/`overlay.edges` from the repository-scoped confirmed set, so this is the only way to produce a genuinely empty-but-`"ok"` overlay: a `"built"` projection whose overlay has zero nodes and zero edges, structurally distinct from `"not_built"`. */
export function emptyProposal(): ProposedChangeSet {
  return composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations: [] });
}

export const EMPTY_BASE_SNAPSHOT_DIGEST: string = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: [], nodes: [], edges: [] }).digest;

export function emptyBuiltEvaluation(changeSet: ProposedChangeSet = emptyProposal()): ChangeWorkbenchEvaluation {
  return evaluateProposedChange({ changeSet, confirmedNodes: [], confirmedEdges: [], baseSnapshotDigest: EMPTY_BASE_SNAPSHOT_DIGEST });
}

/** A `GraphSnapshot`/graph pair for the empty confirmed set -- paired with `emptyBuiltEvaluation()`, never with `baseFixtureGraph()` (which would fail the adapter's node/edge-count consistency check). */
export function emptyObservedBaselineSnapshot(baseSnapshotDigest: string = EMPTY_BASE_SNAPSHOT_DIGEST): GraphSnapshot {
  return {
    id: `par-fixture-snapshot-empty:${REPOSITORY_ID}:${baseSnapshotDigest}`,
    schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    repository_id: REPOSITORY_ID,
    upstream_artifacts: [],
    node_count: 0,
    edge_count: 0,
    digest: baseSnapshotDigest,
    content_digest: buildGraphContentDigest([], []),
  };
}

function evaluationFor(changeSet: ProposedChangeSet, baseSnapshotDigest: string = BASE_SNAPSHOT_DIGEST): ChangeWorkbenchEvaluation {
  const { nodes, edges } = baseFixtureGraph();
  return evaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

export interface BuildVisualInputOptions {
  evaluation?: ChangeWorkbenchEvaluation;
  observedBaseline?: GraphSnapshot;
  observedBaselineGraph?: { nodes: readonly KnowledgeNode[]; edges: readonly KnowledgeEdge[] };
}

/** Binds a proposal + its evaluation into a genuine `ProposalReviewVisualInput`, via the real @rvs/proposal-review adapter -- never a hand-rolled shape. Throws (fixture setup error, never a silently-passing test) if the binding is rejected. */
export function buildVisualInput(proposal: ProposedChangeSet, options: BuildVisualInputOptions = {}): ProposalReviewVisualInput {
  const evaluation = options.evaluation ?? evaluationFor(proposal);
  const observedBaselineGraph = options.observedBaselineGraph ?? baseFixtureGraph();
  const observedBaseline = options.observedBaseline ?? observedBaselineSnapshot(evaluation.base_snapshot_digest);
  const result = buildProposalReviewVisualInput({
    evaluation,
    observedBaseline,
    observedBaselineGraph,
    advisoryFreshness: "current",
    proposal,
  });
  if (result.status !== "ok") {
    throw new Error(`fixture setup error: buildProposalReviewVisualInput rejected: ${JSON.stringify(result.issues)}`);
  }
  return result.input;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === "object" || typeof value === "function") && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
