// Core behavioral proof for composeProposalArchitectureReviewModel()
// (Milestone 11.3.3.1). Covers: three-surface truth for added/removed/
// modified entities and relations, the no-rename rule, the
// not_built/built-empty/built-non-empty projection distinction, truth
// disclosure / baseline binding / advisory pass-through, input
// immutability, and determinism.

import { describe, expect, it } from "vitest";
import { composeProposedChangeSet, mutateExistingEntityRef, proposeEntityRef, tryConfirmEntityRef } from "@rvs/change-workbench";
import type { ConfirmedEntityRef, ProposalOperation, ProposedEntityRef } from "@rvs/change-workbench";

import { composeProposalArchitectureReviewModel } from "../compose.js";
import {
  addEntityProposal,
  baseFixtureGraph,
  buildVisualInput,
  deepFreeze,
  emptyBuiltEvaluation,
  emptyObservedBaselineSnapshot,
  emptyProposal,
  invalidProposal,
  mixedProposal,
  modifyRelationProposal,
  REPOSITORY_ID,
  removeRelationProposal,
} from "./fixtures.js";

function confirmedRef(id: string): ConfirmedEntityRef {
  const ref = tryConfirmEntityRef(id, baseFixtureGraph().nodes);
  if (!ref) throw new Error(`fixture setup error: "${id}" not confirmed`);
  return ref;
}

describe("composeProposalArchitectureReviewModel: Observed Baseline", () => {
  it("is the exact input.observed_baseline_graph object reference, unmodified", () => {
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.observed_baseline).toBe(input.observed_baseline_graph);
    expect(model.observed_baseline.nodes.map((n) => n.id).sort()).toEqual(["comp-a", "comp-b", "comp-c"]);
  });

  it("never contains a proposal-added entity", () => {
    const newRef = proposeEntityRef("par-fixture", "new-1");
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.observed_baseline.nodes.some((n) => n.id === newRef)).toBe(false);
  });
});

describe("composeProposalArchitectureReviewModel: Proposed Delta", () => {
  it("preserves proposal.operations exactly, operation-shaped (not a graph), in original order", () => {
    const proposal = addEntityProposal();
    const input = buildVisualInput(proposal);
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.proposed_delta.operations).toBe(input.proposal.operations);
    expect(model.proposed_delta.operations.map((op) => op.kind)).toEqual(["add_entity", "add_relation"]);
  });

  it("modify_attributes carries only the caller-supplied changed attributes, never enriched with unchanged fields", () => {
    const input = buildVisualInput(mixedProposal());
    const model = composeProposalArchitectureReviewModel(input);
    const op = model.proposed_delta.operations.find((o) => o.kind === "modify_attributes");
    expect(op).toBeDefined();
    if (op?.kind === "modify_attributes") {
      expect(op.attributes).toEqual({ label: "Renamed B" });
    }
  });

  it("modify_relation carries only the caller-supplied changed attributes", () => {
    const input = buildVisualInput(modifyRelationProposal());
    const model = composeProposalArchitectureReviewModel(input);
    const op = model.proposed_delta.operations.find((o) => o.kind === "modify_relation");
    expect(op).toBeDefined();
    if (op?.kind === "modify_relation") {
      expect(op.attributes).toEqual({ detail: "critical dependency" });
    }
  });
});

describe("composeProposalArchitectureReviewModel: Projected State", () => {
  it("not_built: preserves the explicit unavailable state and upstream reason, never a fabricated empty graph", () => {
    const input = buildVisualInput(invalidProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.projected_state.status).toBe("not_built");
    if (model.projected_state.status === "not_built") {
      expect(typeof model.projected_state.reason).toBe("string");
      expect(model.projected_state.reason.length).toBeGreaterThan(0);
    }
    expect((model.projected_state as { result?: unknown }).result).toBeUndefined();
  });

  it("built-empty: a genuinely empty overlay is structurally distinct from not_built", () => {
    const proposal = emptyProposal();
    const evaluation = emptyBuiltEvaluation(proposal);
    const input = buildVisualInput(proposal, { evaluation, observedBaseline: emptyObservedBaselineSnapshot(), observedBaselineGraph: { nodes: [], edges: [] } });
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.projected_state.status).toBe("built");
    if (model.projected_state.status === "built") {
      expect(model.projected_state.result.status).toBe("ok");
      expect(model.projected_state.result.overlay?.nodes).toEqual([]);
      expect(model.projected_state.result.overlay?.edges).toEqual([]);
    }
    // No caller should need to infer built-empty vs not_built from array lengths -- the outer discriminant alone must prove it.
    expect(model.projected_state.status).not.toBe("not_built");
  });

  it("built-non-empty: projected graph content comes only from the upstream projection, never rebuilt here", () => {
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.projected_state).toBe(input.projection);
    expect(model.projected_state.status).toBe("built");
  });
});

