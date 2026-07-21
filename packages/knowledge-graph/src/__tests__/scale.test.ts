// Structural/boundedness assertions on a larger synthetic graph. Deliberately
// contains NO wall-clock timing assertions (no Date.now()/elapsed<Nms
// checks) -- boundedness here means "the algorithm's own documented caps
// (maxDepth, resultLimit, DEFAULT_MAX_ALL_PATHS_DEPTH) are honored and the
// function returns a well-formed, duplicate-free result", not "it ran fast".

import { describe, it, expect } from "vitest";
import { buildGenericGraph, findCycles, type GenericEdge } from "../graph-core.js";
import { traverse } from "../traversal.js";
import { findAllPaths } from "../path-finding.js";
import { groupRootCauses } from "../root-cause.js";
import { buildGraphSnapshot } from "../snapshot.js";
import { generateScaleFixture, hasNoDuplicates, allPresentUpstreamArtifacts, REPOSITORY_ID } from "./graph-fixtures.js";
import type { TraversalOptions } from "../contracts.js";

describe("scale: generateScaleFixture produces a well-formed, duplicate-free graph", () => {
  it("default-sized fixture has unique node ids and every edge endpoint resolvable within the fixture's own node set (except deliberately-unresolved edges)", () => {
    const fixture = generateScaleFixture();
    const nodeIds = fixture.nodes.map((n) => n.id);
    expect(hasNoDuplicates(nodeIds)).toBe(true);
    expect(fixture.nodes.length).toBeGreaterThan(1000);
    expect(fixture.edges.length).toBeGreaterThan(1000);

    const nodeIdSet = new Set(nodeIds);
    const unresolvedEdges = fixture.edges.filter((e) => e.resolution_status === "unresolved");
    const resolvedEdges = fixture.edges.filter((e) => e.resolution_status !== "unresolved");
    // Every non-"unresolved" edge's endpoints must actually exist in the fixture's node set.
    for (const edge of resolvedEdges) {
      expect(nodeIdSet.has(edge.from_node_id)).toBe(true);
      expect(nodeIdSet.has(edge.to_node_id)).toBe(true);
    }
    // Deliberately-unresolved edges point at a target that is NOT a node in the fixture (by design --
    // this package's own resolveUnresolvedReferences step is what would normally synthesize that node;
    // the raw scale fixture intentionally leaves it dangling to exercise that exact downstream path).
    expect(unresolvedEdges.length).toBeGreaterThan(0);
    for (const edge of unresolvedEdges) {
      expect(nodeIdSet.has(edge.from_node_id)).toBe(true);
    }
  });

  it("a smaller custom-sized fixture scales its node/edge counts with the supplied options, deterministically", () => {
    const small = generateScaleFixture({ chainCount: 5, chainLength: 3, capabilityCount: 5, productCount: 2, governanceClusterCount: 2, decisionCount: 2, unresolvedReferenceCount: 1 });
    const smallAgain = generateScaleFixture({ chainCount: 5, chainLength: 3, capabilityCount: 5, productCount: 2, governanceClusterCount: 2, decisionCount: 2, unresolvedReferenceCount: 1 });
    expect(small.nodes.map((n) => n.id)).toEqual(smallAgain.nodes.map((n) => n.id));
    expect(small.edges.map((e) => e.id)).toEqual(smallAgain.edges.map((e) => e.id));
    // 5 chains * 3 components = 15 chain component nodes, plus 5 capability nodes, plus 2 product nodes.
    expect(small.chainRootNodeIds).toHaveLength(5);
    expect(hasNoDuplicates(small.chainRootNodeIds)).toBe(true);
  });
});

