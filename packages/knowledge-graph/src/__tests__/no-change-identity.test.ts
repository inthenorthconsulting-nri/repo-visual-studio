import { describe, it, expect } from "vitest";
import { diffGraphs, type GraphSnapshotState } from "../diff.js";
import { makeDecisionStateLookup } from "./graph-fixtures.js";
import { decisionReachableFixture, evidencePathFixture, linearChainFixture, rootCauseFixtureSet } from "./graph-fixtures.js";

// A graph diffed against an identical copy of itself must produce an empty
// changeset in EVERY facet -- including the facets that are only computed
// when the caller explicitly supplies query lists (pathQueries,
// impactQueryEntityIds) -- so this suite deliberately supplies those queries
// rather than leaving diff.test.ts's lighter default-empty-options coverage
// to stand in for the "no genuine change" identity property.

function assertEmptyChangeSet(changeSet: ReturnType<typeof diffGraphs>) {
  expect(changeSet.nodes_added).toEqual([]);
  expect(changeSet.nodes_removed).toEqual([]);
  expect(changeSet.edges_added).toEqual([]);
  expect(changeSet.edges_removed).toEqual([]);
  expect(changeSet.entity_types_changed).toEqual([]);
  expect(changeSet.relationships_changed).toEqual([]);
  expect(changeSet.dependency_paths_changed).toEqual([]);
  expect(changeSet.impact_radius_increased).toEqual([]);
  expect(changeSet.impact_radius_decreased).toEqual([]);
  expect(changeSet.new_orphans).toEqual([]);
  expect(changeSet.new_cycles).toEqual([]);
  expect(changeSet.root_causes_introduced).toEqual([]);
  expect(changeSet.root_causes_resolved).toEqual([]);
  expect(changeSet.decision_dependencies_changed).toEqual([]);
  expect(changeSet.governance_reach_changed).toEqual([]);
}

describe("no-change identity: diffing a graph against itself", () => {
  it("linearChainFixture, with explicit pathQueries and impactQueryEntityIds supplied, still yields an entirely empty changeset", () => {
    const { nodes, edges, repo, d } = linearChainFixture();
    const source: GraphSnapshotState = { snapshotId: "snap-a", nodes, edges };
    const target: GraphSnapshotState = { snapshotId: "snap-b", nodes, edges };
    const changeSet = diffGraphs(source, target, {
      decisionStateLookup: makeDecisionStateLookup({}),
      pathQueries: [{ from: repo.id, to: d.id }],
      impactQueryEntityIds: [repo.id, d.id],
    });
    assertEmptyChangeSet(changeSet);
  });

  it("evidencePathFixture (includes an unresolved reference and a baseline) is a no-op against itself", () => {
    const { nodes, edges, root, unresolvedConsumer } = evidencePathFixture();
    const source: GraphSnapshotState = { snapshotId: "snap-a", nodes, edges };
    const target: GraphSnapshotState = { snapshotId: "snap-b", nodes, edges };
    const changeSet = diffGraphs(source, target, {
      decisionStateLookup: makeDecisionStateLookup({}),
      pathQueries: [{ from: root.id, to: unresolvedConsumer.id }],
      impactQueryEntityIds: [root.id],
    });
    assertEmptyChangeSet(changeSet);
  });

  it("decisionReachableFixture (decision/assumption/consequence graph) is a no-op against itself, with a populated decisionStateLookup", () => {
    const { nodes, edges, decision, entity } = decisionReachableFixture();
    const source: GraphSnapshotState = { snapshotId: "snap-a", nodes, edges };
    const target: GraphSnapshotState = { snapshotId: "snap-b", nodes, edges };
    const lookup = makeDecisionStateLookup({ decisions: [{ id: decision.source_entity_id, decision_status: "affirmed" }] });
    const changeSet = diffGraphs(source, target, {
      decisionStateLookup: lookup,
      impactQueryEntityIds: [entity.id, decision.id],
    });
    assertEmptyChangeSet(changeSet);
  });

  it("rootCauseFixtureSet (5 disjoint governance sub-graphs) is a no-op against itself", () => {
    const { nodes, edges } = rootCauseFixtureSet();
    const source: GraphSnapshotState = { snapshotId: "snap-a", nodes, edges };
    const target: GraphSnapshotState = { snapshotId: "snap-b", nodes, edges };
    const changeSet = diffGraphs(source, target, { decisionStateLookup: makeDecisionStateLookup({}) });
    assertEmptyChangeSet(changeSet);
  });
});
