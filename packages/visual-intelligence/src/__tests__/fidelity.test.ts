import { describe, expect, it } from "vitest";
import {
  buildFidelityReceipt,
  criticalPathViolations,
  receiptIsMandatory,
  validateFidelityReceipt,
  type FidelityReceiptInput,
} from "../fidelity.js";
import { digestOf } from "../ids.js";
import { shuffle } from "./fixtures.js";

const receiptInput = (over: Partial<FidelityReceiptInput> = {}): FidelityReceiptInput => ({
  spec_id: "spec_test",
  source_entity_ids: ["a", "b", "c", "d"],
  source_edge_ids: ["a->b", "b->c"],
  rendered_entity_ids: ["a", "b"],
  rendered_edge_ids: ["a->b"],
  collapsed_groups: [
    {
      id: "grp_1",
      display_label: "2 component nodes",
      source_entity_ids: ["c", "d"],
      reason: "FIDELITY_LOW_VALUE_LEAF_COLLAPSED",
      selection_policy: "synthetic-group-label",
    },
  ],
  hidden_entity_ids: [],
  preserved_paths: [],
  preserved_findings: [],
  preserved_decisions: [],
  preserved_unresolved_entities: [],
  split_views: [],
  truncated: false,
  limits_hit: [],
  reason_codes: ["FIDELITY_LOW_VALUE_LEAF_COLLAPSED"],
  ...over,
});

describe("a well-formed receipt", () => {
  it("partitions the source entity set and reports no violations", () => {
    const receipt = buildFidelityReceipt(receiptInput());
    expect(validateFidelityReceipt(receipt, ["a", "b", "c", "d"])).toEqual([]);
    expect(receipt.rendered_node_count).toBe(2);
    expect(receipt.source_node_count).toBe(4);
  });

  it("digests the id sets, so a shuffled input yields an identical receipt", () => {
    const canonical = buildFidelityReceipt(receiptInput());
    for (let seed = 1; seed <= 4; seed++) {
      const shuffled = buildFidelityReceipt(
        receiptInput({
          source_entity_ids: shuffle(["a", "b", "c", "d"], seed),
          rendered_entity_ids: shuffle(["a", "b"], seed),
        }),
      );
      expect(digestOf(shuffled)).toBe(digestOf(canonical));
    }
  });

  it("defaults to an explicit no-reduction code rather than an empty reason list", () => {
    const receipt = buildFidelityReceipt(
      receiptInput({ rendered_entity_ids: ["a", "b", "c", "d"], collapsed_groups: [], reason_codes: [] }),
    );
    expect(receipt.reason_codes).toEqual(["FIDELITY_NO_REDUCTION"]);
  });
});

describe("a receipt that does not add up", () => {
  it("reports an entity that reached no bucket at all", () => {
    // The exact failure the contract exists to catch: a simplifier that
    // turned 4 nodes into 2 and said nothing about the other 2.
    const receipt = buildFidelityReceipt(receiptInput({ collapsed_groups: [] }));
    const violations = validateFidelityReceipt(receipt, ["a", "b", "c", "d"]);
    expect(violations.map((v) => v.code)).toContain("VISUAL_FIDELITY_ENTITY_LOST");
    expect(violations.map((v) => v.subject_id).sort()).toContain("c");
  });

  it("reports an entity reported in two buckets at once", () => {
    const receipt = buildFidelityReceipt(receiptInput({ hidden_entity_ids: ["c"] }));
    const violations = validateFidelityReceipt(receipt, ["a", "b", "c", "d"]);
    expect(violations.some((v) => v.code === "VISUAL_FIDELITY_RECEIPT_INVALID" && v.subject_id === "c")).toBe(true);
  });

  it("reports an entity that was never in the source set", () => {
    const receipt = buildFidelityReceipt(receiptInput({ rendered_entity_ids: ["a", "b", "stowaway"] }));
    const violations = validateFidelityReceipt(receipt, ["a", "b", "c", "d"]);
    expect(violations.some((v) => v.subject_id === "stowaway")).toBe(true);
  });

  it("reports counts that disagree with the lists they summarise", () => {
    const receipt = { ...buildFidelityReceipt(receiptInput()), rendered_node_count: 99 };
    const violations = validateFidelityReceipt(receipt, ["a", "b", "c", "d"]);
    expect(violations.some((v) => v.message.includes("99"))).toBe(true);
  });

  it("reports an unresolved entity that was hidden", () => {
    const receipt = buildFidelityReceipt(
      receiptInput({
        collapsed_groups: [],
        hidden_entity_ids: ["c", "d"],
        preserved_unresolved_entities: ["c"],
      }),
    );
    const violations = validateFidelityReceipt(receipt, ["a", "b", "c", "d"]);
    expect(violations.map((v) => v.code)).toContain("VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST");
  });
});

describe("critical paths", () => {
  it("reports a path that lost a node", () => {
    const receipt = buildFidelityReceipt(receiptInput());
    const violations = criticalPathViolations(receipt, [{ id: "p1", node_ids: ["a", "b", "c"] }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("VISUAL_FIDELITY_CRITICAL_PATH_LOST");
    expect(violations[0].message).toContain("c");
  });

  it("passes a path that survived whole", () => {
    const receipt = buildFidelityReceipt(receiptInput());
    expect(criticalPathViolations(receipt, [{ id: "p1", node_ids: ["a", "b"] }])).toEqual([]);
  });
});

describe("when a receipt is mandatory", () => {
  it("is required as soon as a single entity or edge is not drawn", () => {
    expect(receiptIsMandatory(10, 10, 5, 5)).toBe(false);
    expect(receiptIsMandatory(10, 9, 5, 5)).toBe(true);
    expect(receiptIsMandatory(10, 10, 5, 4)).toBe(true);
  });
});