describe("composeProposalArchitectureReviewModel: added/removed/modified entity semantics", () => {
  it("added entity: absent from Observed Baseline, present in Proposed Delta, present in Projected State when built", () => {
    const newRef = proposeEntityRef("par-fixture", "new-1");
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);

    expect(model.observed_baseline.nodes.some((n) => n.id === newRef)).toBe(false);
    expect(model.proposed_delta.operations.some((op) => op.kind === "add_entity" && op.ref === newRef)).toBe(true);
    if (model.projected_state.status === "built") {
      expect(model.projected_state.result.overlay?.nodes.some((n) => n.id === newRef)).toBe(true);
      expect(model.projected_state.result.overlay?.node_provenance[newRef]).toBe("proposed");
    }
  });

  it("removed entity: present in Observed Baseline, referenced in Proposed Delta, absent from Projected State's node list (no tombstone reinsertion)", () => {
    const input = buildVisualInput(mixedProposal());
    const model = composeProposalArchitectureReviewModel(input);

    expect(model.observed_baseline.nodes.some((n) => n.id === "comp-c")).toBe(true);
    expect(model.proposed_delta.operations.some((op) => op.kind === "remove_entity" && op.ref === "comp-c")).toBe(true);
    if (model.projected_state.status === "built") {
      expect(model.projected_state.result.overlay?.nodes.some((n) => n.id === "comp-c")).toBe(false);
      // The removal intent stays visible via provenance, but this is not the node reappearing.
      expect(model.projected_state.result.overlay?.node_provenance["comp-c"]).toBe("removed");
    }
  });

  it("modified entity: Observed Baseline holds the pre-value, Proposed Delta holds only the caller-requested change, Projected State holds the deterministic post-value", () => {
    const input = buildVisualInput(mixedProposal());
    const model = composeProposalArchitectureReviewModel(input);

    const before = model.observed_baseline.nodes.find((n) => n.id === "comp-b");
    expect(before?.label).toBe("Component B");

    const op = model.proposed_delta.operations.find((o) => o.kind === "modify_attributes");
    expect(op && op.kind === "modify_attributes" ? op.attributes : undefined).toEqual({ label: "Renamed B" });

    if (model.projected_state.status === "built") {
      const after = model.projected_state.result.overlay?.nodes.find((n) => n.id === "comp-b");
      expect(after?.label).toBe("Renamed B");
      expect(model.projected_state.result.overlay?.node_provenance["comp-b"]).toBe("modified");
    }
  });
});

describe("composeProposalArchitectureReviewModel: relation semantics", () => {
  it("removed relation: present in Observed Baseline's edges, referenced in Proposed Delta, absent from Projected State's edge list", () => {
    const input = buildVisualInput(removeRelationProposal());
    const model = composeProposalArchitectureReviewModel(input);

    expect(model.observed_baseline.edges.some((e) => e.from_node_id === "comp-a" && e.to_node_id === "comp-b")).toBe(true);
    expect(model.proposed_delta.operations.some((op) => op.kind === "remove_relation")).toBe(true);
    if (model.projected_state.status === "built") {
      expect(model.projected_state.result.overlay?.edges.some((e) => e.from_node_id === "comp-a" && e.to_node_id === "comp-b")).toBe(false);
    }
  });

  it("modified relation: pre-value in Observed Baseline, caller-requested change only in Proposed Delta, deterministic post-value in Projected State", () => {
    const input = buildVisualInput(modifyRelationProposal());
    const model = composeProposalArchitectureReviewModel(input);

    const before = model.observed_baseline.edges.find((e) => e.from_node_id === "comp-a" && e.to_node_id === "comp-b");
    expect(before?.detail).toBe("");

    if (model.projected_state.status === "built") {
      const after = model.projected_state.result.overlay?.edges.find((e) => e.from_node_id === "comp-a" && e.to_node_id === "comp-b");
      expect(after?.detail).toBe("critical dependency");
    }
  });
});

