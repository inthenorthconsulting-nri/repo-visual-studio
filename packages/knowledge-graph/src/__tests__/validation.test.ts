import { describe, it, expect } from "vitest";
import { MAX_ALLOWED_QUERY_DEPTH, validateGraph, validateImpactQuery, validatePathQuery } from "../validation.js";
import type { KnowledgeGraphBuildResult } from "../graph-builder.js";
import type { RootCauseGroup } from "../contracts.js";
import { buildValidationFindingId } from "../ids.js";
import { DEFAULT_MAX_ALL_PATHS_DEPTH } from "../constants.js";
import { makeEdge, makeNode, REPOSITORY_ID } from "./graph-fixtures.js";

function makeResult(overrides: Partial<KnowledgeGraphBuildResult> = {}): KnowledgeGraphBuildResult {
  return {
    repository_id: REPOSITORY_ID,
    nodes: [],
    edges: [],
    compatibility: { status: "compatible", reasons: [] },
    identity_collisions: [],
    duplicate_edge_findings: [],
    unresolved_reference_node_ids: [],
    snapshot: {
      id: "graph:snapshot:fixture",
      schema_version: 1,
      repository_id: REPOSITORY_ID,
      upstream_artifacts: [],
      node_count: 0,
      edge_count: 0,
      digest: "0".repeat(64),
    },
    ...overrides,
  };
}

