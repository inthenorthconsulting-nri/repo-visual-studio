import { describe, it, expect } from "vitest";
import { buildGraphSnapshot, buildUpstreamArtifactDigest } from "../snapshot.js";
import { buildSnapshotId, digestOf } from "../ids.js";
import { KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "../contracts.js";
import { allPresentUpstreamArtifacts, linearChainFixture, REPOSITORY_ID } from "./graph-fixtures.js";

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
});
