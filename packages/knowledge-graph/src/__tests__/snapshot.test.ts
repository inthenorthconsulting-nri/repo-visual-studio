import { describe, it, expect } from "vitest";
import { buildGraphContentDigest, buildGraphSnapshot, buildUpstreamArtifactDigest, verifyGraphContentDigest } from "../snapshot.js";
import { buildSnapshotId, digestOf } from "../ids.js";
import {
  KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  type GraphContentAttestationInput,
  type GraphSnapshot,
  type KnowledgeEdge,
  type KnowledgeNode,
} from "../contracts.js";
import { allPresentUpstreamArtifacts, linearChainFixture, makeEdge, makeNode, REPOSITORY_ID, rotate } from "./graph-fixtures.js";

describe("buildUpstreamArtifactDigest", () => {
  it("marks provenance 'unavailable' when not present", () => {
    const digest = buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: false });
    expect(digest.provenance).toBe("unavailable");
    expect(digest.snapshot_id).toBeUndefined();
  });

  it("marks provenance 'complete' when present with a snapshotId", () => {
    const digest = buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: true, snapshotId: "snap-1", schemaVersion: 1 });
    expect(digest.provenance).toBe("complete");
    expect(digest.snapshot_id).toBe("snap-1");
    expect(digest.schema_version).toBe(1);
  });

  it("marks provenance 'partial' when present but without a snapshotId", () => {
    const digest = buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: true });
    expect(digest.provenance).toBe("partial");
  });
});

describe("buildGraphSnapshot", () => {
  it("assembles schema version, repository id, counts, and sorted upstream artifacts", () => {
    const { nodes, edges } = linearChainFixture();
    const upstreamArtifacts = allPresentUpstreamArtifacts();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes, edges });

    expect(snapshot.schema_version).toBe(KNOWLEDGE_GRAPH_SCHEMA_VERSION);
    expect(snapshot.repository_id).toBe(REPOSITORY_ID);
    expect(snapshot.node_count).toBe(nodes.length);
    expect(snapshot.edge_count).toBe(edges.length);
    expect(snapshot.upstream_artifacts.map((a) => a.source_artifact)).toEqual(
      [...snapshot.upstream_artifacts.map((a) => a.source_artifact)].sort(),
    );
  });

  it("computes the id from sorted snapshot_id tokens via buildSnapshotId", () => {
    const { nodes, edges } = linearChainFixture();
    const upstreamArtifacts = allPresentUpstreamArtifacts();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes, edges });
    const expectedTokens = upstreamArtifacts.map((a) => a.snapshot_id!).sort();
    expect(snapshot.id).toBe(buildSnapshotId(REPOSITORY_ID, expectedTokens));
  });

  it("uses '<source_artifact>:<provenance>' as the token for artifacts without a snapshot_id", () => {
    const { nodes, edges } = linearChainFixture();
    const upstreamArtifacts = [buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: false })];
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes, edges });
    expect(snapshot.id).toBe(buildSnapshotId(REPOSITORY_ID, ["architecture:unavailable"]));
  });

  it("computes digest from sorted node/edge ids only (order-independent, content-sensitive)", () => {
    const { nodes, edges } = linearChainFixture();
    const upstreamArtifacts = allPresentUpstreamArtifacts();
    const snapshotA = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes, edges });
    const snapshotB = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    expect(snapshotA.digest).toBe(snapshotB.digest);

    const expectedDigest = digestOf({
      node_ids: nodes.map((n) => n.id).sort(),
      edge_ids: edges.map((e) => e.id).sort(),
    });
    expect(snapshotA.digest).toBe(expectedDigest);
  });

  it("produces a different digest when the node/edge set differs", () => {
    const chainA = linearChainFixture();
    const upstreamArtifacts = allPresentUpstreamArtifacts();
    const snapshotA = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes: chainA.nodes, edges: chainA.edges });
    const snapshotB = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes: chainA.nodes.slice(0, -1), edges: chainA.edges });
    expect(snapshotA.digest).not.toBe(snapshotB.digest);
  });

  it("handles empty nodes and edges", () => {
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: [], nodes: [], edges: [] });
    expect(snapshot.node_count).toBe(0);
    expect(snapshot.edge_count).toBe(0);
    expect(snapshot.upstream_artifacts).toEqual([]);
  });

  it("populates content_digest (Milestone 11.3.3A-K1) on every newly-built snapshot, computed from the same node/edge arrays", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    expect(snapshot.content_digest).toBe(buildGraphContentDigest(nodes, edges));
  });
});

// ---------------------------------------------------------------------------
// Milestone 11.3.3A-K1: buildGraphContentDigest / verifyGraphContentDigest.
// content_digest is a fourth identity axis, separate from id (observation),
// digest (node/edge-id membership) and repository_id (envelope): KG-owned,
// deterministic, repository-independent architecture-semantic content.
// ---------------------------------------------------------------------------

