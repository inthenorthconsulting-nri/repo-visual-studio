import { describe, it, expect } from "vitest";
import { buildKnowledgeGraph } from "../graph-builder.js";
import { validateGraph } from "../validation.js";
import { diffGraphs, type GraphSnapshotState } from "../diff.js";
import { findShortestPath, type PathQueryOptions } from "../path-finding.js";
import { buildNodeId } from "../ids.js";
import { emptyDecisionStateLookup, makeEdge, makeNode, rotate } from "./graph-fixtures.js";

describe("adversarial: shared-word/title false-positive rejection", () => {
  it("never infers an edge between two components merely because they share a label/title", () => {
    const result = buildKnowledgeGraph({
      architecture: {
        identity: { id: "repo-x" },
        components: [
          { id: "svc-alpha", label: { displayLabel: "Payment Service" } },
          { id: "svc-alpha-clone", label: { displayLabel: "Payment Service" } }, // identical label, unrelated entity
        ],
      },
    });
    // Only the two repo->component containment edges should exist -- nothing directly links the two
    // same-labeled components to each other, since edges are only ever built from an upstream artifact's
    // own already-computed relationship fields, never inferred from matching text.
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every((e) => e.edge_type === "contains")).toBe(true);
    const directEdge = result.edges.find(
      (e) =>
        (e.from_node_id === buildNodeId("svc-alpha") && e.to_node_id === buildNodeId("svc-alpha-clone")) ||
        (e.from_node_id === buildNodeId("svc-alpha-clone") && e.to_node_id === buildNodeId("svc-alpha")),
    );
    expect(directEdge).toBeUndefined();
  });
});

describe("adversarial: reordered input produces the same graph", () => {
  it("permuting the order of independent component entries in the raw upstream artifact does not change the final node/edge id sets or the snapshot digest", () => {
    const componentsA = [{ id: "comp-1" }, { id: "comp-2" }, { id: "comp-3" }, { id: "comp-4" }];
    const componentsB = rotate(componentsA, 2);
    const resultA = buildKnowledgeGraph({ architecture: { identity: { id: "repo-x" }, components: componentsA } });
    const resultB = buildKnowledgeGraph({ architecture: { identity: { id: "repo-x" }, components: componentsB } });
    expect(resultA.nodes.map((n) => n.id)).toEqual(resultB.nodes.map((n) => n.id));
    expect(resultA.edges.map((e) => e.id)).toEqual(resultB.edges.map((e) => e.id));
    expect(resultA.snapshot.digest).toBe(resultB.snapshot.digest);
  });
});

describe("adversarial: identical-snapshot no-op diff, even under array reordering", () => {
  it("diffing content-identical-but-differently-ordered node/edge arrays produces an entirely empty changeset", () => {
    const a = makeNode({ sourceEntityId: "adv-diff-a" });
    const b = makeNode({ sourceEntityId: "adv-diff-b" });
    const c = makeNode({ sourceEntityId: "adv-diff-c" });
    const edgeAB = makeEdge({ edgeType: "depends_on", from: a, to: b });
    const edgeBC = makeEdge({ edgeType: "depends_on", from: b, to: c });

    const source: GraphSnapshotState = { snapshotId: "s1", nodes: [a, b, c], edges: [edgeAB, edgeBC] };
    const target: GraphSnapshotState = { snapshotId: "s2", nodes: [c, a, b], edges: [edgeBC, edgeAB] };

    const changeSet = diffGraphs(source, target, { decisionStateLookup: emptyDecisionStateLookup() });
    expect(changeSet.nodes_added).toEqual([]);
    expect(changeSet.nodes_removed).toEqual([]);
    expect(changeSet.edges_added).toEqual([]);
    expect(changeSet.edges_removed).toEqual([]);
    expect(changeSet.entity_types_changed).toEqual([]);
    expect(changeSet.relationships_changed).toEqual([]);
    expect(changeSet.new_orphans).toEqual([]);
    expect(changeSet.new_cycles).toEqual([]);
  });
});

describe("adversarial: ambiguous shortest-path tie-break stays deterministic under construction-order attacks", () => {
  it("selects the same lexicographically-smallest edge-id sequence regardless of how the three equal-length candidate paths were assembled", () => {
    const start = makeNode({ sourceEntityId: "tie-start" });
    const end = makeNode({ sourceEntityId: "tie-end" });
    const viaX = makeNode({ sourceEntityId: "tie-via-x" });
    const viaY = makeNode({ sourceEntityId: "tie-via-y" });
    const viaZ = makeNode({ sourceEntityId: "tie-via-z" });

    const nodes = [start, end, viaX, viaY, viaZ];
    const edgeSet1 = [
      makeEdge({ edgeType: "depends_on", from: start, to: viaX }),
      makeEdge({ edgeType: "depends_on", from: viaX, to: end }),
      makeEdge({ edgeType: "depends_on", from: start, to: viaY }),
      makeEdge({ edgeType: "depends_on", from: viaY, to: end }),
      makeEdge({ edgeType: "depends_on", from: start, to: viaZ }),
      makeEdge({ edgeType: "depends_on", from: viaZ, to: end }),
    ];
    // Same six edges, three different construction/array orders.
    const edgeSet2 = rotate(edgeSet1, 2);
    const edgeSet3 = [...edgeSet1].reverse();

    const opts: PathQueryOptions = { direction: "downstream", maxDepth: 10 };
    const path1 = findShortestPath(nodes, edgeSet1, start.id, end.id, opts);
    const path2 = findShortestPath(nodes, edgeSet2, start.id, end.id, opts);
    const path3 = findShortestPath(nodes, edgeSet3, start.id, end.id, opts);

    expect(path1).toBeDefined();
    expect(path1!.edge_ids).toEqual(path2!.edge_ids);
    expect(path1!.edge_ids).toEqual(path3!.edge_ids);
  });
});

describe("adversarial: contradictory duplicate edges are flagged, never silently merged away unnoticed", () => {
  it("two upstream domains asserting the same edge with conflicting resolution status collapse to one edge but surface a blocking-false GRAPH_EDGE_DUPLICATE validation finding", () => {
    const result = buildKnowledgeGraph({
      architecture: { identity: { id: "repo-x" }, components: [{ id: "comp-a" }] },
      decision: { decisions: [{ id: "dec-1", title: "Decision One" }] },
      decisionLinks: {
        links: [
          { id: "link-1", decision_id: "dec-1", target_id: "comp-a", resolution: "resolved", detail: "claims resolved" },
          { id: "link-2", decision_id: "dec-1", target_id: "comp-a", resolution: "incompatible", detail: "claims incompatible" },
        ],
      },
    });

    const referencesEdges = result.edges.filter((e) => e.edge_type === "references");
    expect(referencesEdges).toHaveLength(1); // collapsed to one edge, not silently duplicated in the graph itself
    expect(result.duplicate_edge_findings).toHaveLength(1); // but the contradiction is recorded, not silently dropped

    const findings = validateGraph(result);
    const duplicateFinding = findings.find((f) => f.code === "GRAPH_EDGE_DUPLICATE");
    expect(duplicateFinding).toBeDefined();
    expect(duplicateFinding!.blocking).toBe(false);
  });
});
