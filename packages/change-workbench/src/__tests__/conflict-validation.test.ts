// Closure proof (Milestone 11.1 closure item 2): deterministic
// rejection/qualification for the 5 conflict scenarios named in the closure
// review, with an explicit "input order must not decide the winner" proof
// for each -- run the same logical operation set forward AND reversed and
// assert byte-identical (order-independent) results.
//
// 4 of the 5 scenarios are already exercised by golden-scenarios.test.ts
// (which only ever runs operations in one fixed order); this file adds the
// missing order-independence proof for all 5.
//
// Scenario 2 (remove_entity + add_relation from the same ref, and its
// symmetric variants) is an internally contradictory proposal: it contains
// enough information, entirely on its own, to know it is contradictory (see
// validation.ts's detectConflicts()). It is detected and blocked at
// validation, before overlay construction is ever attempted -- NOT a
// downstream overlay-layer "unresolved" degradation, which is reserved for
// a genuinely unresolved external/missing reference (a ref simply never
// confirmed at all).

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { validateProposedChangeSet } from "../validation.js";
import { buildChangeOverlay } from "../overlay.js";
import { buildProposedChangeSetId } from "../ids.js";
import { mutateExistingEntityRef, proposeEntityRef } from "../refs.js";
import { confirmedRef, baseFixtureGraph, BASE_SNAPSHOT_DIGEST, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

/** Strips operation_index (order-dependent by construction -- it indexes into this call's own array) before comparing, mirroring determinism.test.ts's own convention. */
function stableValidationResult(operations: ProposalOperation[]) {
  const changeSet = changeSetOf(operations);
  const result = validateProposedChangeSet(changeSet, { confirmedNodes: nodes, confirmedEdges: edges });
  return {
    status: result.status,
    issues: result.issues.map(({ operation_index: _operation_index, ...rest }) => rest).sort((a, b) => a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail)),
  };
}

function stableOverlayResult(operations: ProposalOperation[]) {
  const changeSet = changeSetOf(operations);
  const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
  return {
    status: result.status,
    issues: result.issues.map(({ operation_index: _operation_index, ...rest }) => rest).sort((a, b) => a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail)),
  };
}

describe("conflict validation: 1. remove entity + modify same entity -> valid_partial, order-independent", () => {
  it("modify is superseded by remove regardless of which operation is listed first", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const forward: ProposalOperation[] = [{ kind: "remove_entity", ref }, { kind: "modify_attributes", ref, attributes: { label: "Superseded" } }];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("valid_partial");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.some((i) => i.code === "modify_superseded_by_remove")).toBe(true);
  });
});

describe("conflict validation: 2. remove entity + relation touching same entity -> invalid, internally contradictory, order-independent", () => {
  it("remove_entity + add_relation FROM the removed ref is flagged invalid by validateProposedChangeSet itself, before overlay construction, regardless of operation order", () => {
    const forward: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) },
      { kind: "add_relation", from_ref: confirmedRef("comp-b", nodes), to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "relation_from_removed_entity")).toHaveLength(2); // both the remove_entity and the add_relation operations are flagged
  });

  it("remove_entity + add_relation TO the removed ref (symmetric case) is likewise invalid, order-independent", () => {
    const forward: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) },
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-b", nodes), edge_type: "depends_on" },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "relation_from_removed_entity")).toHaveLength(2);
  });

  it("remove_entity + modify_relation touching the removed ref (symmetric case) is likewise invalid, order-independent", () => {
    const forward: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-a", nodes)) },
      { kind: "modify_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-b", nodes), edge_type: "depends_on", attributes: { detail: "updated" } },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "relation_from_removed_entity")).toHaveLength(2);
  });

  it("remove_entity + remove_relation touching the removed ref is NOT flagged -- consistent (redundant), not contradictory", () => {
    const operations: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-a", nodes)) },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-b", nodes), edge_type: "depends_on" },
    ];
    const result = stableValidationResult(operations);
    expect(result.issues.some((i) => i.code === "relation_from_removed_entity")).toBe(false);
  });

  it("a genuinely unresolved external/missing reference (never confirmed, no in-proposal remove_entity) remains distinct: not flagged as a conflict by validateProposedChangeSet, and only degrades to a non-blocking 'unresolved' overlay-build issue -- proving 'internally contradictory' and 'genuinely unresolved' stay distinguishable", () => {
    const operations: ProposalOperation[] = [{ kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: proposeEntityRef("conflict-fixture", "never-added"), edge_type: "depends_on" }];

    const validationResult = stableValidationResult(operations);
    expect(validationResult.status).toBe("valid_sufficient");
    expect(validationResult.issues.some((i) => i.code === "relation_from_removed_entity")).toBe(false);

    const overlayResult = stableOverlayResult(operations);
    expect(overlayResult.status).toBe("unresolved");
    expect(overlayResult.issues.some((i) => i.code === "unresolved_add_relation_endpoint")).toBe(true);
  });
});

describe("conflict validation: 3. duplicate add of same proposed entity -> invalid, order-independent", () => {
  it("both add_entity operations are flagged regardless of which is listed first", () => {
    const ref = proposeEntityRef("conflict-fixture", "dup-1");
    const forward: ProposalOperation[] = [
      { kind: "add_entity", ref, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "dup-1", label: "Label One", repository_id: REPOSITORY_ID },
      { kind: "add_entity", ref, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "dup-1", label: "Label Two (conflicting)", repository_id: REPOSITORY_ID },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "conflicting_duplicate_add_entity")).toHaveLength(2);
  });
});

describe("conflict validation: 4. add + remove same proposed relation -> invalid, order-independent", () => {
  it("both operations are flagged regardless of which is listed first", () => {
    const from = confirmedRef("comp-a", nodes);
    const to = confirmedRef("comp-c", nodes);
    const forward: ProposalOperation[] = [
      { kind: "add_relation", from_ref: from, to_ref: to, edge_type: "invokes" },
      { kind: "remove_relation", from_ref: from, to_ref: to, edge_type: "invokes" },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "contradictory_relation_operations")).toHaveLength(2);
  });
});

describe("conflict validation: 5. conflicting values for the same attribute -> invalid, order-independent", () => {
  it("both modify_attributes operations are flagged regardless of which is listed first", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const forward: ProposalOperation[] = [
      { kind: "modify_attributes", ref, attributes: { label: "First Value" } },
      { kind: "modify_attributes", ref, attributes: { label: "Second Value (conflicting)" } },
    ];
    const reversed: ProposalOperation[] = [...forward].reverse();

    const forwardResult = stableValidationResult(forward);
    const reversedResult = stableValidationResult(reversed);

    expect(forwardResult.status).toBe("invalid");
    expect(JSON.stringify(forwardResult)).toBe(JSON.stringify(reversedResult));
    expect(forwardResult.issues.filter((i) => i.code === "conflicting_modify_attributes")).toHaveLength(2);
  });

  it("does NOT flag two modify_attributes on the same ref when they assert the SAME value (not a real conflict)", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const operations: ProposalOperation[] = [
      { kind: "modify_attributes", ref, attributes: { label: "Same Value" } },
      { kind: "modify_attributes", ref, attributes: { label: "Same Value" } },
    ];
    const result = stableValidationResult(operations);
    expect(result.issues.some((i) => i.code === "conflicting_modify_attributes")).toBe(false);
  });
});