describe("buildGraphContentDigest", () => {
  it("is identical across 5 shuffled node/edge orderings (order-independence)", () => {
    const { nodes, edges } = linearChainFixture();
    const digests = [0, 1, 2, 3, 4].map((shift) => buildGraphContentDigest(rotate(nodes, shift), rotate(edges, shift)));
    expect(new Set(digests).size).toBe(1);
  });

  describe("node mutation matrix (locked projection: label, node_type, source_artifact, source_entity_id)", () => {
    function baseNode(): KnowledgeNode {
      return makeNode({ sourceEntityId: "matrix-node", nodeType: "component", sourceArtifact: "architecture", label: "Base Label" });
    }
    function digestFor(node: KnowledgeNode): string {
      return buildGraphContentDigest([node], []);
    }

    it("changes when label changes", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, label: "Different Label" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when node_type changes", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, node_type: "package" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when source_artifact changes", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, source_artifact: "capability" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when source_entity_id changes", () => {
      const a = baseNode();
      const b = makeNode({ sourceEntityId: "matrix-node-different", nodeType: "component", sourceArtifact: "architecture", label: "Base Label" });
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("is unchanged when repository_id changes (excluded per §16 -- repository-independent)", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, repository_id: "a-different-repository" };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("is unchanged when evidence_refs changes (epistemic field, excluded)", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, evidence_refs: [{ path: "some/path.ts" }] };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("is unchanged when resolution_status changes (epistemic field, excluded)", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, resolution_status: "unresolved" };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("is unchanged when confidence changes (epistemic field, excluded)", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, confidence: "unverifiable" };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("is unchanged when schema_version changes (excluded)", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, schema_version: 2 };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("[malformed-direct-construction] is unchanged when only id differs -- id and source_entity_id are always coupled via buildNodeId() in real construction, so this forces an id the real pipeline could never produce, purely to isolate that id is used only as a sort key, never as projected content", () => {
      const a = baseNode();
      const b: KnowledgeNode = { ...a, id: "forced-different-node-id" };
      expect(digestFor(a)).toBe(digestFor(b));
    });
  });

  describe("edge mutation matrix (locked projection: edge_type, from_node_id, to_node_id, direction, detail)", () => {
    function baseEdge(): KnowledgeEdge {
      return makeEdge({ edgeType: "depends_on", from: "matrix-from", to: "matrix-to", detail: "base detail" });
    }
    function digestFor(edge: KnowledgeEdge): string {
      return buildGraphContentDigest([], [edge]);
    }

    it("changes when edge_type changes", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, edge_type: "references" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when from_node_id changes", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, from_node_id: "matrix-other-from" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when to_node_id changes", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, to_node_id: "matrix-other-to" };
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("[malformed-direct-construction] changes when direction differs -- KnowledgeEdge.direction's real type permits only the single literal \"directed\", so a second value is forced via an unsafe cast solely to prove direction participates in the locked edge projection", () => {
      const a = baseEdge();
      const b = { ...a, direction: "reverse" } as unknown as KnowledgeEdge;
      expect(digestFor(a)).not.toBe(digestFor(b));
    });

    it("changes when detail changes, unconditionally across multiple edge_types (never edge-type-conditional, per §14)", () => {
      const dependsA = makeEdge({ edgeType: "depends_on", from: "d-from", to: "d-to", detail: "detail one" });
      const dependsB: KnowledgeEdge = { ...dependsA, detail: "detail two" };
      expect(digestFor(dependsA)).not.toBe(digestFor(dependsB));

      const referencesA = makeEdge({ edgeType: "references", from: "r-from", to: "r-to", detail: "detail one" });
      const referencesB: KnowledgeEdge = { ...referencesA, detail: "detail two" };
      expect(digestFor(referencesA)).not.toBe(digestFor(referencesB));
    });

    it("is unchanged when evidence_refs changes (epistemic field, excluded)", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, evidence_refs: [{ path: "some/path.ts" }] };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("is unchanged when resolution_status changes (epistemic field, excluded)", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, resolution_status: "unresolved" };
      expect(digestFor(a)).toBe(digestFor(b));
    });

    it("[malformed-direct-construction] is unchanged when only id differs -- id is always coupled to (edge_type, from_node_id, to_node_id) via buildEdgeId() in real construction, so this forces an id the real pipeline could never produce, purely to isolate that id is used only as a sort key, never as projected content", () => {
      const a = baseEdge();
      const b: KnowledgeEdge = { ...a, id: "forced-different-edge-id" };
      expect(digestFor(a)).toBe(digestFor(b));
    });
  });

  describe("repository-independence", () => {
    it("empty graphs produce the identical content_digest regardless of repository", () => {
      const snapshotA = buildGraphSnapshot({ repositoryId: "repo-a", upstreamArtifacts: [], nodes: [], edges: [] });
      const snapshotB = buildGraphSnapshot({ repositoryId: "repo-b", upstreamArtifacts: [], nodes: [], edges: [] });
      expect(snapshotA.content_digest).toBe(snapshotB.content_digest);
      expect(snapshotA.repository_id).not.toBe(snapshotB.repository_id);
    });

    it("an identical semantic graph produces the identical content_digest under a different top-level repositoryId and a different per-node repository_id", () => {
      const { nodes, edges } = linearChainFixture();
      const upstreamArtifacts = allPresentUpstreamArtifacts();
      const snapshotA = buildGraphSnapshot({ repositoryId: "repo-a", upstreamArtifacts, nodes, edges });
      const nodesInRepoB: KnowledgeNode[] = nodes.map((node) => ({ ...node, repository_id: "repo-b" }));
      const snapshotB = buildGraphSnapshot({ repositoryId: "repo-b", upstreamArtifacts, nodes: nodesInRepoB, edges });
      expect(snapshotA.content_digest).toBe(snapshotB.content_digest);
      expect(snapshotA.repository_id).not.toBe(snapshotB.repository_id);
    });
  });

  describe("observation-independence", () => {
    it("two snapshots with different upstream_artifacts (different .id) still share the same content_digest for the same nodes/edges", () => {
      const { nodes, edges } = linearChainFixture();
      const snapshotA = buildGraphSnapshot({
        repositoryId: REPOSITORY_ID,
        upstreamArtifacts: [buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: true, snapshotId: "arch-snap-1" })],
        nodes,
        edges,
      });
      const snapshotB = buildGraphSnapshot({
        repositoryId: REPOSITORY_ID,
        upstreamArtifacts: [buildUpstreamArtifactDigest({ sourceArtifact: "architecture", present: true, snapshotId: "arch-snap-2" })],
        nodes,
        edges,
      });
      expect(snapshotA.id).not.toBe(snapshotB.id);
      expect(snapshotA.content_digest).toBe(snapshotB.content_digest);
    });
  });

  describe("membership-vs-content separation (the core reason K1 exists)", () => {
    it("digest (id-set membership) is unchanged but content_digest changes when a node's semantic field changes with its id held fixed", () => {
      const node = makeNode({ sourceEntityId: "separation-node", label: "Original Label" });
      const upstreamArtifacts = allPresentUpstreamArtifacts();
      const snapshotA = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes: [node], edges: [] });
      const mutatedNode: KnowledgeNode = { ...node, label: "Mutated Label" };
      const snapshotB = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts, nodes: [mutatedNode], edges: [] });

      expect(snapshotA.digest).toBe(snapshotB.digest);
      expect(snapshotA.content_digest).not.toBe(snapshotB.content_digest);
    });
  });
});