describe("validateGraph", () => {
  it("GRAPH_NODE_DUPLICATE_ID: flags a node id appearing more than once, blocking", () => {
    const node = makeNode({ sourceEntityId: "dup" });
    const result = makeResult({ nodes: [node, node] });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_NODE_DUPLICATE_ID");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(true);
    expect(found?.id).toBe(buildValidationFindingId("GRAPH_NODE_DUPLICATE_ID", node.id));
  });

  it("GRAPH_EDGE_SELF_LINK: flags an edge whose from/to are the same node, non-blocking", () => {
    const node = makeNode({ sourceEntityId: "self" });
    const selfEdge = makeEdge({ edgeType: "depends_on", from: node, to: node });
    const result = makeResult({ nodes: [node], edges: [selfEdge] });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_EDGE_SELF_LINK");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
  });

  it("GRAPH_EDGE_MISSING_ENDPOINT: flags an edge whose endpoint isn't in the final node set, blocking", () => {
    const a = makeNode({ sourceEntityId: "missing-endpoint-a" });
    const edge = makeEdge({ edgeType: "depends_on", from: a, to: "graph:node:not-present" });
    const result = makeResult({ nodes: [a], edges: [edge] });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_EDGE_MISSING_ENDPOINT");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(true);
  });

  it("GRAPH_EDGE_DUPLICATE: surfaces every result.duplicate_edge_findings entry, non-blocking", () => {
    const result = makeResult({
      duplicate_edge_findings: [
        { edge_key: "graph:edge:a:depends_on:b", edge_id: "graph:edge:a:depends_on:b", conflicting_details: ["d1", "d2"], conflicting_resolution_statuses: ["resolved", "partial"] },
      ],
    });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_EDGE_DUPLICATE");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
    expect(found?.subject_id).toBe("graph:edge:a:depends_on:b");
  });

  it("GRAPH_IDENTITY_COLLISION: surfaces every result.identity_collisions entry, blocking", () => {
    const result = makeResult({
      identity_collisions: [{ identity_key: "architecture::foo", node_ids: ["graph:node:foo", "graph:node:foo-alt"] }],
    });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_IDENTITY_COLLISION");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(true);
  });

  it("GRAPH_REFERENCE_BROKEN: flags an edge touching an unresolved_reference node, non-blocking", () => {
    const a = makeNode({ sourceEntityId: "ref-broken-a" });
    const unresolved = makeNode({ sourceEntityId: "ref-broken-missing", nodeType: "unresolved_reference", resolutionStatus: "unresolved", confidence: "unverifiable" });
    const edge = makeEdge({ edgeType: "depends_on", from: a, to: unresolved, resolutionStatus: "unresolved" });
    const result = makeResult({ nodes: [a, unresolved], edges: [edge] });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_REFERENCE_BROKEN");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
  });

  it("GRAPH_CYCLE_INVALID_CONTAINMENT: flags a cycle among 'contains' edges, blocking", () => {
    const x = makeNode({ sourceEntityId: "contain-cycle-x" });
    const y = makeNode({ sourceEntityId: "contain-cycle-y" });
    const edges = [makeEdge({ edgeType: "contains", from: x, to: y }), makeEdge({ edgeType: "contains", from: y, to: x })];
    const result = makeResult({ nodes: [x, y], edges });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_CYCLE_INVALID_CONTAINMENT");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(true);
  });

  it("GRAPH_CYCLE_DETECTED: flags a cycle among causal (e.g. depends_on) edges, non-blocking", () => {
    const x = makeNode({ sourceEntityId: "causal-cycle-x" });
    const y = makeNode({ sourceEntityId: "causal-cycle-y" });
    const edges = [makeEdge({ edgeType: "depends_on", from: x, to: y }), makeEdge({ edgeType: "depends_on", from: y, to: x })];
    const result = makeResult({ nodes: [x, y], edges });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_CYCLE_DETECTED");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
  });

  it("GRAPH_ROOT_CAUSE_INSUFFICIENT_ANCHOR: flags an 'unresolved' root-cause group passed in by the caller, non-blocking", () => {
    const rootCauseGroups: RootCauseGroup[] = [
      {
        id: "graph:root-cause:multi:abc",
        schema_version: 1,
        finding_node_ids: ["graph:node:finding-1"],
        candidate_root_node_ids: [],
        classification: "unresolved",
        detail: "anchor unresolved",
        evidence_refs: [],
      },
    ];
    const findings = validateGraph(makeResult(), rootCauseGroups);
    const found = findings.find((f) => f.code === "GRAPH_ROOT_CAUSE_INSUFFICIENT_ANCHOR");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
    expect(found?.subject_id).toBe("graph:node:finding-1");
  });

  it("does not flag non-'unresolved' root-cause groups", () => {
    const rootCauseGroups: RootCauseGroup[] = [
      {
        id: "graph:root-cause:x",
        schema_version: 1,
        finding_node_ids: ["graph:node:finding-1"],
        candidate_root_node_ids: ["graph:node:x"],
        classification: "confirmed",
        detail: "fine",
        evidence_refs: [],
      },
    ];
    const findings = validateGraph(makeResult(), rootCauseGroups);
    expect(findings.find((f) => f.code === "GRAPH_ROOT_CAUSE_INSUFFICIENT_ANCHOR")).toBeUndefined();
  });

  it("GRAPH_DECISION_UNRESOLVED_REFERENCE: flags a decision edge pointing at an unresolved_reference node, non-blocking", () => {
    const decision = makeNode({ sourceEntityId: "decision-broken", nodeType: "decision", sourceArtifact: "decision" });
    const unresolved = makeNode({ sourceEntityId: "decision-broken-missing", nodeType: "unresolved_reference", resolutionStatus: "unresolved", confidence: "unverifiable" });
    const edge = makeEdge({ edgeType: "references", from: decision, to: unresolved, resolutionStatus: "unresolved" });
    const result = makeResult({ nodes: [decision, unresolved], edges: [edge] });
    const findings = validateGraph(result);
    const found = findings.find((f) => f.code === "GRAPH_DECISION_UNRESOLVED_REFERENCE");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
  });

  it("GRAPH_COMPATIBILITY_INCOMPATIBLE_SET / PARTIAL_SET / WARNING mirror result.compatibility.status", () => {
    const incompatible = validateGraph(makeResult({ compatibility: { status: "incompatible", reasons: ["no artifacts"] } }));
    expect(incompatible.find((f) => f.code === "GRAPH_COMPATIBILITY_INCOMPATIBLE_SET")?.blocking).toBe(true);

    const partial = validateGraph(makeResult({ compatibility: { status: "partial", reasons: ["missing capability"] } }));
    expect(partial.find((f) => f.code === "GRAPH_COMPATIBILITY_PARTIAL_SET")?.blocking).toBe(false);

    const warning = validateGraph(makeResult({ compatibility: { status: "compatible_with_warnings", reasons: ["time skew"] } }));
    expect(warning.find((f) => f.code === "GRAPH_COMPATIBILITY_WARNING")?.blocking).toBe(false);

    const compatible = validateGraph(makeResult({ compatibility: { status: "compatible", reasons: [] } }));
    expect(compatible.some((f) => f.code.startsWith("GRAPH_COMPATIBILITY_"))).toBe(false);
  });

  it("returns findings sorted by id", () => {
    const a = makeNode({ sourceEntityId: "sort-a" });
    const b = makeNode({ sourceEntityId: "sort-b" });
    const selfEdgeA = makeEdge({ edgeType: "depends_on", from: a, to: a });
    const selfEdgeB = makeEdge({ edgeType: "depends_on", from: b, to: b });
    const result = makeResult({ nodes: [a, b], edges: [selfEdgeA, selfEdgeB] });
    const findings = validateGraph(result);
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("returns no findings for a clean, empty graph", () => {
    expect(validateGraph(makeResult())).toEqual([]);
  });
});

describe("validateImpactQuery", () => {
  it("GRAPH_IMPACT_INVALID_DEPTH: flags a non-positive or non-integer max_depth, blocking", () => {
    const zero = validateImpactQuery({ entity_node_id: "graph:node:a", max_depth: 0, direction: "downstream" });
    expect(zero.find((f) => f.code === "GRAPH_IMPACT_INVALID_DEPTH")?.blocking).toBe(true);

    const fractional = validateImpactQuery({ entity_node_id: "graph:node:a", max_depth: 2.5, direction: "downstream" });
    expect(fractional.find((f) => f.code === "GRAPH_IMPACT_INVALID_DEPTH")).toBeDefined();
  });

  it("GRAPH_IMPACT_UNBOUNDED_DEPTH: flags max_depth beyond the allowed ceiling, blocking", () => {
    const tooDeep = validateImpactQuery({ entity_node_id: "graph:node:a", max_depth: MAX_ALLOWED_QUERY_DEPTH + 1, direction: "downstream" });
    expect(tooDeep.find((f) => f.code === "GRAPH_IMPACT_UNBOUNDED_DEPTH")?.blocking).toBe(true);
  });

  it("returns no findings for a valid, in-bounds query", () => {
    expect(validateImpactQuery({ entity_node_id: "graph:node:a", max_depth: 5, direction: "downstream" })).toEqual([]);
  });
});

describe("validatePathQuery", () => {
  it("GRAPH_PATH_INVALID_DEPTH: flags a non-positive or non-integer maxDepth, blocking", () => {
    const findings = validatePathQuery("graph:node:a", "graph:node:b", { maxDepth: 0, direction: "downstream" }, false);
    expect(findings.find((f) => f.code === "GRAPH_PATH_INVALID_DEPTH")?.blocking).toBe(true);
  });

  it("GRAPH_PATH_UNBOUNDED_DEPTH: flags maxDepth beyond the allowed ceiling, blocking", () => {
    const findings = validatePathQuery(
      "graph:node:a",
      "graph:node:b",
      { maxDepth: MAX_ALLOWED_QUERY_DEPTH + 1, direction: "downstream" },
      false,
    );
    expect(findings.find((f) => f.code === "GRAPH_PATH_UNBOUNDED_DEPTH")?.blocking).toBe(true);
  });

  it("GRAPH_PATH_ALL_PATHS_DEPTH_HIGH: flags --all with maxDepth above the default all-paths depth, non-blocking", () => {
    const findings = validatePathQuery(
      "graph:node:a",
      "graph:node:b",
      { maxDepth: DEFAULT_MAX_ALL_PATHS_DEPTH + 1, direction: "downstream" },
      true,
    );
    const found = findings.find((f) => f.code === "GRAPH_PATH_ALL_PATHS_DEPTH_HIGH");
    expect(found).toBeDefined();
    expect(found?.blocking).toBe(false);
  });

  it("does not flag ALL_PATHS_DEPTH_HIGH when --all is false, even above the default depth", () => {
    const findings = validatePathQuery(
      "graph:node:a",
      "graph:node:b",
      { maxDepth: DEFAULT_MAX_ALL_PATHS_DEPTH + 1, direction: "downstream" },
      false,
    );
    expect(findings.find((f) => f.code === "GRAPH_PATH_ALL_PATHS_DEPTH_HIGH")).toBeUndefined();
  });

  it("returns no findings for a valid, in-bounds query without --all", () => {
    expect(validatePathQuery("graph:node:a", "graph:node:b", { maxDepth: 5, direction: "downstream" }, false)).toEqual([]);
  });
});
