// Closure proof (Milestone 11.1 closure item 3): modify_attributes'
// three-way attribute classification (supported / unsupported / unresolved)
// and its two structural guarantees:
//   1. an unsupported or unresolved attribute value is NEVER applied to the
//      overlay (no fabricated downstream semantics), and
//   2. the caller's raw `attributes` bag on the ProposalOperation itself is
//      never stripped or rewritten -- it remains caller-authored data.
//
// golden-scenarios.test.ts already covers the validation-status-downgrade
// side of this (attribute_unsupported / attribute_unresolved issues
// producing valid_partial). This file adds direct unit coverage of the
// classifier itself, plus the previously-untested overlay-application side.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { classifyEdgeAttributes, classifyNodeAttributes, applySupportedNodeAttributes, applySupportedEdgeAttributes } from "../attribute-support.js";
import { buildChangeOverlay } from "../overlay.js";
import { buildProposedChangeSetId } from "../ids.js";
import { mutateExistingEntityRef, proposeEntityRef } from "../refs.js";
import { confirmedRef, baseFixtureGraph, BASE_SNAPSHOT_DIGEST, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

describe("attribute-support: classify() three-way dispatch", () => {
  it("classifyNodeAttributes: 'label' and 'evidence_refs' are supported", () => {
    const findings = classifyNodeAttributes({ label: "x", evidence_refs: [] });
    expect(findings.map((f) => f.status)).toEqual(["supported", "supported"]);
  });

  it("classifyNodeAttributes: a real-but-identity/derived KnowledgeNode field is unsupported", () => {
    const findings = classifyNodeAttributes({ node_type: "package", resolution_status: "resolved" });
    expect(findings.every((f) => f.status === "unsupported")).toBe(true);
  });

  it("classifyNodeAttributes: an unrecognized key is unresolved", () => {
    const findings = classifyNodeAttributes({ totally_unknown_field: 1 });
    expect(findings).toEqual([expect.objectContaining({ key: "totally_unknown_field", status: "unresolved" })]);
  });

  it("classifyEdgeAttributes: 'detail' is supported; identity/derived fields are unsupported; unknown keys are unresolved", () => {
    expect(classifyEdgeAttributes({ detail: "x" })[0].status).toBe("supported");
    expect(classifyEdgeAttributes({ edge_type: "invokes" })[0].status).toBe("unsupported");
    expect(classifyEdgeAttributes({ made_up_field: true })[0].status).toBe("unresolved");
  });
});

describe("attribute-support: applySupportedNodeAttributes / applySupportedEdgeAttributes never fabricate", () => {
  it("copies only 'label'/'evidence_refs' onto the node and ignores every other key", () => {
    const base = { label: "Original", evidence_refs: [] as unknown[] };
    const next = applySupportedNodeAttributes(base, { label: "New Label", node_type: "package", totally_unknown_field: "should never appear" });
    expect(next.label).toBe("New Label");
    expect(Object.keys(next)).toEqual(["label", "evidence_refs"]);
    expect(next).not.toHaveProperty("node_type");
    expect(next).not.toHaveProperty("totally_unknown_field");
  });

  it("never mutates the input node object", () => {
    const base = { label: "Original", evidence_refs: [] as unknown[] };
    applySupportedNodeAttributes(base, { label: "New Label" });
    expect(base.label).toBe("Original");
  });

  it("copies only 'detail' onto the edge and ignores every other key", () => {
    const base = { detail: "" };
    const next = applySupportedEdgeAttributes(base, { detail: "New detail", edge_type: "invokes", made_up_field: true });
    expect(next.detail).toBe("New detail");
    expect(Object.keys(next)).toEqual(["detail"]);
  });
});

describe("attribute-support: overlay construction never fabricates unsupported/unresolved attribute values", () => {
  it("modify_attributes on an existing node: unsupported (node_type) and unresolved (unknown key) values are disclosed but never applied to the overlay node", () => {
    const ref = mutateExistingEntityRef(confirmedRef("comp-b", nodes));
    const attributes = { node_type: "package", totally_unknown_field: "fabricated?" };
    const operations: ProposalOperation[] = [{ kind: "modify_attributes", ref, attributes }];
    const changeSet = changeSetOf(operations);

    const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const overlayNode = result.overlay?.nodes.find((n) => n.id === "comp-b");

    expect(overlayNode?.node_type).toBe("component"); // original value, never overwritten by the "unsupported" attribute
    expect(overlayNode).not.toHaveProperty("totally_unknown_field");

    // The caller's raw attributes bag on the operation itself is untouched -- never stripped or rewritten.
    expect(changeSet.operations[0]).toMatchObject({ attributes: { node_type: "package", totally_unknown_field: "fabricated?" } });
    expect(attributes).toEqual({ node_type: "package", totally_unknown_field: "fabricated?" });
  });

  it("add_entity: only the supported subset of the attributes bag (label/evidence_refs) reaches the overlay node; an unresolved key never appears on it", () => {
    const ref = proposeEntityRef("attr-fixture", "new-1");
    const operations: ProposalOperation[] = [
      {
        kind: "add_entity",
        ref,
        node_type: "component",
        source_artifact: "architecture",
        proposed_source_entity_id: "new-1",
        label: "Base Label",
        repository_id: REPOSITORY_ID,
        attributes: { label: "Attribute-Asserted Label", totally_unknown_field: "should never appear" },
      },
    ];
    const changeSet = changeSetOf(operations);

    const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const overlayNode = result.overlay?.nodes.find((n) => n.id === ref);

    expect(overlayNode?.label).toBe("Attribute-Asserted Label");
    expect(overlayNode).not.toHaveProperty("totally_unknown_field");
  });
});
