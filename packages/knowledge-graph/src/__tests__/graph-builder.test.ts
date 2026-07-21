import { describe, it, expect } from "vitest";
import { buildKnowledgeGraph, type KnowledgeGraphBuildInput } from "../graph-builder.js";
import { buildNodeId } from "../ids.js";

describe("resolveRepositoryId (via buildKnowledgeGraph)", () => {
  it("throws a descriptive error when no upstream artifact and no repositoryIdHint resolves an id", () => {
    expect(() => buildKnowledgeGraph({})).toThrowError(
      /Unable to resolve a repository identity from any upstream artifact.*Cannot build a knowledge graph\./,
    );
  });

  it("prefers architecture.identity.id over governance.repository_id, decision.repository_id, and repositoryIdHint", () => {
    const result = buildKnowledgeGraph({
      architecture: { identity: { id: "from-architecture" } },
      governance: { repository_id: "from-governance" },
      decision: { repository_id: "from-decision" },
      repositoryIdHint: "from-hint",
    });
    expect(result.repository_id).toBe("from-architecture");
  });

  it("falls back to governance.repository_id when architecture is absent", () => {
    const result = buildKnowledgeGraph({ governance: { repository_id: "from-governance" }, decision: { repository_id: "from-decision" } });
    expect(result.repository_id).toBe("from-governance");
  });

  it("falls back to decision.repository_id when architecture and governance are absent", () => {
    const result = buildKnowledgeGraph({ decision: { repository_id: "from-decision" }, repositoryIdHint: "from-hint" });
    expect(result.repository_id).toBe("from-decision");
  });

  it("falls back to repositoryIdHint as the last resort", () => {
    const result = buildKnowledgeGraph({ repositoryIdHint: "from-hint" });
    expect(result.repository_id).toBe("from-hint");
  });
});

function fullInput(overrides: Partial<KnowledgeGraphBuildInput> = {}): KnowledgeGraphBuildInput {
  return {
    architecture: {
      identity: { id: "repo-x" },
      components: [{ id: "comp-a" }],
    },
    capability: {
      domains: [{ id: "dom-1" }],
      includedCapabilities: [{ id: "cap-1", domainId: "dom-1", logicalComponents: ["comp-a"] }],
    },
    ...overrides,
  };
}

