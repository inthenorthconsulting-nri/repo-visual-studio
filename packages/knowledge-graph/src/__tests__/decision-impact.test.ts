import { describe, it, expect } from "vitest";
import {
  assumptionNodeIdsPotentiallyInvalidated,
  buildDecisionStateLookup,
  classifyReachedDecisionImpact,
  computeDecisionImpact,
  type DecisionStateLookup,
} from "../decision-impact.js";
import { buildDecisionImpactId, buildNodeId } from "../ids.js";
import { decisionReachableFixture, emptyDecisionStateLookup, makeDecisionStateLookup } from "./graph-fixtures.js";

describe("buildDecisionStateLookup", () => {
  it("builds decision and assumption maps from raw artifacts", () => {
    const lookup = buildDecisionStateLookup(
      { decisions: [{ id: "d1", decision_status: "active", implementation_status: "done" }] },
      { assumptions: [{ id: "a1", decision_id: "d1", state: "confirmed" }] },
    );
    expect(lookup.decisionByDecisionId.get("d1")).toEqual({ decision_status: "active", implementation_status: "done" });
    expect(lookup.assumptionsByDecisionId.get("d1")).toEqual([{ id: "a1", state: "confirmed" }]);
  });

  it("handles undefined inputs by producing empty maps", () => {
    const lookup = buildDecisionStateLookup(undefined, undefined);
    expect(lookup.decisionByDecisionId.size).toBe(0);
    expect(lookup.assumptionsByDecisionId.size).toBe(0);
  });
});

describe("classifyReachedDecisionImpact", () => {
  function classify(lookup: DecisionStateLookup): ReturnType<typeof classifyReachedDecisionImpact> {
    return classifyReachedDecisionImpact({ decisionSourceEntityId: "d1", lookup, reachedViaEdgeTypes: ["references"] });
  }

  it("returns 'unverifiable' when there is no decision state and no assumptions at all", () => {
    expect(classify(emptyDecisionStateLookup())).toBe("unverifiable");
  });

  it("returns 'superseded' when decision_status is 'superseded', taking precedence over assumption states", () => {
    const lookup = makeDecisionStateLookup({
      decisions: [{ id: "d1", decision_status: "superseded" }],
      assumptions: [{ id: "a1", decision_id: "d1", state: "contradicted" }],
    });
    expect(classify(lookup)).toBe("superseded");
  });

  it("returns 'assumption_contradicted' when an assumption is contradicted (and decision is not superseded)", () => {
    const lookup = makeDecisionStateLookup({
      decisions: [{ id: "d1", decision_status: "active" }],
      assumptions: [{ id: "a1", decision_id: "d1", state: "contradicted" }],
    });
    expect(classify(lookup)).toBe("assumption_contradicted");
  });

  it("returns 'assumption_weakened' when an assumption is weakened, ahead of implementation_invalidated", () => {
    const lookup = makeDecisionStateLookup({
      decisions: [{ id: "d1", implementation_status: "broken" }],
      assumptions: [{ id: "a1", decision_id: "d1", state: "weakened" }],
    });
    expect(classify(lookup)).toBe("assumption_weakened");
  });

  it("returns 'implementation_invalidated' for implementation_status 'invalidated' or 'broken'", () => {
    expect(classify(makeDecisionStateLookup({ decisions: [{ id: "d1", implementation_status: "invalidated" }] }))).toBe(
      "implementation_invalidated",
    );
    expect(classify(makeDecisionStateLookup({ decisions: [{ id: "d1", implementation_status: "broken" }] }))).toBe(
      "implementation_invalidated",
    );
  });

  it("returns 'unverifiable' when an assumption state is itself 'unverifiable'", () => {
    const lookup = makeDecisionStateLookup({
      decisions: [{ id: "d1", implementation_status: "done" }],
      assumptions: [{ id: "a1", decision_id: "d1", state: "unverifiable" }],
    });
    expect(classify(lookup)).toBe("unverifiable");
  });

  it("returns 'review_required' when nothing else matches", () => {
    const lookup = makeDecisionStateLookup({
      decisions: [{ id: "d1", decision_status: "active", implementation_status: "done" }],
      assumptions: [{ id: "a1", decision_id: "d1", state: "confirmed" }],
    });
    expect(classify(lookup)).toBe("review_required");
  });
});

describe("assumptionNodeIdsPotentiallyInvalidated", () => {
  it("returns node ids for assumptions in 'weakened' or 'contradicted' state that are present in the graph", () => {
    const lookup = makeDecisionStateLookup({
      assumptions: [
        { id: "assumption-a", decision_id: "d1", state: "weakened" },
        { id: "assumption-b", decision_id: "d1", state: "contradicted" },
        { id: "assumption-c", decision_id: "d1", state: "confirmed" },
      ],
    });
    const nodeIds = new Set([buildNodeId("assumption-a"), buildNodeId("assumption-b"), buildNodeId("assumption-c")]);
    const result = assumptionNodeIdsPotentiallyInvalidated("d1", lookup, nodeIds);
    expect(result).toEqual([buildNodeId("assumption-a"), buildNodeId("assumption-b")].sort());
  });

  it("filters out assumption node ids not present in the graph's node id set", () => {
    const lookup = makeDecisionStateLookup({ assumptions: [{ id: "assumption-a", decision_id: "d1", state: "weakened" }] });
    const result = assumptionNodeIdsPotentiallyInvalidated("d1", lookup, new Set());
    expect(result).toEqual([]);
  });

  it("returns an empty array when the decision has no assumptions at all", () => {
    const result = assumptionNodeIdsPotentiallyInvalidated("d1", emptyDecisionStateLookup(), new Set());
    expect(result).toEqual([]);
  });
});

describe("computeDecisionImpact", () => {
  it("finds a decision reachable via a 'both'-direction traversal from the target entity", () => {
    const { nodes, edges, entity, decision } = decisionReachableFixture();
    const entries = computeDecisionImpact(nodes, edges, entity.id, emptyDecisionStateLookup());
    expect(entries.length).toBe(1);
    expect(entries[0]?.decision_node_id).toBe(decision.id);
    expect(entries[0]?.target_entity_node_id).toBe(entity.id);
    expect(entries[0]?.id).toBe(buildDecisionImpactId(decision.id, entity.id));
    expect(entries[0]?.state).toBe("unverifiable");
  });

  it("includes a human-readable detail mentioning the reached edge type", () => {
    const { nodes, edges, entity } = decisionReachableFixture();
    const entries = computeDecisionImpact(nodes, edges, entity.id, emptyDecisionStateLookup());
    expect(entries[0]?.detail).toContain("references");
  });

  it("returns an empty array when no decision node is reachable", () => {
    const entity = decisionReachableFixture().entity;
    const entries = computeDecisionImpact([entity], [], entity.id, emptyDecisionStateLookup());
    expect(entries).toEqual([]);
  });

  it("reflects the decision's classified state from the lookup", () => {
    const { nodes, edges, entity, decision } = decisionReachableFixture();
    const lookup = makeDecisionStateLookup({ decisions: [{ id: decision.source_entity_id, decision_status: "superseded" }] });
    const entries = computeDecisionImpact(nodes, edges, entity.id, lookup);
    expect(entries[0]?.state).toBe("superseded");
  });

  it("returns entries sorted by decision_node_id", () => {
    const { nodes, edges, entity } = decisionReachableFixture();
    const entries = computeDecisionImpact(nodes, edges, entity.id, emptyDecisionStateLookup());
    const ids = entries.map((e) => e.decision_node_id);
    expect(ids).toEqual([...ids].sort());
  });
});
