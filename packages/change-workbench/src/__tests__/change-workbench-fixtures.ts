// Shared, hand-authored, deterministic fixtures for @rvs/change-workbench's
// test suite. No Date.now()/Math.random()/argless `new Date()` anywhere in
// this file. Confirmed nodes/edges use plain, readable ids ("comp-a" etc.)
// rather than content-derived @rvs/knowledge-graph ids, since this
// package's own ref-confirmation machinery (refs.ts) only cares that an id
// string is well-formed and present in the supplied node list -- not that
// it was itself minted by knowledge-graph's own buildNodeId().

import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { buildDecisionStateLookup, KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "@rvs/knowledge-graph";
import type { DecisionStateLookup } from "@rvs/knowledge-graph";
import type { ConfirmedEntityRef } from "../contracts.js";
import { tryConfirmEntityRef } from "../refs.js";

export const REPOSITORY_ID = "fixture-repo";
export const OTHER_REPOSITORY_ID = "other-fixture-repo";
export const BASE_SNAPSHOT_DIGEST = "fixture-base-snapshot-digest-0001";

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

/** A small, connected base graph: comp-a -> comp-b -> comp-c, all in REPOSITORY_ID, plus one node in a different repository to exercise the repository-boundary invariant. */
export function baseFixtureGraph(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const compA = makeNode({ id: "comp-a", label: "Component A" });
  const compB = makeNode({ id: "comp-b", label: "Component B" });
  const compC = makeNode({ id: "comp-c", label: "Component C" });
  const otherRepoNode = makeNode({ id: "other-repo-comp", label: "Other Repo Component", repository_id: OTHER_REPOSITORY_ID });

  const edgeAB = makeEdge({ id: "edge-a-b", from_node_id: "comp-a", to_node_id: "comp-b", edge_type: "depends_on" });
  const edgeBC = makeEdge({ id: "edge-b-c", from_node_id: "comp-b", to_node_id: "comp-c", edge_type: "depends_on" });

  return { nodes: [compA, compB, compC, otherRepoNode], edges: [edgeAB, edgeBC] };
}

/**
 * Extends baseFixtureGraph() with one real `node_type: "decision"` node
 * ("decision-x") reachable from comp-b via a single edge. Every other
 * fixture graph in this suite contains zero decision-typed nodes, which
 * makes @rvs/knowledge-graph's computeDecisionImpact() structurally
 * guaranteed to return an empty findings array even though it genuinely
 * executes -- a legitimate "ran, found nothing" result, but not proof the
 * evaluator can produce a real, non-empty, non-fabricated finding when
 * genuinely exercised. This fixture (paired with decisionFixtureStateLookup
 * below) exists solely to provide that proof.
 */
export function decisionFixtureGraph(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const { nodes, edges } = baseFixtureGraph();
  const decisionNode = makeNode({ id: "decision-x", node_type: "decision", label: "Decision X", source_entity_id: "decision-x" });
  const edgeToDecision = makeEdge({ id: "edge-b-decision-x", from_node_id: "comp-b", to_node_id: "decision-x", edge_type: "depends_on" });
  return { nodes: [...nodes, decisionNode], edges: [...edges, edgeToDecision] };
}

/** A DecisionStateLookup with one real "contradicted" assumption recorded against "decision-x" -- pairs with decisionFixtureGraph(). Built via the same buildDecisionStateLookup() call sites use for real cached decision-intelligence data, not a fabricated shortcut. */
export function decisionFixtureStateLookup(): DecisionStateLookup {
  return buildDecisionStateLookup(undefined, { assumptions: [{ id: "assumption-1", decision_id: "decision-x", state: "contradicted" }] });
}

export function confirmedRef(id: string, nodes: readonly KnowledgeNode[]): ConfirmedEntityRef {
  const ref = tryConfirmEntityRef(id, nodes);
  if (!ref) throw new Error(`fixture setup error: "${id}" is not a confirmed node in the supplied fixture graph`);
  return ref;
}

/** Deterministic array shuffle by rotation -- same convention as @rvs/knowledge-graph's own `rotate()` fixture helper. */
export function rotate<T>(items: T[], shift: number): T[] {
  if (items.length === 0) return [];
  const normalizedShift = shift % items.length;
  return [...items.slice(normalizedShift), ...items.slice(0, normalizedShift)];
}
