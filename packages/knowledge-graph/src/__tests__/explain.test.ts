import { describe, it, expect } from "vitest";
import { explainGraphId, type GraphExplainContext } from "../explain.js";
import { linearChainFixture } from "./graph-fixtures.js";

describe("explainGraphId", () => {
  it("resolves a node id first, before checking any other id space", () => {
    const { nodes, edges, a } = linearChainFixture();
    const context: GraphExplainContext = { nodes, edges };
    const result = explainGraphId(a.id, context);
    expect(result.resolved).toBe(a);
    expect(result.explanation).toContain(a.id);
    expect(result.explanation).toContain(a.label);
  });

  it("resolves an edge id when no node matches", () => {
    const { nodes, edges } = linearChainFixture();
    const edge = edges[0]!;
    const result = explainGraphId(edge.id, { nodes: [], edges });
    expect(result.resolved).toBe(edge);
    expect(result.explanation).toContain(edge.edge_type);
    void nodes;
  });

  it("resolves a path id when no node or edge matches", () => {
    const path = { id: "graph:path:a:b:a.b", from_node_id: "graph:node:a", to_node_id: "graph:node:b", node_ids: ["graph:node:a", "graph:node:b"], edge_ids: ["graph:edge:a:depends_on:b"], length: 1 };
    const result = explainGraphId(path.id, { paths: [path] });
    expect(result.resolved).toBe(path);
    expect(result.explanation).toContain("spans 1 edge");
  });

  it("resolves an impact-result id when nothing earlier in the search order matches", () => {
    const impactResult = {
      id: "graph:impact:x:y",
      schema_version: 1,
      query: { entity_node_id: "graph:node:x", max_depth: 5, direction: "downstream" as const },
      directly_affected: [],
      transitively_affected: [],
      blast_radius_level: "local" as const,
      edge_types_traversed: [],
      products_affected: [],
      capabilities_affected: [],
      decisions_affected: [],
      governance_findings_affected: [],
      assumptions_potentially_invalidated: [],
      unresolved_downstream_impact: false,
      truncated: false,
      evidence_refs: [],
    };
    const result = explainGraphId(impactResult.id, { impactResults: [impactResult] });
    expect(result.resolved).toBe(impactResult);
    expect(result.explanation).toContain("blast radius");
  });

  it("resolves a root-cause-group id when nothing earlier matches", () => {
    const group = {
      id: "graph:root-cause:x",
      schema_version: 1,
      finding_node_ids: ["graph:node:f1"],
      candidate_root_node_ids: ["graph:node:x"],
      classification: "confirmed" as const,
      detail: "detail text",
      evidence_refs: [],
    };
    const result = explainGraphId(group.id, { rootCauseGroups: [group] });
    expect(result.resolved).toBe(group);
    expect(result.explanation).toContain("confirmed");
  });

  it("resolves a decision-impact id when nothing earlier matches", () => {
    const entry = {
      id: "graph:decision-impact:x:y",
      schema_version: 1,
      decision_node_id: "graph:node:decision",
      target_entity_node_id: "graph:node:x",
      state: "review_required" as const,
      detail: "review needed",
      evidence_refs: [],
    };
    const result = explainGraphId(entry.id, { decisionImpacts: [entry] });
    expect(result.resolved).toBe(entry);
    expect(result.explanation).toContain("review_required");
  });

  it("resolves a change-plan id when nothing earlier matches", () => {
    const plan = {
      id: "graph:change-plan:x",
      schema_version: 1,
      removed_entity_node_id: "graph:node:x",
      affected_node_ids: [],
      decisions_requiring_review: [],
      governance_requiring_review: [],
      tests_likely_affected: [],
      docs_likely_affected: [],
      presentation_likely_affected: [],
      suggested_validation_commands: [],
      baselines_requiring_review: [],
      unknown_consumers: [],
      evidence_refs: [],
    };
    const result = explainGraphId(plan.id, { changePlans: [plan] });
    expect(result.resolved).toBe(plan);
    expect(result.explanation).toContain(plan.removed_entity_node_id);
  });

  it("throws a descriptive error naming every id space tried when nothing resolves", () => {
    expect(() => explainGraphId("graph:node:does-not-exist", {})).toThrowError(/No node, edge, path, impact-result, root-cause-group, decision-impact, or change-plan/);
  });

  it("prefers a node over an edge/path/etc. sharing the same literal id string", () => {
    const { nodes, a } = linearChainFixture();
    const collidingEdge = { id: a.id, edge_type: "depends_on" as const, from_node_id: "x", to_node_id: "y", direction: "directed" as const, evidence_refs: [], resolution_status: "resolved" as const, detail: "d" };
    const result = explainGraphId(a.id, { nodes, edges: [collidingEdge] });
    expect(result.resolved).toBe(a);
  });
});
