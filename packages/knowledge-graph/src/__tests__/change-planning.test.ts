import { describe, it, expect } from "vitest";
import { planChange } from "../change-planning.js";
import { buildChangePlanId } from "../ids.js";
import { emptyDecisionStateLookup, evidencePathFixture, isolatedNodeFixture } from "./graph-fixtures.js";

describe("planChange", () => {
  it("classifies downstream evidence by test/docs/presentation path pattern", () => {
    const fixture = evidencePathFixture();
    const plan = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());

    expect(plan.id).toBe(buildChangePlanId(fixture.root.id));
    expect(plan.removed_entity_node_id).toBe(fixture.root.id);
    expect(plan.tests_likely_affected).toEqual(fixture.testEvidence.evidence_refs);
    expect(plan.docs_likely_affected).toEqual(fixture.docsEvidence.evidence_refs);
    expect(plan.presentation_likely_affected).toEqual(fixture.presentationEvidence.evidence_refs);
  });

  it("flags baselines reached via a 'governs' edge from any considered node as requiring review", () => {
    const fixture = evidencePathFixture();
    const plan = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    expect(plan.baselines_requiring_review).toEqual([fixture.baseline.id]);
  });

  it("reports unresolved_reference nodes reached by the impact analysis as unknown_consumers", () => {
    const fixture = evidencePathFixture();
    const plan = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    expect(plan.unknown_consumers).toEqual([fixture.unresolvedConsumer.id]);
  });

  it("derives suggested_validation_commands from the distinct node types of the removed entity + affected nodes", () => {
    const fixture = evidencePathFixture();
    const plan = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    expect(plan.suggested_validation_commands).toEqual(["rvs synthesize architecture", "rvs synthesize capabilities"]);
  });

  it("includes the removed entity's own transitively-affected downstream nodes in affected_node_ids, sorted", () => {
    const fixture = evidencePathFixture();
    const plan = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    expect(plan.affected_node_ids).toEqual([...plan.affected_node_ids].sort());
    expect(plan.affected_node_ids).toContain(fixture.capability.id);
    expect(plan.affected_node_ids).toContain(fixture.baseline.id);
  });

  it("produces empty affected/likely-affected lists for a node with no downstream edges", () => {
    const { nodes, solo } = isolatedNodeFixture();
    const plan = planChange(nodes, [], solo.id, emptyDecisionStateLookup());
    expect(plan.affected_node_ids).toEqual([]);
    expect(plan.tests_likely_affected).toEqual([]);
    expect(plan.docs_likely_affected).toEqual([]);
    expect(plan.presentation_likely_affected).toEqual([]);
    expect(plan.baselines_requiring_review).toEqual([]);
    expect(plan.unknown_consumers).toEqual([]);
    expect(plan.decisions_requiring_review).toEqual([]);
    expect(plan.governance_requiring_review).toEqual([]);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const fixture = evidencePathFixture();
    const first = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    const second = planChange(fixture.nodes, fixture.edges, fixture.root.id, emptyDecisionStateLookup());
    expect(first).toEqual(second);
  });
});