describe("verifyGraphContentDigest", () => {
  it("returns 'attested' when the persisted content_digest matches a fresh recompute", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const result = verifyGraphContentDigest(snapshot, nodes, edges);
    expect(result).toEqual({ status: "attested", expected: snapshot.content_digest, actual: snapshot.content_digest });
  });

  it("returns 'missing' -- never a forged 'attested' -- when the input carries no content_digest at all (a legacy/pre-K1 snapshot)", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const { content_digest, ...legacy } = snapshot;
    const result = verifyGraphContentDigest(legacy, nodes, edges);
    expect(result.status).toBe("missing");
    expect(result.expected).toBeUndefined();
    expect(result.actual).toBe(buildGraphContentDigest(nodes, edges));
  });

  it("returns 'mismatch' when the persisted content_digest disagrees with a fresh recompute", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const corrupted: GraphSnapshot = { ...snapshot, content_digest: "deadbeef" };
    const result = verifyGraphContentDigest(corrupted, nodes, edges);
    expect(result).toEqual({ status: "mismatch", expected: "deadbeef", actual: snapshot.content_digest });
  });

  it("treats an explicit malformed value (empty string) as 'mismatch', never conflating it with historical absence ('missing') -- only a truly absent property is 'missing'", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const malformed: GraphSnapshot = { ...snapshot, content_digest: "" };
    const result = verifyGraphContentDigest(malformed, nodes, edges);
    expect(result.status).toBe("mismatch");
    expect(result.expected).toBe("");
  });

  it("is reorder-invariant: verifying against reversed nodes/edges yields the identical status and actual digest", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const forward = verifyGraphContentDigest(snapshot, nodes, edges);
    const reversed = verifyGraphContentDigest(snapshot, [...nodes].reverse(), [...edges].reverse());
    expect(reversed).toEqual(forward);
  });

  it("[legacy-input type boundary] accepts a GraphContentAttestationInput that structurally omits content_digest, while GraphSnapshot itself requires the field at compile time (enforced by tsc --noEmit; this test demonstrates the permitted omission at runtime)", () => {
    const { nodes, edges } = linearChainFixture();
    const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    const { content_digest, ...legacyInput } = snapshot;
    const typedLegacyInput: GraphContentAttestationInput = legacyInput;
    expect(verifyGraphContentDigest(typedLegacyInput, nodes, edges).status).toBe("missing");
  });
});

describe("content_digest export surface", () => {
  it("buildGraphContentDigest and verifyGraphContentDigest are reachable through the package barrel (index.ts), not a second public-entry mechanism", async () => {
    const barrel = await import("../index.js");
    expect(typeof barrel.buildGraphContentDigest).toBe("function");
    expect(typeof barrel.verifyGraphContentDigest).toBe("function");
  });
});
