// 14-scenario golden test corpus for `validateProposedChangeSet`. Each
// scenario is a hand-authored proposal with a known-correct expected
// validation status + the specific issue code(s) that must appear. Purely
// non-visual: this package has no rendering surface (see Milestone 11.1's
// explicit scope boundary), so "golden" here means "known-correct
// classification of a representative proposal shape," not a rendered
// snapshot.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { validateProposedChangeSet } from "../validation.js";
import { proposeEntityRef, mutateExistingEntityRef, tryConfirmEntityRef } from "../refs.js";
import { buildProposedChangeSetId } from "../ids.js";
import { baseFixtureGraph, confirmedRef, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

interface Scenario {
  name: string;
  operations: ProposalOperation[];
  context?: { confirmedNodes?: typeof nodes; confirmedEdges?: [] };
  expectedStatus: "valid_sufficient" | "valid_partial" | "unresolved" | "invalid";
  expectedIssueCode: string;
}

const newEntity = proposeEntityRef("golden-scenarios", "new-1");

// `{ __proto__: ... }` as a literal object-literal key sets the object's
// prototype rather than creating an own enumerable property, so it would
// never actually reach Object.keys(attributes) in validation.ts -- a
// computed key is required to construct a genuinely own "__proto__"
// property, which is the actual attack shape validation.ts defends against
// (e.g. an attributes bag parsed from untrusted JSON, where JSON.parse DOES
// produce an own "__proto__" property).
function prototypePollutionAttributes(): Record<string, unknown> {
  const key = "__proto__";
  return { [key]: { polluted: true } };
}

const scenarios: Scenario[] = [
  {
    name: "1. single add_entity, no relations -> valid_sufficient",
    operations: [{ kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID }],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_sufficient",
    expectedIssueCode: "",
  },
  {
    name: "2. add_entity + add_relation to a confirmed entity -> valid_sufficient",
    operations: [
      { kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
      { kind: "add_relation", from_ref: newEntity, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    ],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_sufficient",
    expectedIssueCode: "",
  },
  {
    name: "3. modify_attributes with only a supported key -> valid_sufficient",
    operations: [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_sufficient",
    expectedIssueCode: "",
  },
  {
    name: "4. modify_attributes with a real-but-unsupported KG field -> valid_partial",
    operations: [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { node_type: "package" } }],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_partial",
    expectedIssueCode: "attribute_unsupported",
  },
  {
    name: "5. modify_attributes with a fully unrecognized key -> valid_partial",
    operations: [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { totally_unknown_field: true } }],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_partial",
    expectedIssueCode: "attribute_unresolved",
  },
  {
    name: "6. no observed-graph context supplied at all -> unresolved",
    operations: [{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) }],
    context: undefined,
    expectedStatus: "unresolved",
    expectedIssueCode: "unresolved_confirmation_context",
  },
  {
    name: "7. ref not found in the supplied confirmed set -> unresolved",
    operations: [{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) }],
    context: { confirmedNodes: nodes.filter((n) => n.id !== "comp-c") },
    expectedStatus: "unresolved",
    expectedIssueCode: "unresolved_ref_not_found",
  },
  {
    name: "8. add_relation directly contradicted by remove_relation on the same triple -> invalid",
    operations: [
      { kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
      { kind: "remove_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "invokes" },
    ],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "contradictory_relation_operations",
  },
  {
    name: "9. two add_entity ops on the same ref with differing content -> invalid",
    operations: [
      { kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "Label One", repository_id: REPOSITORY_ID },
      { kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "Label Two (conflicting)", repository_id: REPOSITORY_ID },
    ],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "conflicting_duplicate_add_entity",
  },
  {
    name: "10. two modify_attributes ops on the same ref asserting different values -> invalid",
    operations: [
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "First Value" } },
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Second Value (conflicting)" } },
    ],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "conflicting_modify_attributes",
  },
  {
    name: "11. evidence ref path escapes the repository root -> invalid",
    operations: [{ kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID, evidence_refs: [{ path: "../../etc/passwd" }] }],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "path_containment_violation",
  },
  {
    name: "12. prototype-pollution-shaped attribute key -> invalid",
    operations: [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: prototypePollutionAttributes() }],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "prototype_pollution_shaped_key",
  },
  {
    name: "13. add_entity repository_id disagrees with the proposal's own -> invalid",
    operations: [{ kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: "some-other-repo" }],
    context: { confirmedNodes: nodes },
    expectedStatus: "invalid",
    expectedIssueCode: "repository_id_mismatch",
  },
  {
    name: "14. remove_entity + modify_attributes on the same ref -> valid_partial (removal wins, non-blocking)",
    operations: [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) },
      { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Superseded" } },
    ],
    context: { confirmedNodes: nodes },
    expectedStatus: "valid_partial",
    expectedIssueCode: "modify_superseded_by_remove",
  },
];

describe("golden scenarios: validateProposedChangeSet classifies 14 representative proposals correctly", () => {
  it.each(scenarios)("$name", ({ operations, context, expectedStatus, expectedIssueCode }) => {
    const changeSet = changeSetOf(operations);
    const result = validateProposedChangeSet(changeSet, context ?? {});
    expect(result.status).toBe(expectedStatus);
    if (expectedIssueCode) {
      expect(result.issues.some((issue) => issue.code === expectedIssueCode)).toBe(true);
    }
  });

  it("covers exactly 14 scenarios", () => {
    expect(scenarios).toHaveLength(14);
  });
});

describe("golden scenarios: tryConfirmEntityRef / isWellFormedRefString reject malformed candidates", () => {
  it("rejects a candidate that is not present in the known-node set", () => {
    expect(tryConfirmEntityRef("does-not-exist", nodes)).toBeUndefined();
  });
});
