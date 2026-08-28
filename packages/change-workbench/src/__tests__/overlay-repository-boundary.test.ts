// Regression test for the mandatory repository_id-stamping invariant:
// buildChangeOverlay() must never let a confirmed node/edge from a
// DIFFERENT repository_id leak into the overlay, and every synthesized node
// must inherit the proposal's own repository_id. Also exercises the
// explicit unresolved-degradation behavior for a ref that cannot be
// resolved against the repository-scoped base.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildChangeOverlay } from "../overlay.js";
import { proposeEntityRef, mutateExistingEntityRef } from "../refs.js";
import { buildProposedChangeSetId } from "../ids.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, OTHER_REPOSITORY_ID, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[]): ProposedChangeSet {
  return { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

describe("overlay repository boundary: multi-repository confirmed-node fixture", () => {
  it("never places a node from a different repository_id into the overlay", () => {
    const result = buildChangeOverlay({ changeSet: changeSetOf([]), confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(result.status).toBe("ok");
    expect(result.overlay?.nodes.map((n) => n.id).sort()).toEqual(["comp-a", "comp-b", "comp-c"]);
    expect(result.overlay?.nodes.every((n) => n.repository_id === REPOSITORY_ID)).toBe(true);
  });

  it("every synthesized (add_entity) node inherits the proposal's own repository_id, never a caller-asserted foreign one reaching the overlay unfiltered", () => {
    const ref = proposeEntityRef("boundary-test", "new-1");
    const changeSet = changeSetOf([{ kind: "add_entity", ref, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New", repository_id: REPOSITORY_ID }]);
    const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(result.status).toBe("ok");
    const synthesized = result.overlay?.nodes.find((n) => n.id === ref);
    expect(synthesized?.repository_id).toBe(REPOSITORY_ID);
  });

  it("an add_relation endpoint that only exists in a different repository degrades the build to unresolved, never silently dropped or guessed", () => {
    const otherRepoRef = "other-repo-comp";
    const changeSet: ProposedChangeSet = {
      schema_version: 1,
      id: buildProposedChangeSetId(REPOSITORY_ID, []),
      repository_id: REPOSITORY_ID,
      operations: [{ kind: "add_relation", from_ref: confirmedRef("comp-a", nodes), to_ref: otherRepoRef as ReturnType<typeof confirmedRef>, edge_type: "depends_on" }],
    };
    const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(result.status).toBe("unresolved");
    expect(result.issues.some((issue) => issue.code === "unresolved_add_relation_endpoint")).toBe(true);
    expect(result.overlay?.edges).toHaveLength(2);
  });

  it("remove_entity cascades to remove every edge touching the removed node", () => {
    const changeSet = changeSetOf([{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)) }]);
    const result = buildChangeOverlay({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    expect(result.status).toBe("ok");
    expect(result.overlay?.nodes.map((n) => n.id).sort()).toEqual(["comp-a", "comp-c"]);
    expect(result.overlay?.edges).toHaveLength(0);
    expect(result.overlay?.node_provenance["comp-b"]).toBe("removed");
  });
});