describe("buildKnowledgeGraph pipeline", () => {
  it("builds nodes and edges from multiple domains and wires them together correctly", () => {
    const result = buildKnowledgeGraph(fullInput());
    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain(buildNodeId("repo-x"));
    expect(nodeIds).toContain(buildNodeId("comp-a"));
    expect(nodeIds).toContain(buildNodeId("dom-1"));
    expect(nodeIds).toContain(buildNodeId("cap-1"));

    const edgeTypes = result.edges.map((e) => e.edge_type);
    expect(edgeTypes).toContain("contains"); // repo->comp and dom->cap
    expect(edgeTypes).toContain("depends_on"); // cap->comp
    expect(result.unresolved_reference_node_ids).toEqual([]);
  });

  it("promotes a dangling edge endpoint to a synthesized unresolved_reference node rather than dropping the edge", () => {
    const result = buildKnowledgeGraph(
      fullInput({
        capability: {
          domains: [{ id: "dom-1" }],
          includedCapabilities: [{ id: "cap-1", domainId: "dom-1", logicalComponents: ["comp-a", "comp-missing"] }],
        },
      }),
    );
    const unresolvedNode = result.nodes.find((n) => n.id === buildNodeId("comp-missing"));
    expect(unresolvedNode).toBeDefined();
    expect(unresolvedNode!.node_type).toBe("unresolved_reference");
    expect(unresolvedNode!.resolution_status).toBe("unresolved");
    expect(result.unresolved_reference_node_ids).toContain(buildNodeId("comp-missing"));

    const patchedEdge = result.edges.find((e) => e.to_node_id === buildNodeId("comp-missing"));
    expect(patchedEdge).toBeDefined();
    expect(patchedEdge!.resolution_status).toBe("unresolved");
  });

  it("detects and records a duplicate/contradictory edge (same edge id, differing detail+resolution) while keeping exactly one edge", () => {
    const result = buildKnowledgeGraph(
      fullInput({
        decision: { decisions: [{ id: "dec-1", title: "Decision One" }] },
        decisionLinks: {
          links: [
            { id: "link-1", decision_id: "dec-1", target_id: "comp-a", resolution: "resolved", detail: "first link" },
            { id: "link-2", decision_id: "dec-1", target_id: "comp-a", resolution: "ambiguous", detail: "second link" },
          ],
        },
      }),
    );

    const referencesEdges = result.edges.filter(
      (e) => e.edge_type === "references" && e.from_node_id === buildNodeId("dec-1") && e.to_node_id === buildNodeId("comp-a"),
    );
    // Both links collapse to the same (edge_type, from, to) id, so only one surviving edge.
    expect(referencesEdges).toHaveLength(1);
    // First-encountered (stable input order) wins.
    expect(referencesEdges[0]!.detail).toBe("first link");
    expect(referencesEdges[0]!.resolution_status).toBe("resolved");

    expect(result.duplicate_edge_findings).toHaveLength(1);
    const finding = result.duplicate_edge_findings[0]!;
    expect(finding.edge_id).toBe(referencesEdges[0]!.id);
    expect(finding.conflicting_details.sort()).toEqual(["first link", "second link"]);
    expect(finding.conflicting_resolution_statuses.sort()).toEqual(["ambiguous", "resolved"]);
  });

  it("silently merges (evidence-unions) two edges with the same id that share identical detail+status, without recording a duplicate finding", () => {
    const result = buildKnowledgeGraph(
      fullInput({
        capability: {
          domains: [{ id: "dom-1" }],
          // Same capability listed in two groups -> two candidate `contains` edges from dom-1 to cap-1
          // with the identical fixed detail string, so they must merge silently.
          includedCapabilities: [{ id: "cap-1", domainId: "dom-1" }],
          qualifiedCapabilities: [{ id: "cap-1", domainId: "dom-1" }],
        },
      }),
    );
    const containsEdges = result.edges.filter(
      (e) => e.edge_type === "contains" && e.from_node_id === buildNodeId("dom-1") && e.to_node_id === buildNodeId("cap-1"),
    );
    expect(containsEdges).toHaveLength(1);
    expect(result.duplicate_edge_findings).toEqual([]);
  });

  it("records an identity collision when two different domains independently use the same literal entity id string", () => {
    const result = buildKnowledgeGraph(
      fullInput({
        governance: { policies: [{ id: "shared-id", name: "Shared Policy" }] },
        decision: { decisions: [{ id: "shared-id", title: "Shared Decision" }] },
      }),
    );
    // Both candidate nodes resolve to the identical node id (buildNodeId is a pure function of the entity id
    // string alone), but they come from different (source_artifact, source_entity_id) identities.
    expect(result.identity_collisions.length).toBeGreaterThan(0);
    const collidingNode = result.nodes.find((n) => n.id === buildNodeId("shared-id"));
    expect(collidingNode).toBeDefined();
  });

  it("integrates compatibility assessment based on which artifacts are present", () => {
    const architectureOnly = buildKnowledgeGraph({ architecture: { identity: { id: "repo-x" } } });
    expect(architectureOnly.compatibility.status).not.toBe("incompatible");

    const conflictingRepoIds = buildKnowledgeGraph({
      architecture: { identity: { id: "repo-x" } },
      governance: { repository_id: "repo-y" },
    });
    expect(conflictingRepoIds.compatibility.status).toBe("incompatible");
  });

  it("produces deterministically sorted nodes (by id) and edges (by edge_type, from_node_id, to_node_id)", () => {
    const result = buildKnowledgeGraph(
      fullInput({
        architecture: {
          identity: { id: "repo-x" },
          components: [{ id: "comp-z" }, { id: "comp-a" }, { id: "comp-m" }],
        },
        capability: undefined,
      }),
    );
    const nodeIds = result.nodes.map((n) => n.id);
    expect([...nodeIds].sort()).toEqual(nodeIds);
    const edgeSortKeys = result.edges.map((e) => `${e.edge_type}|${e.from_node_id}|${e.to_node_id}`);
    expect([...edgeSortKeys].sort()).toEqual(edgeSortKeys);
  });

  it("assembles a snapshot whose node_count/edge_count reflect the final (post-unresolved-reference) node/edge arrays", () => {
    const result = buildKnowledgeGraph(fullInput());
    expect(result.snapshot.repository_id).toBe("repo-x");
    expect(result.snapshot.node_count).toBe(result.nodes.length);
    expect(result.snapshot.edge_count).toBe(result.edges.length);
  });

  it("is deterministic: rebuilding from input with independent-array fields reordered produces the same final node/edge id sets and snapshot digest", () => {
    const first = buildKnowledgeGraph(
      fullInput({
        architecture: { identity: { id: "repo-x" }, components: [{ id: "comp-a" }, { id: "comp-b" }] },
        capability: undefined,
      }),
    );
    const second = buildKnowledgeGraph(
      fullInput({
        architecture: { identity: { id: "repo-x" }, components: [{ id: "comp-b" }, { id: "comp-a" }] },
        capability: undefined,
      }),
    );
    expect(first.nodes.map((n) => n.id)).toEqual(second.nodes.map((n) => n.id));
    expect(first.edges.map((e) => e.id)).toEqual(second.edges.map((e) => e.id));
    expect(first.snapshot.digest).toBe(second.snapshot.digest);
  });
});
