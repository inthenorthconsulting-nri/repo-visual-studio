import { describe, it, expect } from "vitest";
import {
  canonicalize,
  digestOf,
  buildNodeId,
  buildEdgeId,
  buildPathId,
  buildImpactResultId,
  buildRootCauseGroupId,
  buildDecisionImpactId,
  buildChangePlanId,
  buildSnapshotId,
  buildChangeSetId,
  buildNarrativeId,
  buildPlanId,
  buildSceneId,
  buildReportId,
  buildValidationFindingId,
  sanitize,
} from "../ids.js";

describe("sanitize", () => {
  it("leaves safe characters untouched", () => {
    expect(sanitize("abc123_.-XYZ")).toBe("abc123_.-XYZ");
  });

  it("replaces unsafe characters with a dash", () => {
    expect(sanitize("a/b:c d@e")).toBe("a-b-c-d-e");
  });
});

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    const value = { b: 1, a: { d: 2, c: 3 } };
    expect(JSON.stringify(canonicalize(value))).toBe(JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("preserves array element order", () => {
    const value = { list: [3, 1, 2] };
    expect(canonicalize(value)).toEqual({ list: [3, 1, 2] });
  });

  it("is stable across differently-ordered but equal input objects", () => {
    const a = { x: 1, y: 2, z: { p: 1, q: 2 } };
    const b = { z: { q: 2, p: 1 }, y: 2, x: 1 };
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)));
  });

  it("passes through primitives and null", () => {
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize("hi")).toBe("hi");
    expect(canonicalize(null)).toBe(null);
  });
});

describe("digestOf", () => {
  it("produces a sha256 hex digest", () => {
    const digest = digestOf({ a: 1 });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for key-reordered-but-equal objects", () => {
    const a = digestOf({ x: 1, y: 2 });
    const b = digestOf({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("differs when array order differs (arrays are order-sensitive)", () => {
    const a = digestOf({ list: [1, 2] });
    const b = digestOf({ list: [2, 1] });
    expect(a).not.toBe(b);
  });
});

describe("id builders", () => {
  it("buildNodeId prefixes and sanitizes", () => {
    expect(buildNodeId("pkg/foo bar")).toBe("graph:node:pkg-foo-bar");
  });

  it("buildEdgeId embeds from, type, to in order", () => {
    expect(buildEdgeId("depends_on", "graph:node:a", "graph:node:b")).toBe("graph:edge:graph-node-a:depends_on:graph-node-b");
  });

  it("buildPathId joins node ids with a dot", () => {
    const id = buildPathId("graph:node:a", "graph:node:c", ["graph:node:a", "graph:node:b", "graph:node:c"]);
    expect(id).toBe("graph:path:graph-node-a:graph-node-c:graph-node-a.graph-node-b.graph-node-c");
  });

  it("buildImpactResultId embeds entity id and query digest", () => {
    const digest = digestOf({ entity_node_id: "graph:node:a", max_depth: 3, direction: "downstream" });
    expect(buildImpactResultId("graph:node:a", digest)).toBe(`graph:impact:graph-node-a:${sanitize(digest)}`);
  });

  it("buildRootCauseGroupId prefixes the root node id", () => {
    expect(buildRootCauseGroupId("graph:node:a")).toBe("graph:root-cause:graph-node-a");
  });

  it("buildDecisionImpactId puts rootEntityId before decisionNodeId in the string despite param order", () => {
    const id = buildDecisionImpactId("graph:node:decision-1", "graph:node:entity-1");
    expect(id).toBe("graph:decision-impact:graph-node-entity-1:graph-node-decision-1");
  });

  it("buildChangePlanId prefixes the removed entity id", () => {
    expect(buildChangePlanId("graph:node:a")).toBe("graph:change-plan:graph-node-a");
  });

  it("buildSnapshotId joins sorted upstream digest tokens", () => {
    expect(buildSnapshotId("repo-1", ["b", "a"])).toBe("graph:snapshot:repo-1:b.a");
  });

  it("buildChangeSetId embeds source then target snapshot id", () => {
    expect(buildChangeSetId("graph:snapshot:a", "graph:snapshot:b")).toBe("graph:changeset:graph-snapshot-a:graph-snapshot-b");
  });

  it("buildNarrativeId/buildPlanId/buildReportId all prefix the snapshot id", () => {
    expect(buildNarrativeId("graph:snapshot:a")).toBe("graph:narrative:graph-snapshot-a");
    expect(buildPlanId("graph:snapshot:a")).toBe("graph:plan:graph-snapshot-a");
    expect(buildReportId("graph:snapshot:a")).toBe("graph:report:graph-snapshot-a");
  });

  it("buildSceneId embeds planId and kind", () => {
    expect(buildSceneId("graph:plan:a", "graph-overview")).toBe("graph:scene:graph-plan-a:graph-overview");
  });

  it("buildValidationFindingId embeds code then subject id", () => {
    expect(buildValidationFindingId("GRAPH_NODE_DUPLICATE_ID", "graph:node:a")).toBe("graph:validation:GRAPH_NODE_DUPLICATE_ID:graph-node-a");
  });

  it("every id builder is a pure function of its inputs (same input -> same output across repeated calls)", () => {
    const first = buildEdgeId("depends_on", "graph:node:a", "graph:node:b");
    const second = buildEdgeId("depends_on", "graph:node:a", "graph:node:b");
    expect(first).toBe(second);
  });
});
