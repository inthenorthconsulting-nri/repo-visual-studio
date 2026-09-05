// GraphSnapshot assembly. References, never embeds, the six upstream
// snapshot ids/digests/schema-versions -- same pointer-only discipline
// decision-intelligence/src/snapshot.ts applies one layer further up.

import type {
  ArtifactProvenance,
  ContentDigestVerification,
  GraphContentAttestationInput,
  GraphSnapshot,
  KnowledgeEdge,
  KnowledgeNode,
  UpstreamArtifactDigest,
  UpstreamSourceArtifact,
} from "./contracts.js";
import { KNOWLEDGE_GRAPH_SCHEMA_VERSION } from "./contracts.js";
import { buildSnapshotId, digestOf } from "./ids.js";

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * KG-owned deterministic content identity (Milestone 11.3.3A-K1). Pure,
 * order-independent, repository-independent: takes no repositoryId and
 * reuses digestOf() (which itself canonicalizes via canonicalize()) from
 * ids.ts rather than hashing independently. Nodes and edges are sorted by
 * id (locally, not caller-dependent) before projection so caller ordering
 * never affects the result -- the same discipline buildGraphSnapshot()'s
 * own `digest` already applies to node_ids/edge_ids.
 *
 * Node projection includes only label, node_type, source_artifact,
 * source_entity_id -- id is used solely as the sort key, and
 * repository_id/schema_version/evidence_refs/resolution_status/confidence
 * are excluded (epistemic/provenance/membership fields, not architecture
 * semantics). Edge projection includes only edge_type, from_node_id,
 * to_node_id, direction, detail -- id, evidence_refs and resolution_status
 * are excluded, and `detail` unconditionally participates (never gated by
 * edge_type).
 *
 * Callers are expected to pass an already-deduplicated (unique-by-id)
 * node/edge set, exactly as buildGraphSnapshot()'s own `digest` computation
 * already assumes of its node_ids/edge_ids -- this function performs no
 * dedup of its own.
 */
export function buildGraphContentDigest(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): string {
  const projectedNodes = [...nodes]
    .sort(byId)
    .map((node) => ({
      label: node.label,
      node_type: node.node_type,
      source_artifact: node.source_artifact,
      source_entity_id: node.source_entity_id,
    }));
  const projectedEdges = [...edges]
    .sort(byId)
    .map((edge) => ({
      edge_type: edge.edge_type,
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
      direction: edge.direction,
      detail: edge.detail,
    }));
  return digestOf({ nodes: projectedNodes, edges: projectedEdges });
}

/**
 * Verifies a (possibly legacy) snapshot's content_digest against a fresh
 * recompute from the supplied nodes/edges. Never hashes independently --
 * always delegates to buildGraphContentDigest(). A missing content_digest
 * is reported as "missing", never silently recomputed-and-injected as an
 * "attested" result (that would forge a historical attestation that was
 * never actually made) -- see contracts.ts's ContentAttestationStatus
 * header for the missing/mismatch distinction, including why an explicit
 * malformed value (e.g. "") is a "mismatch", not a "missing".
 */
export function verifyGraphContentDigest(
  snapshot: GraphContentAttestationInput,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): ContentDigestVerification {
  const actual = buildGraphContentDigest(nodes, edges);
  if (snapshot.content_digest === undefined) {
    return { status: "missing", actual };
  }
  if (snapshot.content_digest === actual) {
    return { status: "attested", expected: snapshot.content_digest, actual };
  }
  return { status: "mismatch", expected: snapshot.content_digest, actual };
}

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
  const contentDigest = buildGraphContentDigest(params.nodes, params.edges);
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
    content_digest: contentDigest,
  };
}
