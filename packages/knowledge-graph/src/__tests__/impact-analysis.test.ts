import { describe, it, expect } from "vitest";
import { runImpactAnalysis } from "../impact-analysis.js";
import type { ImpactQuery } from "../contracts.js";
import {
  decisionReachableFixture,
  emptyDecisionStateLookup,
  linearChainFixture,
  makeDecisionStateLookup,
  makeEdge,
  makeNode,
  unresolvedReferenceFixture,
} from "./graph-fixtures.js";

function query(overrides: Partial<ImpactQuery> & Pick<ImpactQuery, "entity_node_id">): ImpactQuery {
  return { max_depth: 10, direction: "downstream", ...overrides };
}

describe("runImpactAnalysis", () => {
  it("returns an empty result with blast_radius_level 'unresolved' when the entity does not exist", () => {
    const { nodes, edges } = linearChainFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: "graph:node:missing" }), emptyDecisionStateLookup());
    expect(result.directly_affected).toEqual([]);
    expect(result.transitively_affected).toEqual([]);
    expect(result.blast_radius_level).toBe("unresolved");
    expect(result.truncated).toBe(false);
    expect(result.unresolved_downstream_impact).toBe(false);
  });

  it("splits directly (depth 1) vs transitively (depth > 1) affected nodes, excluding the entity itself", () => {
    const { nodes, edges, a, b, c, d } = linearChainFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: a.id }), emptyDecisionStateLookup());
    expect(result.directly_affected.map((f) => f.node_id)).toEqual([b.id]);
    expect(result.transitively_affected.map((f) => f.node_id).sort()).toEqual([c.id, d.id].sort());
    expect(result.directly_affected.every((f) => f.node_id !== a.id)).toBe(true);
    expect(result.blast_radius_level).toBe("local");
  });

  it("attaches a path_id to each finding via findShortestPath", () => {
    const { nodes, edges, a, b } = linearChainFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: a.id }), emptyDecisionStateLookup());
    const directB = result.directly_affected.find((f) => f.node_id === b.id);
    expect(directB?.path_id).toBeDefined();
  });

  it("collects products_affected, capabilities_affected, and governance_findings_affected by node_type", () => {
    const entity = makeNode({ sourceEntityId: "impact-entity" });
    const capability = makeNode({ sourceEntityId: "impact-capability", nodeType: "capability", sourceArtifact: "capability" });
    const product = makeNode({ sourceEntityId: "impact-product", nodeType: "product", sourceArtifact: "product" });
    const finding = makeNode({ sourceEntityId: "impact-finding", nodeType: "governance_finding", sourceArtifact: "governance" });
    const nodes = [entity, capability, product, finding];
    const edges = [
      makeEdge({ edgeType: "depends_on", from: entity, to: capability }),
      makeEdge({ edgeType: "depends_on", from: entity, to: product }),
      makeEdge({ edgeType: "affects", from: finding, to: entity }),
    ];
    // "affects" points INTO entity, so it's only visible with direction upstream/both; use "both" to pick up all three.
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: entity.id, direction: "both" }), emptyDecisionStateLookup());
    expect(result.capabilities_affected).toEqual([capability.id]);
    expect(result.products_affected).toEqual([product.id]);
    expect(result.governance_findings_affected).toEqual([finding.id]);
    expect(result.edge_types_traversed).toEqual(["affects", "depends_on"]);
  });

  it("sets unresolved_downstream_impact when an unresolved_reference node is reached, even without truncation", () => {
    const { nodes, edges, a } = unresolvedReferenceFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: a.id }), emptyDecisionStateLookup());
    expect(result.unresolved_downstream_impact).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("sets both truncated and unresolved_downstream_impact when maxDepth truncates the traversal", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: a.id, max_depth: 1 }), emptyDecisionStateLookup());
    expect(result.truncated).toBe(true);
    expect(result.unresolved_downstream_impact).toBe(true);
  });

  it("reports decisions_affected only for decisions reached by the query's own direction, with matching assumptions_potentially_invalidated", () => {
    const { nodes, edges, entity, decision } = decisionReachableFixture();
    const lookup = makeDecisionStateLookup({
      assumptions: [{ id: "decision-alpha-assumption-1", decision_id: "decision-alpha", state: "weakened" }],
    });
    // decision --references--> entity: only reachable from entity via upstream/both, not plain downstream.
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: entity.id, direction: "upstream" }), lookup);
    expect(result.decisions_affected).toEqual([decision.id]);
    expect(result.assumptions_potentially_invalidated.length).toBe(1);
  });

  it("does not report decisions_affected when the query direction never reaches the decision node", () => {
    const { nodes, edges, entity } = decisionReachableFixture();
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: entity.id, direction: "downstream" }), emptyDecisionStateLookup());
    expect(result.decisions_affected).toEqual([]);
  });

  it("collects deduplicated evidence_refs from directly-traversed edges only", () => {
    const entity = makeNode({ sourceEntityId: "evidence-entity" });
    const neighbor = makeNode({ sourceEntityId: "evidence-neighbor" });
    const ref = { path: "packages/example/src/foo.ts", source_artifact: "architecture" as const };
    const nodes = [entity, neighbor];
    const edges = [makeEdge({ edgeType: "depends_on", from: entity, to: neighbor, evidenceRefs: [ref, ref] })];
    const result = runImpactAnalysis(nodes, edges, query({ entity_node_id: entity.id }), emptyDecisionStateLookup());
    expect(result.evidence_refs).toEqual([ref]);
  });

  it("filters traversal by allowed_edge_types", () => {
    const { nodes, edges, repo, a } = linearChainFixture();
    const result = runImpactAnalysis(
      nodes,
      edges,
      query({ entity_node_id: repo.id, allowed_edge_types: ["depends_on"] }),
      emptyDecisionStateLookup(),
    );
    expect(result.directly_affected.map((f) => f.node_id)).not.toContain(a.id);
  });

  it("is deterministic for the same query (same id, same field values) across repeated calls", () => {
    const { nodes, edges, a } = linearChainFixture();
    const q = query({ entity_node_id: a.id });
    const first = runImpactAnalysis(nodes, edges, q, emptyDecisionStateLookup());
    const second = runImpactAnalysis(nodes, edges, q, emptyDecisionStateLookup());
    expect(first).toEqual(second);
  });
});
