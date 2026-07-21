import { describe, it, expect } from "vitest";
import { buildGenericGraph, findCycles, findOrphanNodes, normalizeCycleKey, type GenericEdge } from "../graph-core.js";

describe("buildGenericGraph", () => {
  it("dedupes and sorts node ids", () => {
    const graph = buildGenericGraph(["b", "a", "a", "c"], []);
    expect(graph.nodeIds).toEqual(["a", "b", "c"]);
  });

  it("sorts edges by (from, to, kind) regardless of input order", () => {
    const edges: GenericEdge<"depends_on" | "contains">[] = [
      { from: "b", to: "a", kind: "depends_on" },
      { from: "a", to: "c", kind: "contains" },
      { from: "a", to: "b", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "c"], edges);
    expect(graph.edges).toEqual([
      { from: "a", to: "b", kind: "depends_on" },
      { from: "a", to: "c", kind: "contains" },
      { from: "b", to: "a", kind: "depends_on" },
    ]);
  });

  it("builds adjacency buckets per source node", () => {
    const edges: GenericEdge<"depends_on">[] = [
      { from: "a", to: "b", kind: "depends_on" },
      { from: "a", to: "c", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "c"], edges);
    expect(graph.adjacency.get("a")?.map((edge) => edge.to)).toEqual(["b", "c"]);
    expect(graph.adjacency.get("b")).toEqual([]);
  });
});

describe("normalizeCycleKey", () => {
  it("rotates to the lexicographically-smallest node before joining", () => {
    expect(normalizeCycleKey(["b", "c", "a"])).toBe("a>b>c");
    expect(normalizeCycleKey(["c", "a", "b"])).toBe("a>b>c");
    expect(normalizeCycleKey(["a", "b", "c"])).toBe("a>b>c");
  });

  it("is rotation-invariant for any rotation of the same cycle", () => {
    const rotations = [
      ["x", "y", "z"],
      ["y", "z", "x"],
      ["z", "x", "y"],
    ];
    const keys = rotations.map(normalizeCycleKey);
    expect(new Set(keys).size).toBe(1);
  });
});

describe("findCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const edges: GenericEdge<"depends_on">[] = [
      { from: "a", to: "b", kind: "depends_on" },
      { from: "b", to: "c", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "c"], edges);
    expect(findCycles(graph)).toEqual([]);
  });

  it("detects a simple 3-node cycle exactly once", () => {
    const edges: GenericEdge<"depends_on">[] = [
      { from: "a", to: "b", kind: "depends_on" },
      { from: "b", to: "c", kind: "depends_on" },
      { from: "c", to: "a", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "c"], edges);
    const cycles = findCycles(graph);
    expect(cycles.length).toBe(1);
    expect(normalizeCycleKey(cycles[0]!)).toBe("a>b>c");
  });

  it("does not report the same cycle twice when discovered from multiple start nodes", () => {
    const edges: GenericEdge<"depends_on">[] = [
      { from: "a", to: "b", kind: "depends_on" },
      { from: "b", to: "c", kind: "depends_on" },
      { from: "c", to: "a", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "c"], edges);
    const keys = findCycles(graph).map(normalizeCycleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays bounded on a densely connected graph (non-start stack revisits are pruned, not followed)", () => {
    // A fully connected 6-node graph would be exponential if every stack
    // revisit were followed; this must still terminate quickly.
    const nodeIds = ["a", "b", "c", "d", "e", "f"];
    const edges: GenericEdge<"depends_on">[] = [];
    for (const from of nodeIds) {
      for (const to of nodeIds) {
        if (from !== to) edges.push({ from, to, kind: "depends_on" });
      }
    }
    const graph = buildGenericGraph(nodeIds, edges);
    const start = Date.now();
    const cycles = findCycles(graph);
    const elapsed = Date.now() - start;
    expect(cycles.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);
  });

  it("returns cycles sorted by normalized key", () => {
    const edges: GenericEdge<"depends_on">[] = [
      { from: "z", to: "y", kind: "depends_on" },
      { from: "y", to: "z", kind: "depends_on" },
      { from: "a", to: "b", kind: "depends_on" },
      { from: "b", to: "a", kind: "depends_on" },
    ];
    const graph = buildGenericGraph(["a", "b", "y", "z"], edges);
    const cycles = findCycles(graph);
    const keys = cycles.map(normalizeCycleKey);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });
});

describe("findOrphanNodes", () => {
  it("returns nodes with zero adjacency and zero incoming edges", () => {
    const edges: GenericEdge<"depends_on">[] = [{ from: "a", to: "b", kind: "depends_on" }];
    const graph = buildGenericGraph(["a", "b", "isolated"], edges);
    expect(findOrphanNodes(graph)).toEqual(["isolated"]);
  });

  it("does not report a node that only has incoming edges as an orphan", () => {
    const edges: GenericEdge<"depends_on">[] = [{ from: "a", to: "b", kind: "depends_on" }];
    const graph = buildGenericGraph(["a", "b"], edges);
    expect(findOrphanNodes(graph)).toEqual([]);
  });

  it("returns an empty array for an empty graph", () => {
    const graph = buildGenericGraph([], []);
    expect(findOrphanNodes(graph)).toEqual([]);
  });

  it("treats every node as an orphan when there are no edges at all", () => {
    const graph = buildGenericGraph(["a", "b"], []);
    expect(findOrphanNodes(graph)).toEqual(["a", "b"]);
  });
});
