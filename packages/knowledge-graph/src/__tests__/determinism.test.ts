import { describe, it, expect } from "vitest";
import { buildKnowledgeGraph, type KnowledgeGraphBuildInput } from "../graph-builder.js";
import { rotate } from "./graph-fixtures.js";

const BASE_COMPONENTS = [{ id: "comp-1" }, { id: "comp-2" }, { id: "comp-3" }, { id: "comp-4" }, { id: "comp-5" }];
const BASE_CAPABILITIES = [
  { id: "cap-1", domainId: "dom-1", logicalComponents: ["comp-1", "comp-2"] },
  { id: "cap-2", domainId: "dom-1", logicalComponents: ["comp-3"] },
  { id: "cap-3", domainId: "dom-2", logicalComponents: ["comp-4", "comp-5"] },
];
const BASE_FINDINGS = [
  { id: "find-1", policy_id: "pol-1", affected_entity_ids: ["comp-1", "comp-2"] },
  { id: "find-2", policy_id: "pol-1", affected_entity_ids: ["comp-3"] },
  { id: "find-3", policy_id: "pol-2", affected_entity_ids: ["comp-4"] },
];
const BASE_DECISIONS = [
  { id: "dec-1", title: "Decision One" },
  { id: "dec-2", title: "Decision Two", supersedes: ["dec-1"] },
];

function buildInputForShuffle(shift: number): KnowledgeGraphBuildInput {
  return {
    architecture: {
      identity: { id: "determinism-repo" },
      components: rotate(BASE_COMPONENTS, shift),
      workflowFamilies: rotate([{ id: "wf-1" }, { id: "wf-2" }], shift),
    },
    capability: {
      domains: rotate([{ id: "dom-1" }, { id: "dom-2" }], shift),
      includedCapabilities: rotate(BASE_CAPABILITIES, shift),
    },
    product: { identity: { displayName: "Determinism Product", currentCapabilities: rotate(["cap-1", "cap-2", "cap-3"], shift) } },
    portfolio: {
      products: rotate([{ id: "port-prod-1" }, { id: "port-prod-2" }], shift),
      relationships: rotate([{ id: "rel-1", productAId: "port-prod-1", productBId: "port-prod-2", statement: "complements" }], shift),
    },
    governance: {
      policies: rotate([{ id: "pol-1", name: "Policy One" }, { id: "pol-2", name: "Policy Two" }], shift),
      findings: rotate(BASE_FINDINGS, shift),
      baseline: { id: "baseline-1" },
    },
    decision: { decisions: rotate(BASE_DECISIONS, shift) },
    decisionAssumptions: {
      assumptions: rotate(
        [
          { id: "assume-1", decision_id: "dec-1", statement: "Assumption One" },
          { id: "assume-2", decision_id: "dec-2", statement: "Assumption Two" },
        ],
        shift,
      ),
    },
    decisionLinks: {
      links: rotate(
        [
          { id: "link-1", decision_id: "dec-1", target_id: "comp-1", link_type: "affects" },
          { id: "link-2", decision_id: "dec-2", target_id: "comp-2", link_type: "affects" },
        ],
        shift,
      ),
    },
  };
}

describe("determinism: buildKnowledgeGraph is byte-identical across shuffled input orderings", () => {
  it("runs 5 times with a different shuffled array order each time and produces identical results every time", () => {
    const results = [0, 1, 2, 3, 4].map((shift) => buildKnowledgeGraph(buildInputForShuffle(shift)));

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }

    // Explicitly re-check the pieces most sensitive to ordering bugs: sorted node/edge id sequences and the
    // final content digest, using JSON serialization to catch any stray extra/missing/reordered key or value.
    const serialized = results.map((r) => JSON.stringify(r));
    for (let i = 1; i < serialized.length; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }

    expect(new Set(results.map((r) => r.snapshot.digest)).size).toBe(1);
    expect(new Set(results.map((r) => r.snapshot.id)).size).toBe(1);
  });
});
