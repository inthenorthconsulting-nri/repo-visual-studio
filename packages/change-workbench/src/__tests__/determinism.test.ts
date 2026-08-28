// Determinism / shuffle-invariance proof, mirroring @rvs/knowledge-graph's
// own determinism.test.ts pattern: run the same logical proposal through a
// shuffled operations array 5 times and assert byte-identical output.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildProposedChangeSetId } from "../ids.js";
import { buildChangeAdvisory } from "../change-advisory.js";
import { validateProposedChangeSet } from "../validation.js";
import { confirmedRef, rotate } from "./change-workbench-fixtures.js";
import { mutateExistingEntityRef, proposeEntityRef } from "../refs.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();
const newEntity = proposeEntityRef("determinism-fixture", "new-1");

function buildOperations(): ProposalOperation[] {
  return [
    { kind: "add_entity", ref: newEntity, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New Component", repository_id: REPOSITORY_ID },
    { kind: "add_relation", from_ref: newEntity, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    { kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)), attributes: { label: "Renamed C" } },
    { kind: "remove_relation", from_ref: confirmedRef("comp-b", nodes), to_ref: confirmedRef("comp-c", nodes), edge_type: "depends_on" },
  ];
}

describe("determinism: buildProposedChangeSetId is shuffle-invariant", () => {
  it("produces the same id for the same operations regardless of array order (5 shuffles)", () => {
    const base = buildOperations();
    const ids = [0, 1, 2, 3, 4].map((shift) => buildProposedChangeSetId(REPOSITORY_ID, rotate(base, shift)));
    expect(new Set(ids).size).toBe(1);
  });

  it("produces a DIFFERENT id when the operation content actually differs (sanity check against a trivially-always-equal implementation)", () => {
    const a = buildProposedChangeSetId(REPOSITORY_ID, buildOperations());
    const b = buildProposedChangeSetId(REPOSITORY_ID, [...buildOperations(), { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-a", nodes)) }]);
    expect(a).not.toBe(b);
  });
});

describe("determinism: validateProposedChangeSet is shuffle-invariant", () => {
  it("produces byte-identical validation results across 5 shuffled operation orderings", () => {
    const base = buildOperations();
    const results = [0, 1, 2, 3, 4].map((shift) => {
      const operations = rotate(base, shift);
      const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
      const result = validateProposedChangeSet(changeSet, { confirmedNodes: nodes, confirmedEdges: edges });
      // operation_index is order-dependent by construction (it indexes into this call's own array), so it is
      // excluded from the byte-identity comparison below; every other field of every issue must still match.
      return { status: result.status, issues: result.issues.map(({ operation_index: _operation_index, ...rest }) => rest).sort((x, y) => x.code.localeCompare(y.code) || x.detail.localeCompare(y.detail)) };
    });
    const serialized = results.map((r) => JSON.stringify(r));
    for (let i = 1; i < serialized.length; i++) expect(serialized[i]).toBe(serialized[0]);
  });
});

describe("determinism: buildChangeAdvisory is byte-identical across 5 shuffled operation orderings", () => {
  it("runs 5 times with a different shuffled operations order each time and produces an identical advisory (proposal id and advisory id included)", () => {
    const base = buildOperations();
    const advisories = [0, 1, 2, 3, 4].map((shift) => {
      const operations = rotate(base, shift);
      const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
      return buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    });

    const serialized = advisories.map((a) => JSON.stringify(a));
    for (let i = 1; i < serialized.length; i++) expect(serialized[i]).toBe(serialized[0]);
    expect(new Set(advisories.map((a) => a.id)).size).toBe(1);
    expect(new Set(advisories.map((a) => a.proposal_id)).size).toBe(1);
  });

  it("runs the identical (unshuffled) proposal 5 repeated times and produces an identical advisory", () => {
    const operations = buildOperations();
    const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
    const advisories = [0, 1, 2, 3, 4].map(() => buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST }));
    const serialized = advisories.map((a) => JSON.stringify(a));
    for (let i = 1; i < serialized.length; i++) expect(serialized[i]).toBe(serialized[0]);
  });
});