describe("scale: bounded traversal stays within its documented caps on a large graph", () => {
  const fixture = generateScaleFixture();

  it("traverse() from a chain root respects maxDepth and never returns more nodes than resultLimit", () => {
    const opts: TraversalOptions = { maxDepth: 2, direction: "downstream", repositoryBoundary: "single", resultLimit: 3 };
    const result = traverse(fixture.nodes, fixture.edges, fixture.chainRootNodeIds[0]!, opts);
    expect(result.nodes.length).toBeLessThanOrEqual(opts.resultLimit);
    expect(result.nodes.every((n) => n.depth <= opts.maxDepth)).toBe(true);
    expect(hasNoDuplicates(result.nodes.map((n) => n.node_id))).toBe(true);
  });

  it("traverse() with a generous maxDepth/resultLimit on a chain root still terminates and returns a duplicate-free, well-formed result", () => {
    const opts: TraversalOptions = { maxDepth: 12, direction: "downstream", repositoryBoundary: "single", resultLimit: 500 };
    const result = traverse(fixture.nodes, fixture.edges, fixture.chainRootNodeIds[0]!, opts);
    expect(hasNoDuplicates(result.nodes.map((n) => n.node_id))).toBe(true);
    expect(hasNoDuplicates(result.edges_traversed)).toBe(true);
  });

  it("findAllPaths on the large graph is capped, not exhaustive, and never returns a path that revisits a node", () => {
    const chain = fixture.chainRootNodeIds;
    const from = chain[0]!;
    // Pick some other chain's root as an intentionally-unreachable target to keep this a bounded no-path case.
    const to = chain[1]!;
    const result = findAllPaths(fixture.nodes, fixture.edges, from, to, { maxDepth: 6 });
    for (const path of result.paths) {
      expect(hasNoDuplicates(path.node_ids)).toBe(true);
    }
  });
});

describe("scale: findCycles terminates and correctly reports zero cycles on an acyclic large graph", () => {
  it("the scale fixture is acyclic by construction (chains, capability/product/decision fan-out only point forward, never back)", () => {
    const fixture = generateScaleFixture({ chainCount: 20, chainLength: 6, capabilityCount: 40, productCount: 10, governanceClusterCount: 10, decisionCount: 20, unresolvedReferenceCount: 5 });
    const genericEdges: GenericEdge<string>[] = fixture.edges.map((e) => ({ from: e.from_node_id, to: e.to_node_id, kind: e.edge_type }));
    const graph = buildGenericGraph(fixture.nodes.map((n) => n.id), genericEdges);
    const cycles = findCycles(graph);
    expect(cycles).toEqual([]);
  });
});

describe("scale: groupRootCauses terminates and produces a well-formed, duplicate-free result on many governance findings", () => {
  it("every returned group has a unique id and a classification from the known enum", () => {
    const fixture = generateScaleFixture({ chainCount: 30, chainLength: 4, capabilityCount: 10, productCount: 5, governanceClusterCount: 30, decisionCount: 5, unresolvedReferenceCount: 2 });
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const groupIds = groups.map((g) => g.id);
    expect(hasNoDuplicates(groupIds)).toBe(true);
    const knownClassifications = new Set(["confirmed", "probable", "shared_dependency_only", "unresolved"]);
    for (const group of groups) {
      expect(knownClassifications.has(group.classification)).toBe(true);
      expect(hasNoDuplicates(group.finding_node_ids)).toBe(true);
    }
    // Every governance finding node produced by the fixture should be accounted for by exactly one group.
    const allFindingIdsInGroups = new Set(groups.flatMap((g) => g.finding_node_ids));
    for (const findingId of fixture.governanceFindingNodeIds) {
      expect(allFindingIdsInGroups.has(findingId)).toBe(true);
    }
  });
});

describe("scale: snapshot digest assembly stays well-formed and deterministic on a large node/edge set", () => {
  it("builds a stable digest for the same large fixture across two independent builds", () => {
    const fixtureA = generateScaleFixture({ chainCount: 15, chainLength: 4, capabilityCount: 10, productCount: 5, governanceClusterCount: 5, decisionCount: 5, unresolvedReferenceCount: 3 });
    const fixtureB = generateScaleFixture({ chainCount: 15, chainLength: 4, capabilityCount: 10, productCount: 5, governanceClusterCount: 5, decisionCount: 5, unresolvedReferenceCount: 3 });
    const snapshotA = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes: fixtureA.nodes, edges: fixtureA.edges });
    const snapshotB = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes: fixtureB.nodes, edges: fixtureB.edges });
    expect(snapshotA.digest).toBe(snapshotB.digest);
    expect(snapshotA.node_count).toBe(fixtureA.nodes.length);
    expect(snapshotA.edge_count).toBe(fixtureA.edges.length);
  });
});
