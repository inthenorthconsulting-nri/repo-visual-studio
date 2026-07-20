import { describe, expect, it } from "vitest";
import { buildDecisionGraph, findCycles, type DecisionGraphEdge } from "../decision-graph.js";

describe("buildDecisionGraph", () => {
  it("dedupes and sorts nodeIds", () => {
    const graph = buildDecisionGraph(["c", "a", "b", "a"], []);
    expect(graph.nodeIds).toEqual(["a", "b", "c"]);
  });

  it("creates an adjacency entry for every node, even ones with no outgoing edges", () => {
    const graph = buildDecisionGraph(["a", "b"], []);
    expect(graph.adjacency.get("a")).toEqual([]);
    expect(graph.adjacency.get("b")).toEqual([]);
  });

  it("buckets edges under their 'from' node only", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "c", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    expect(graph.adjacency.get("a")).toEqual([{ from: "a", to: "b", kind: "supersedes" }]);
    expect(graph.adjacency.get("b")).toEqual([{ from: "b", to: "c", kind: "supersedes" }]);
    expect(graph.adjacency.get("c")).toEqual([]);
  });

  it("sorts each node's adjacency list by 'to' then by 'kind'", () => {
    const edges: DecisionGraphEdge<"x" | "y">[] = [
      { from: "a", to: "c", kind: "y" },
      { from: "a", to: "c", kind: "x" },
      { from: "a", to: "b", kind: "y" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    expect(graph.adjacency.get("a")).toEqual([
      { from: "a", to: "b", kind: "y" },
      { from: "a", to: "c", kind: "x" },
      { from: "a", to: "c", kind: "y" },
    ]);
  });

  it("does not require every edge endpoint to be a known node id", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [{ from: "a", to: "ghost", kind: "supersedes" }];
    expect(() => buildDecisionGraph(["a"], edges)).not.toThrow();
    const graph = buildDecisionGraph(["a"], edges);
    expect(graph.adjacency.get("a")).toEqual([{ from: "a", to: "ghost", kind: "supersedes" }]);
  });

  it("preserves the original edges array contents on the graph, unsorted", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "b", to: "a", kind: "supersedes" },
      { from: "a", to: "b", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b"], edges);
    expect(graph.edges).toEqual(edges);
  });
});

describe("findCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "c", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual([]);
  });

  it("returns no cycles for a graph with zero edges", () => {
    const graph = buildDecisionGraph(["a", "b"], []);
    expect(findCycles(graph, ["supersedes"])).toEqual([]);
  });

  it("detects a self-loop as a one-node cycle", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [{ from: "a", to: "a", kind: "supersedes" }];
    const graph = buildDecisionGraph(["a"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual([["a"]]);
  });

  it("detects a 2-node cycle", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "a", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual([["a", "b"]]);
  });

  it("detects a 3-node cycle exactly once, deduplicated regardless of which node the traversal started from", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "c", kind: "supersedes" },
      { from: "c", to: "a", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    const cycles = findCycles(graph, ["supersedes"]);
    expect(cycles).toEqual([["a", "b", "c"]]);
  });

  it("finds multiple disjoint cycles", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "a", kind: "supersedes" },
      { from: "x", to: "y", kind: "supersedes" },
      { from: "y", to: "x", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "x", "y"], edges);
    const cycles = findCycles(graph, ["supersedes"]);
    expect(cycles).toHaveLength(2);
    expect(cycles).toContainEqual(["a", "b"]);
    expect(cycles).toContainEqual(["x", "y"]);
  });

  it("ignores edges whose kind is not in cycleEdgeKinds", () => {
    const edges: DecisionGraphEdge<"supersedes" | "depends_on">[] = [
      { from: "a", to: "b", kind: "depends_on" },
      { from: "b", to: "a", kind: "depends_on" },
    ];
    const graph = buildDecisionGraph(["a", "b"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual([]);
  });

  it("only follows the requested cycle edge kinds even when other kinds are present on the same nodes", () => {
    const edges: DecisionGraphEdge<"supersedes" | "depends_on">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "a", kind: "depends_on" },
    ];
    const graph = buildDecisionGraph(["a", "b"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual([]);
  });

  it("does not treat a longer non-cycle path that revisits an already-on-stack non-start node as a cycle", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "c", kind: "supersedes" },
      { from: "c", to: "b", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    const cycles = findCycles(graph, ["supersedes"]);
    expect(cycles).toEqual([["b", "c"]]);
  });

  it("is deterministic across repeated calls on the same graph", () => {
    const edges: DecisionGraphEdge<"supersedes">[] = [
      { from: "a", to: "b", kind: "supersedes" },
      { from: "b", to: "c", kind: "supersedes" },
      { from: "c", to: "a", kind: "supersedes" },
    ];
    const graph = buildDecisionGraph(["a", "b", "c"], edges);
    expect(findCycles(graph, ["supersedes"])).toEqual(findCycles(graph, ["supersedes"]));
  });
});
