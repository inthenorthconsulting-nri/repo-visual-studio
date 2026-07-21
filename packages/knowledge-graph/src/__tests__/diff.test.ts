import { describe, it, expect } from "vitest";
import { diffGraphs, type DiffOptions, type GraphSnapshotState } from "../diff.js";
import { buildChangeSetId } from "../ids.js";
import { emptyDecisionStateLookup, makeEdge, makeNode } from "./graph-fixtures.js";

function snapshot(id: string, nodes: ReturnType<typeof makeNode>[], edges: ReturnType<typeof makeEdge>[]): GraphSnapshotState {
  return { snapshotId: id, nodes, edges };
}

function baseOptions(overrides: Partial<DiffOptions> = {}): DiffOptions {
  return { decisionStateLookup: emptyDecisionStateLookup(), ...overrides };
}

describe("diffGraphs", () => {
  it("computes nodes_added / nodes_removed / edges_added / edges_removed", () => {
    const a = makeNode({ sourceEntityId: "diff-a" });
    const b = makeNode({ sourceEntityId: "diff-b" });
    const c = makeNode({ sourceEntityId: "diff-c" });
    const edgeAB = makeEdge({ edgeType: "depends_on", from: a, to: b });
    const edgeBC = makeEdge({ edgeType: "depends_on", from: b, to: c });

    const source = snapshot("snap-source", [a, b], [edgeAB]);
    const target = snapshot("snap-target", [b, c], [edgeBC]);

    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.id).toBe(buildChangeSetId("snap-source", "snap-target"));
    expect(changeSet.source_snapshot_id).toBe("snap-source");
    expect(changeSet.target_snapshot_id).toBe("snap-target");
    expect(changeSet.nodes_added).toEqual([c.id]);
    expect(changeSet.nodes_removed).toEqual([a.id]);
    expect(changeSet.edges_added).toEqual([edgeBC.id]);
    expect(changeSet.edges_removed).toEqual([edgeAB.id]);
  });

  it("reports entity_types_changed for a node id present in both with a different node_type", () => {
    const shared = makeNode({ sourceEntityId: "diff-shared", nodeType: "component" });
    const sharedRetyped = { ...shared, node_type: "capability" as const };
    const source = snapshot("s1", [shared], []);
    const target = snapshot("s2", [sharedRetyped], []);
    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.entity_types_changed).toEqual([shared.id]);
  });

  it("reports relationships_changed for an edge id present in both with a different resolution_status or detail", () => {
    const a = makeNode({ sourceEntityId: "diff-rel-a" });
    const b = makeNode({ sourceEntityId: "diff-rel-b" });
    const edge = makeEdge({ edgeType: "depends_on", from: a, to: b, detail: "original detail" });
    const changedEdge = { ...edge, detail: "changed detail" };
    const source = snapshot("s1", [a, b], [edge]);
    const target = snapshot("s2", [a, b], [changedEdge]);
    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.relationships_changed).toEqual([edge.id]);
  });

  it("only computes dependency_paths_changed for explicitly supplied pathQueries, and detects a rerouted path", () => {
    const a = makeNode({ sourceEntityId: "diff-path-a" });
    const b = makeNode({ sourceEntityId: "diff-path-b" });
    const c = makeNode({ sourceEntityId: "diff-path-c" });
    const d = makeNode({ sourceEntityId: "diff-path-d" });
    const nodes = [a, b, c, d];

    const sourceEdges = [
      makeEdge({ edgeType: "depends_on", from: a, to: b }),
      makeEdge({ edgeType: "depends_on", from: b, to: c }),
      makeEdge({ edgeType: "depends_on", from: c, to: d }),
    ];
    const targetEdges = [
      makeEdge({ edgeType: "depends_on", from: a, to: c }), // shortcut, bypassing b
      makeEdge({ edgeType: "depends_on", from: c, to: d }),
    ];

    const source = snapshot("s1", nodes, sourceEdges);
    const target = snapshot("s2", nodes, targetEdges);

    const withoutQuery = diffGraphs(source, target, baseOptions());
    expect(withoutQuery.dependency_paths_changed).toEqual([]);

    const withQuery = diffGraphs(source, target, baseOptions({ pathQueries: [{ from: a.id, to: d.id }] }));
    expect(withQuery.dependency_paths_changed).toEqual([`${a.id}->${d.id}`]);
  });

  it("skips a pathQuery when either endpoint is missing from either snapshot", () => {
    const a = makeNode({ sourceEntityId: "diff-skip-a" });
    const b = makeNode({ sourceEntityId: "diff-skip-b" });
    const source = snapshot("s1", [a], []);
    const target = snapshot("s2", [a], []);
    const changeSet = diffGraphs(source, target, baseOptions({ pathQueries: [{ from: a.id, to: b.id }] }));
    expect(changeSet.dependency_paths_changed).toEqual([]);
  });

  it("only computes impact_radius_increased/decreased for explicitly supplied impactQueryEntityIds", () => {
    const root = makeNode({ sourceEntityId: "diff-impact-root" });
    const leaf1 = makeNode({ sourceEntityId: "diff-impact-leaf-1" });
    const leaf2 = makeNode({ sourceEntityId: "diff-impact-leaf-2" });
    const nodes = [root, leaf1, leaf2];
    const sourceEdges = [makeEdge({ edgeType: "depends_on", from: root, to: leaf1 })];
    const targetEdges = [makeEdge({ edgeType: "depends_on", from: root, to: leaf1 }), makeEdge({ edgeType: "depends_on", from: root, to: leaf2 })];

    const source = snapshot("s1", nodes, sourceEdges);
    const target = snapshot("s2", nodes, targetEdges);

    const withoutQuery = diffGraphs(source, target, baseOptions());
    expect(withoutQuery.impact_radius_increased).toEqual([]);
    expect(withoutQuery.impact_radius_decreased).toEqual([]);

    const withQuery = diffGraphs(source, target, baseOptions({ impactQueryEntityIds: [root.id] }));
    expect(withQuery.impact_radius_increased).toEqual([root.id]);
    expect(withQuery.impact_radius_decreased).toEqual([]);

    const reversedQuery = diffGraphs(target, source, baseOptions({ impactQueryEntityIds: [root.id] }));
    expect(reversedQuery.impact_radius_decreased).toEqual([root.id]);
  });

  it("reports new_orphans for a node that loses all its edges in the target", () => {
    const a = makeNode({ sourceEntityId: "diff-orphan-a" });
    const b = makeNode({ sourceEntityId: "diff-orphan-b" });
    const nodes = [a, b];
    const source = snapshot("s1", nodes, [makeEdge({ edgeType: "depends_on", from: a, to: b })]);
    const target = snapshot("s2", nodes, []);
    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.new_orphans.sort()).toEqual([a.id, b.id].sort());
  });

  it("reports new_cycles introduced in the target that were absent in the source", () => {
    const x = makeNode({ sourceEntityId: "diff-cycle-x" });
    const y = makeNode({ sourceEntityId: "diff-cycle-y" });
    const nodes = [x, y];
    const source = snapshot("s1", nodes, [makeEdge({ edgeType: "depends_on", from: x, to: y })]);
    const target = snapshot("s2", nodes, [
      makeEdge({ edgeType: "depends_on", from: x, to: y }),
      makeEdge({ edgeType: "depends_on", from: y, to: x }),
    ]);
    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.new_cycles.length).toBe(1);
  });

  it("reports decision_dependencies_changed / governance_reach_changed when a same-type node's touching edges differ", () => {
    const decision = makeNode({ sourceEntityId: "diff-decision", nodeType: "decision", sourceArtifact: "decision" });
    const finding = makeNode({ sourceEntityId: "diff-finding", nodeType: "governance_finding", sourceArtifact: "governance" });
    const entityA = makeNode({ sourceEntityId: "diff-entity-a" });
    const entityB = makeNode({ sourceEntityId: "diff-entity-b" });
    const nodes = [decision, finding, entityA, entityB];

    const source = snapshot(
      "s1",
      nodes,
      [makeEdge({ edgeType: "references", from: decision, to: entityA }), makeEdge({ edgeType: "affects", from: finding, to: entityA })],
    );
    const target = snapshot(
      "s2",
      nodes,
      [makeEdge({ edgeType: "references", from: decision, to: entityB }), makeEdge({ edgeType: "affects", from: finding, to: entityB })],
    );

    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.decision_dependencies_changed).toEqual([decision.id]);
    expect(changeSet.governance_reach_changed).toEqual([finding.id]);
  });

  it("does not flag decision_dependencies_changed / governance_reach_changed for other node types with changed edges", () => {
    const a = makeNode({ sourceEntityId: "diff-other-a" });
    const b1 = makeNode({ sourceEntityId: "diff-other-b1" });
    const b2 = makeNode({ sourceEntityId: "diff-other-b2" });
    const nodes = [a, b1, b2];
    const source = snapshot("s1", nodes, [makeEdge({ edgeType: "depends_on", from: a, to: b1 })]);
    const target = snapshot("s2", nodes, [makeEdge({ edgeType: "depends_on", from: a, to: b2 })]);
    const changeSet = diffGraphs(source, target, baseOptions());
    expect(changeSet.decision_dependencies_changed).toEqual([]);
    expect(changeSet.governance_reach_changed).toEqual([]);
  });

  it("produces an entirely empty changeset when source and target are identical", () => {
    const a = makeNode({ sourceEntityId: "diff-noop-a" });
    const b = makeNode({ sourceEntityId: "diff-noop-b" });
    const edge = makeEdge({ edgeType: "depends_on", from: a, to: b });
    const nodes = [a, b];
    const edges = [edge];
    const changeSet = diffGraphs(snapshot("s1", nodes, edges), snapshot("s2", nodes, edges), baseOptions());
    expect(changeSet.nodes_added).toEqual([]);
    expect(changeSet.nodes_removed).toEqual([]);
    expect(changeSet.edges_added).toEqual([]);
    expect(changeSet.edges_removed).toEqual([]);
    expect(changeSet.entity_types_changed).toEqual([]);
    expect(changeSet.relationships_changed).toEqual([]);
    expect(changeSet.new_orphans).toEqual([]);
    expect(changeSet.new_cycles).toEqual([]);
    expect(changeSet.root_causes_introduced).toEqual([]);
    expect(changeSet.root_causes_resolved).toEqual([]);
    expect(changeSet.decision_dependencies_changed).toEqual([]);
    expect(changeSet.governance_reach_changed).toEqual([]);
  });
});
