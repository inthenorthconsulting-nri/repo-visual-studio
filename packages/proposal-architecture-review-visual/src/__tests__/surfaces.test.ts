// Behavioral certification for the three-surface adaptation (Milestone
// 11.3.3.2B, §17-§19, §55-§76).

import { describe, expect, it } from "vitest";
import { buildProposalArchitectureVisualReview } from "../compose.js";
import { adaptProjectedState } from "../adapt-projected.js";
import { PROJECTED_PROVENANCE_MARKER_KEYS, PROJECTED_PROVENANCE_UNRESOLVED_MARKER_KEY } from "../provenance-marker.js";
import { BASELINE_EDGE_AB, BASELINE_NODE_A, BASELINE_NODE_B, OBSERVED_BASELINE, buildFixtureModel, kEdge, kNode } from "./fixtures.js";
import type { OverlayEntityProvenance, RemoveEntityOperation } from "@rvs/change-workbench";

describe("surface separation", () => {
  it("Observed Baseline is graph-shaped and carries no per-entity semantic markers", () => {
    const review = buildProposalArchitectureVisualReview(buildFixtureModel());
    expect(review.observed_baseline.model.nodes).toHaveLength(3);
    expect(review.observed_baseline.model.edges).toHaveLength(1);
    for (const node of review.observed_baseline.model.nodes) expect(node.semantic_markers).toBeUndefined();
    for (const edge of review.observed_baseline.model.edges) expect(edge.semantic_markers).toBeUndefined();
  });

  it("Proposed Delta is an ordered array of operation cards, never graph-shaped", () => {
    const review = buildProposalArchitectureVisualReview(buildFixtureModel());
    expect(Array.isArray(review.proposed_delta.operations)).toBe(true);
    expect("nodes" in review.proposed_delta).toBe(false);
    expect(review.proposed_delta.operations).toHaveLength(6);
  });

  it("preserves the caller's exact original operation order in the Proposed Delta surface", () => {
    const review = buildProposalArchitectureVisualReview(buildFixtureModel());
    expect(review.proposed_delta.operations.map((op) => op.kind)).toEqual(["add_entity", "remove_entity", "modify_attributes", "add_relation", "remove_relation", "modify_relation"]);
    expect(review.proposed_delta.operations.map((op) => op.operation_index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("truth_disclosure, baseline_binding, and advisory pass through by reference, unmodified", () => {
    const model = buildFixtureModel();
    const review = buildProposalArchitectureVisualReview(model);
    expect(review.truth_disclosure).toBe(model.truth_disclosure);
    expect(review.baseline_binding).toBe(model.baseline_binding);
    expect(review.advisory).toBe(model.advisory);
  });
});

describe("Projected State: not_built", () => {
  it("upstream not_built outcome produces { status: not_built } with the upstream reason, never a fabricated empty graph", () => {
    const result = adaptProjectedState({ status: "not_built", reason: "proposal validation was invalid" });
    expect(result).toEqual({ status: "not_built", reason: "proposal validation was invalid" });
  });

  it("an attempted but invalid overlay build also produces not_built, distinct from a fabricated empty graph", () => {
    const result = adaptProjectedState({ status: "built", result: { status: "invalid", issues: [{ code: "x", detail: "x", blocking: true }] } });
    expect(result.status).toBe("not_built");
  });
});

describe("Projected State: built", () => {
  const nodeProvenance: Record<string, OverlayEntityProvenance> = { "node-a": "confirmed", "node-b": "modified", "proposed-x": "proposed" };
  const edgeProvenance: Record<string, OverlayEntityProvenance> = { "node-a:depends_on:proposed-x": "proposed" };
  const overlay = {
    repository_id: "repo-1",
    base_snapshot_digest: "digest-1",
    nodes: [BASELINE_NODE_A, { ...BASELINE_NODE_B, label: "Service B (renamed)" }, kNode({ id: "proposed-x", label: "Service X" })],
    edges: [kEdge({ id: "synthetic-edge", from_node_id: "node-a", to_node_id: "proposed-x", edge_type: "depends_on" })],
    node_provenance: nodeProvenance,
    edge_provenance: edgeProvenance,
  };

  it("attaches exactly one provenance marker per node/edge, matching the overlay's own provenance record", () => {
    const result = adaptProjectedState({ status: "built", result: { status: "ok", overlay, issues: [] } });
    expect(result.status).toBe("built");
    if (result.status !== "built") throw new Error("unreachable");
    const byId = new Map(result.model.nodes.map((n) => [n.source_entity_id, n]));
    expect(byId.get("node-a")?.semantic_markers).toEqual([{ key: PROJECTED_PROVENANCE_MARKER_KEYS.confirmed, label: expect.any(String) }]);
    expect(byId.get("node-b")?.semantic_markers).toEqual([{ key: PROJECTED_PROVENANCE_MARKER_KEYS.modified, label: expect.any(String) }]);
    expect(byId.get("proposed-x")?.semantic_markers).toEqual([{ key: PROJECTED_PROVENANCE_MARKER_KEYS.proposed, label: expect.any(String) }]);
    expect(result.model.edges[0]?.semantic_markers).toEqual([{ key: PROJECTED_PROVENANCE_MARKER_KEYS.proposed, label: expect.any(String) }]);
  });

  it("a node/edge present in the overlay but missing from the provenance record gets the explicit unresolved marker, never a silent confirmed default", () => {
    const overlayMissingProvenance = { ...overlay, node_provenance: {} };
    const result = adaptProjectedState({ status: "built", result: { status: "ok", overlay: overlayMissingProvenance, issues: [] } });
    if (result.status !== "built") throw new Error("unreachable");
    for (const node of result.model.nodes) {
      expect(node.semantic_markers).toEqual([{ key: PROJECTED_PROVENANCE_UNRESOLVED_MARKER_KEY, label: expect.any(String) }]);
    }
  });

  it("a built overlay with zero nodes/edges (built-empty) is structurally distinct from not_built", () => {
    const emptyOverlay = { ...overlay, nodes: [], edges: [], node_provenance: {}, edge_provenance: {} };
    const result = adaptProjectedState({ status: "built", result: { status: "ok", overlay: emptyOverlay, issues: [] } });
    expect(result).toEqual({ status: "built", model: expect.objectContaining({ nodes: [], edges: [] }) });
  });

  it("removed entities never appear in the built graph (absent by construction, not hidden by a marker)", () => {
    const result = adaptProjectedState({ status: "built", result: { status: "ok", overlay, issues: [] } });
    if (result.status !== "built") throw new Error("unreachable");
    expect(result.model.nodes.find((n) => n.source_entity_id === "node-c")).toBeUndefined();
  });
});

describe("all six ProposalOperation kinds produce the expected Proposed Delta card shape", () => {
  const review = buildProposalArchitectureVisualReview(buildFixtureModel());
  const [addEntity, removeEntity, modifyAttributes, addRelation, removeRelation, modifyRelation] = review.proposed_delta.operations;

  it("add_entity: no baseline lookup needed, carries ref/node_type/label verbatim", () => {
    expect(addEntity).toMatchObject({ kind: "add_entity", ref: "proposed-x", node_type: "component", label: "Service X" });
  });

  it("remove_entity: subject resolved from the confirmed baseline", () => {
    expect(removeEntity).toMatchObject({ kind: "remove_entity", subject: { ref: "node-c", source: "resolved_baseline", label: "Service C" } });
  });

  it("modify_attributes: subject resolved, changes classify supported vs. unresolved keys, before/after correct", () => {
    if (modifyAttributes.kind !== "modify_attributes") throw new Error("unreachable");
    expect(modifyAttributes.subject).toMatchObject({ ref: "node-a", source: "resolved_baseline", label: "Service A" });
    const labelChange = modifyAttributes.changes.find((c) => c.key === "label");
    expect(labelChange).toMatchObject({ status: "supported", before: "Service A", after: "Service A2" });
    const unknownChange = modifyAttributes.changes.find((c) => c.key === "not_a_real_field");
    expect(unknownChange).toMatchObject({ status: "unresolved", before: undefined, after: 1 });
  });

  it("add_relation: endpoint resolved_proposed when it references this proposal's own add_entity ref", () => {
    expect(addRelation).toMatchObject({
      kind: "add_relation",
      from: { ref: "node-a", source: "resolved_baseline" },
      to: { ref: "proposed-x", source: "resolved_proposed", label: "Service X" },
      edge_type: "depends_on",
    });
  });

  it("remove_relation: both endpoints resolved from the confirmed baseline", () => {
    expect(removeRelation).toMatchObject({
      kind: "remove_relation",
      from: { ref: "node-a", source: "resolved_baseline" },
      to: { ref: "node-b", source: "resolved_baseline" },
      edge_type: "depends_on",
    });
  });

  it("modify_relation: before value recovered from the matching baseline edge, unsupported identity key disclosed", () => {
    if (modifyRelation.kind !== "modify_relation") throw new Error("unreachable");
    const detailChange = modifyRelation.changes.find((c) => c.key === "detail");
    expect(detailChange).toMatchObject({ status: "supported", before: BASELINE_EDGE_AB.detail, after: "now async" });
    const identityChange = modifyRelation.changes.find((c) => c.key === "identity");
    expect(identityChange?.status).toBe("unresolved");
  });

  it("an unresolved endpoint/subject ref (not in baseline or this proposal's own add_entity set) is disclosed as unresolved, never guessed", () => {
    const model = buildFixtureModel({ proposed_delta: { operations: [{ kind: "remove_entity", ref: "does-not-exist", detail: "x" } as unknown as RemoveEntityOperation] } });
    const review = buildProposalArchitectureVisualReview(model);
    expect(review.proposed_delta.operations[0]).toMatchObject({ subject: { ref: "does-not-exist", source: "unresolved" } });
  });
});

describe("determinism", () => {
  it("building the same model twice produces structurally identical output", () => {
    const model = buildFixtureModel();
    const a = buildProposalArchitectureVisualReview(model);
    const b = buildProposalArchitectureVisualReview(model);
    expect(a).toEqual(b);
  });

  it("ids are a pure function of content, not of call order or incidental object identity", () => {
    const first = buildProposalArchitectureVisualReview(buildFixtureModel());
    const second = buildProposalArchitectureVisualReview(buildFixtureModel());
    expect(first.id).toBe(second.id);
    expect(first.proposed_delta.operations.map((o) => o.id)).toEqual(second.proposed_delta.operations.map((o) => o.id));
  });
});

describe("Observed Baseline never fabricates entities not present in the input graph", () => {
  it("adapts exactly OBSERVED_BASELINE's own nodes/edges, one-to-one", () => {
    const review = buildProposalArchitectureVisualReview(buildFixtureModel());
    expect(review.observed_baseline.model.nodes.map((n) => n.source_entity_id).sort()).toEqual(OBSERVED_BASELINE.nodes.map((n) => n.id).sort());
  });
});
