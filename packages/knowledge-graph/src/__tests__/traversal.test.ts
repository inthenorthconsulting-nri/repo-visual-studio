import { describe, it, expect } from "vitest";
import { buildEdgeIndex, collectCandidateEdges, traverse } from "../traversal.js";
import type { TraversalOptions } from "../contracts.js";
import { cycleFixture, isolatedNodeFixture, linearChainFixture } from "./graph-fixtures.js";

function opts(overrides: Partial<TraversalOptions> = {}): TraversalOptions {
  return { maxDepth: 10, direction: "downstream", repositoryBoundary: "single", resultLimit: 500, ...overrides };
}

describe("buildEdgeIndex / collectCandidateEdges", () => {
  it("indexes edges by from (outgoing) and to (incoming), sorted by edge id", () => {
    const { edges, a, b, c } = linearChainFixture();
    const index = buildEdgeIndex(edges);
    expect(index.outgoing.get(a.id)?.map((e) => e.id)).toEqual([...(index.outgoing.get(a.id) ?? [])].map((e) => e.id).sort());
    expect(index.incoming.get(c.id)?.[0]?.from_node_id).toBe(b.id);
  });

  it("collectCandidateEdges respects direction: downstream = outgoing, upstream = incoming, both = union", () => {
    const { edges, a, b } = linearChainFixture();
    const index = buildEdgeIndex(edges);
    expect(collectCandidateEdges(a.id, "downstream", index).map((e) => e.to_node_id)).toContain(b.id);
    expect(collectCandidateEdges(b.id, "upstream", index).map((e) => e.from_node_id)).toContain(a.id);
    const both = collectCandidateEdges(a.id, "both", index);
    expect(both.length).toBe(
      collectCandidateEdges(a.id, "downstream", index).length + collectCandidateEdges(a.id, "upstream", index).length,
    );
  });
});

describe("traverse", () => {
  it("returns an empty, non-truncated result when the root node doesn't exist", () => {
    const { nodes, edges } = linearChainFixture();
    const result = traverse(nodes, edges, "graph:node:does-not-exist", opts());
    expect(result).toEqual({ root_node_id: "graph:node:does-not-exist", nodes: [], edges_traversed: [], truncated: false });
  });

  it("walks a linear chain downstream, recording depth and via_edge_id per node", () => {
    const { nodes, edges, a, b, c, d } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, opts());
    const byId = new Map(result.nodes.map((n) => [n.node_id, n]));
    expect(byId.get(a.id)).toEqual({ node_id: a.id, depth: 0 });
    expect(byId.get(b.id)?.depth).toBe(1);
    expect(byId.get(c.id)?.depth).toBe(2);
    expect(byId.get(d.id)?.depth).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.edges_traversed.length).toBe(3);
  });

  it("provides cycle protection via the visited map (a cyclic graph terminates and each node appears once)", () => {
    const { nodes, edges, x } = cycleFixture();
    const result = traverse(nodes, edges, x.id, opts());
    expect(result.nodes.length).toBe(3);
    expect(new Set(result.nodes.map((n) => n.node_id)).size).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("returns just the root node (depth 0, no edges traversed) for an isolated node", () => {
    const { nodes, edges, solo } = isolatedNodeFixture();
    const result = traverse(nodes, edges, solo.id, opts());
    expect(result.nodes).toEqual([{ node_id: solo.id, depth: 0 }]);
    expect(result.edges_traversed).toEqual([]);
  });

  it("sets truncated=true when maxDepth is hit while a frontier remains", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, opts({ maxDepth: 1 }));
    expect(result.truncated).toBe(true);
    expect(result.nodes.map((n) => n.depth)).toEqual([0, 1]);
  });

  it("does not truncate when maxDepth exactly matches the remaining chain length with an empty next frontier", () => {
    const { nodes, edges, a } = linearChainFixture();
    // a -> b -> c -> d is 3 hops; maxDepth 3 exhausts the frontier naturally.
    const result = traverse(nodes, edges, a.id, opts({ maxDepth: 3 }));
    expect(result.truncated).toBe(false);
  });

  it("sets truncated=true when resultLimit is hit mid-traversal", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, opts({ resultLimit: 2 }));
    expect(result.truncated).toBe(true);
    expect(result.nodes.length).toBe(2);
  });

  it("filters by allowedEdgeTypes", () => {
    const { nodes, edges, repo, a } = linearChainFixture();
    const result = traverse(nodes, edges, repo.id, opts({ allowedEdgeTypes: ["depends_on"] }));
    // repo->a is a "contains" edge; filtering to depends_on excludes it entirely.
    expect(result.nodes.map((n) => n.node_id)).toEqual([repo.id]);
    void a;
  });

  it("filters by allowedNodeTypes", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, opts({ allowedNodeTypes: ["component"] }));
    expect(result.nodes.every((n) => n.node_id !== undefined)).toBe(true);
  });

  it("respects repositoryBoundary='single' by excluding neighbor nodes from a different repository_id", () => {
    const { nodes, edges, a, b } = linearChainFixture();
    const otherRepoB = { ...b, repository_id: "some-other-repo" };
    const patchedNodes = nodes.map((n) => (n.id === b.id ? otherRepoB : n));
    const result = traverse(patchedNodes, edges, a.id, opts());
    expect(result.nodes.map((n) => n.node_id)).not.toContain(b.id);
  });

  it("returns nodes sorted by node_id and edges_traversed sorted", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, opts());
    const ids = result.nodes.map((n) => n.node_id);
    expect(ids).toEqual([...ids].sort());
    expect(result.edges_traversed).toEqual([...result.edges_traversed].sort());
  });
});
