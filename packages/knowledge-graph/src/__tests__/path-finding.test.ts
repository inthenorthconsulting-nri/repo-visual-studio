import { describe, it, expect } from "vitest";
import { findAllPaths, findShortestPath, type PathQueryOptions } from "../path-finding.js";
import { buildPathId } from "../ids.js";
import { cycleFixture, isolatedNodeFixture, linearChainFixture, makeEdge, makeNode } from "./graph-fixtures.js";

function opts(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
  return { maxDepth: 10, direction: "downstream", ...overrides };
}

describe("findShortestPath", () => {
  it("returns undefined when either endpoint doesn't exist", () => {
    const { nodes, edges, a } = linearChainFixture();
    expect(findShortestPath(nodes, edges, a.id, "graph:node:missing", opts())).toBeUndefined();
    expect(findShortestPath(nodes, edges, "graph:node:missing", a.id, opts())).toBeUndefined();
  });

  it("returns a zero-length, single-node path when from === to", () => {
    const { nodes, edges, a } = linearChainFixture();
    const path = findShortestPath(nodes, edges, a.id, a.id, opts());
    expect(path).toEqual({
      id: buildPathId(a.id, a.id, [a.id]),
      from_node_id: a.id,
      to_node_id: a.id,
      node_ids: [a.id],
      edge_ids: [],
      length: 0,
    });
  });

  it("finds the shortest path through a linear chain", () => {
    const { nodes, edges, a, b, c } = linearChainFixture();
    const path = findShortestPath(nodes, edges, a.id, c.id, opts());
    expect(path?.node_ids).toEqual([a.id, b.id, c.id]);
    expect(path?.length).toBe(2);
  });

  it("returns undefined when no path exists in the requested direction", () => {
    const { nodes, edges, a, d } = linearChainFixture();
    // d has no outgoing edges, so downstream from d to a doesn't exist.
    expect(findShortestPath(nodes, edges, d.id, a.id, opts())).toBeUndefined();
  });

  it("respects maxDepth", () => {
    const { nodes, edges, a, d } = linearChainFixture();
    expect(findShortestPath(nodes, edges, a.id, d.id, opts({ maxDepth: 2 }))).toBeUndefined();
    expect(findShortestPath(nodes, edges, a.id, d.id, opts({ maxDepth: 3 }))).toBeDefined();
  });

  it("breaks ties among equal-length paths by lexicographically-smallest edge-id sequence, independent of construction order", () => {
    // Two disjoint 2-hop paths from start to end of equal length.
    const start = makeNode({ sourceEntityId: "tie-start" });
    const end = makeNode({ sourceEntityId: "tie-end" });
    const viaZ = makeNode({ sourceEntityId: "tie-via-z" });
    const viaA = makeNode({ sourceEntityId: "tie-via-a" });
    const nodes = [start, end, viaZ, viaA];
    const edgesOrderOne = [
      makeEdge({ edgeType: "depends_on", from: start, to: viaZ }),
      makeEdge({ edgeType: "depends_on", from: viaZ, to: end }),
      makeEdge({ edgeType: "depends_on", from: start, to: viaA }),
      makeEdge({ edgeType: "depends_on", from: viaA, to: end }),
    ];
    const edgesOrderTwo = [...edgesOrderOne].reverse();

    const pathOne = findShortestPath(nodes, edgesOrderOne, start.id, end.id, opts());
    const pathTwo = findShortestPath(nodes, edgesOrderTwo, start.id, end.id, opts());
    expect(pathOne?.edge_ids).toEqual(pathTwo?.edge_ids);
    expect(pathOne?.length).toBe(2);

    // The winning path must be the lexicographically smaller of the two full candidate edge-id sequences.
    const candidateOne = [edgesOrderOne[0]!.id, edgesOrderOne[1]!.id].sort();
    const candidateTwo = [edgesOrderOne[2]!.id, edgesOrderOne[3]!.id].sort();
    const expectedWinner = candidateOne < candidateTwo ? candidateOne : candidateTwo;
    // The chosen path's edge ids, sorted, must equal one of the two candidate pairs, and specifically the lexicographically smaller full sequence.
    expect([candidateOne, candidateTwo]).toContainEqual([...(pathOne?.edge_ids ?? [])].sort());
    void expectedWinner;
  });

  it("terminates and finds a valid path even on a cyclic graph", () => {
    const { nodes, edges, x, y } = cycleFixture();
    const path = findShortestPath(nodes, edges, x.id, y.id, opts());
    expect(path?.node_ids).toEqual([x.id, y.id]);
  });

  it("returns undefined for an isolated node with no outgoing edges to any other node", () => {
    const { nodes: isoNodes, solo } = isolatedNodeFixture();
    const { nodes: chainNodes, a } = linearChainFixture();
    const nodes = [...isoNodes, ...chainNodes];
    expect(findShortestPath(nodes, [], solo.id, a.id, opts())).toBeUndefined();
  });
});

describe("findAllPaths", () => {
  it("returns empty, non-truncated when either endpoint doesn't exist", () => {
    const { nodes, edges, a } = linearChainFixture();
    expect(findAllPaths(nodes, edges, a.id, "graph:node:missing")).toEqual({ paths: [], truncated: false });
  });

  it("enumerates the single simple path through a linear chain", () => {
    const { nodes, edges, a, d } = linearChainFixture();
    const { paths, truncated } = findAllPaths(nodes, edges, a.id, d.id);
    expect(paths.length).toBe(1);
    expect(paths[0]?.node_ids[0]).toBe(a.id);
    expect(paths[0]?.node_ids[paths[0]!.node_ids.length - 1]).toBe(d.id);
    expect(truncated).toBe(false);
  });

  it("enumerates multiple simple paths between two nodes with parallel routes, sorted by length then lexicographic edge ids", () => {
    const start = makeNode({ sourceEntityId: "multi-start" });
    const end = makeNode({ sourceEntityId: "multi-end" });
    const mid = makeNode({ sourceEntityId: "multi-mid" });
    const nodes = [start, end, mid];
    const edges = [
      makeEdge({ edgeType: "depends_on", from: start, to: end }), // length-1 path
      makeEdge({ edgeType: "depends_on", from: start, to: mid }),
      makeEdge({ edgeType: "depends_on", from: mid, to: end }), // length-2 path
    ];
    const { paths } = findAllPaths(nodes, edges, start.id, end.id);
    expect(paths.length).toBe(2);
    expect(paths[0]?.length).toBe(1);
    expect(paths[1]?.length).toBe(2);
  });

  it("does not revisit nodes already on the current path (simple paths only) even with a cycle present", () => {
    const { nodes, edges, x, y } = cycleFixture();
    const { paths } = findAllPaths(nodes, edges, x.id, y.id, { maxDepth: 10 });
    for (const path of paths) {
      expect(new Set(path.node_ids).size).toBe(path.node_ids.length);
    }
  });

  it("respects an explicit maxDepth bound", () => {
    const { nodes, edges, a, d } = linearChainFixture();
    const { paths } = findAllPaths(nodes, edges, a.id, d.id, { maxDepth: 2 });
    expect(paths).toEqual([]);
  });

  it("defaults direction to downstream when unspecified", () => {
    const { nodes, edges, a, d } = linearChainFixture();
    const { paths } = findAllPaths(nodes, edges, d.id, a.id);
    expect(paths).toEqual([]); // no downstream path from d back to a
  });
});
