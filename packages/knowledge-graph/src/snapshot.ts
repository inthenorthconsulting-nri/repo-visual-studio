// GraphSnapshot assembly. References, never embeds, the six upstream
// snapshot ids/digests/schema-versions -- same pointer-only discipline
// decision-intelligence/src/snapshot.ts applies one layer further up.

import type { ArtifactProvenance, GraphSnapshot, KnowledgeEdge, KnowledgeNode, UpstreamArtifactDigest, UpstreamSourceArtifact } from "./contracts.js";
import { KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "./contracts.js";
import { buildSnapshotId, digestOf } from "./ids.js";

export function buildUpstreamArtifactDigest(params: {
  sourceArtifact: UpstreamSourceArtifact;
  present: boolean;
  snapshotId?: string;
  schemaVersion?: number;
}): UpstreamArtifactDigest {
  const provenance: ArtifactProvenance = !params.present ? "unavailable" : params.snapshotId ? "complete" : "partial";
  return {
    source_artifact: params.sourceArtifact,
    snapshot_id: params.snapshotId,
    schema_version: params.schemaVersion,
    provenance,
  };
}

export function buildGraphSnapshot(params: {
  repositoryId: string;
  upstreamArtifacts: UpstreamArtifactDigest[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}): GraphSnapshot {
  const sortedTokens = [...params.upstreamArtifacts]
    .map((artifact) => artifact.snapshot_id ?? `${artifact.source_artifact}:${artifact.provenance}`)
    .sort();
  const id = buildSnapshotId(params.repositoryId, sortedTokens);
  const digest = digestOf({
    node_ids: params.nodes.map((node) => node.id).sort(),
    edge_ids: params.edges.map((edge) => edge.id).sort(),
  });
  const upstreamArtifacts = [...params.upstreamArtifacts].sort((a, b) =>
    a.source_artifact < b.source_artifact ? -1 : a.source_artifact > b.source_artifact ? 1 : 0,
  );
  return {
    id,
    schema_version: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    repository_id: params.repositoryId,
    upstream_artifacts: upstreamArtifacts,
    node_count: params.nodes.length,
    edge_count: params.edges.length,
    digest,
  };
}