describe("composeProposalArchitectureReviewModel: identity/rename rule", () => {
  it("remove_entity + add_entity with a similar label stays two distinct operations -- no rename/replacement inference", () => {
    const newRef: ProposedEntityRef = proposeEntityRef("par-fixture", "replacement-c");
    const operations: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c")) },
      { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "replacement-c", label: "Component C", repository_id: REPOSITORY_ID },
    ];
    const proposal = composeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
    const input = buildVisualInput(proposal);
    const model = composeProposalArchitectureReviewModel(input);

    expect(model.proposed_delta.operations).toHaveLength(2);
    expect(model.proposed_delta.operations.map((op) => op.kind)).toEqual(["remove_entity", "add_entity"]);
    // No operation kind in this union is "rename"/"move"/"replace" -- the type system itself forbids fabricating one.
    for (const op of model.proposed_delta.operations) {
      expect(["add_entity", "remove_entity", "modify_attributes", "add_relation", "remove_relation", "modify_relation"]).toContain(op.kind);
    }

    if (model.projected_state.status === "built") {
      expect(model.projected_state.result.overlay?.nodes.some((n) => n.id === "comp-c")).toBe(false);
      expect(model.projected_state.result.overlay?.nodes.some((n) => n.id === newRef)).toBe(true);
      expect(model.projected_state.result.overlay?.node_provenance["comp-c"]).toBe("removed");
      expect(model.projected_state.result.overlay?.node_provenance[newRef]).toBe("proposed");
    }
  });
});

describe("composeProposalArchitectureReviewModel: truth disclosure / baseline binding / advisory pass-through", () => {
  it("truth_disclosure is the exact input.truth_disclosure object reference", () => {
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.truth_disclosure).toBe(input.truth_disclosure);
  });

  it("baseline_binding is the exact input.baseline_binding object reference, kept separate from truth_disclosure", () => {
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.baseline_binding).toBe(input.baseline_binding);
    expect(model.baseline_binding).not.toBe(model.truth_disclosure as unknown);
  });

  it("advisory is the exact input.advisory object reference; its basis remains proposal, not observed", () => {
    const input = buildVisualInput(addEntityProposal());
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.advisory).toBe(input.advisory);
    expect(model.advisory.proposal_id).toBe(input.proposal_id);
  });
});

describe("composeProposalArchitectureReviewModel: input immutability", () => {
  it("does not mutate a deep-frozen input", () => {
    const input = deepFreeze(buildVisualInput(mixedProposal()));
    expect(() => composeProposalArchitectureReviewModel(input)).not.toThrow();
    const model = composeProposalArchitectureReviewModel(input);
    expect(model.observed_baseline).toBe(input.observed_baseline_graph);
  });
});

describe("composeProposalArchitectureReviewModel: determinism", () => {
  it("the same input produces a byte-identical result across repeated calls", () => {
    const input = buildVisualInput(mixedProposal());
    const first = composeProposalArchitectureReviewModel(input);
    const second = composeProposalArchitectureReviewModel(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("two structurally-identical-but-distinct inputs (same content, different references) produce the same composed id", () => {
    const inputA = buildVisualInput(addEntityProposal());
    const inputB = JSON.parse(JSON.stringify(inputA));
    const modelA = composeProposalArchitectureReviewModel(inputA);
    const modelB = composeProposalArchitectureReviewModel(inputB);
    expect(modelA.id).toBe(modelB.id);
  });

  it("no Date.now/Math.random/crypto.randomUUID value ever varies the output for the same input", () => {
    const input = buildVisualInput(addEntityProposal());
    const results = Array.from({ length: 5 }, () => JSON.stringify(composeProposalArchitectureReviewModel(input)));
    expect(new Set(results).size).toBe(1);
  });
});
