// Cross-domain entity-identity normalization. An entity may be referenced
// by more than one upstream artifact's own already-resolved links (e.g. a
// component referenced both by an architecture dependency and a capability
// link); this module guarantees one KnowledgeNode per real entity rather
// than a duplicate per referencing artifact. Matching is exact
// (source_artifact, source_entity_id) only -- never fuzzy/name-similarity,
// consistent with every other layer's own link-resolution rule.

import type { KnowledgeNode, UpstreamSourceArtifact } from "./contracts.js";
import { buildNodeId } from "./ids.js";

export function identityKey(sourceArtifact: UpstreamSourceArtifact, sourceEntityId: string): string {
  return `${sourceArtifact}::${sourceEntityId}`;
}

export interface IdentityCollision {
  identity_key: string;
  node_ids: string[];
}

/**
 * Deduplicates candidate nodes by their final node id (a pure function of
 * source_entity_id alone -- see ids.ts's buildNodeId). The first-encountered
 * candidate (in the caller's stable input order) wins for any given node id.
 *
 * Because node id ignores source_artifact, two candidates with *different*
 * (source_artifact, source_entity_id) identities -- e.g. a governance policy
 * and a decision that independently happen to use the same literal entity id
 * string -- can still resolve to the same node id. That is the real
 * "identity collision" this module guards: without deduping by node id, both
 * candidates would survive into the output nodes array under one duplicate
 * id, violating the graph's node-id-uniqueness invariant. Any node id that
 * more than one distinct identity resolved into is recorded here rather than
 * silently collapsed -- callers feed the collision list into validation.ts
 * as GRAPH_IDENTITY_COLLISION findings.
 */
export function deduplicateNodes(
  candidates: KnowledgeNode[],
): { nodes: KnowledgeNode[]; collisions: IdentityCollision[] } {
  const byNodeId = new Map<string, KnowledgeNode>();
  const identityKeysByNodeId = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const key = identityKey(candidate.source_artifact, candidate.source_entity_id);
    const existing = byNodeId.get(candidate.id);
    if (!existing) {
      byNodeId.set(candidate.id, candidate);
    }
    const keySet = identityKeysByNodeId.get(candidate.id) ?? new Set<string>();
    keySet.add(key);
    identityKeysByNodeId.set(candidate.id, keySet);
  }

  const collisions: IdentityCollision[] = [];
  for (const [nodeId, keySet] of identityKeysByNodeId) {
    if (keySet.size > 1) {
      collisions.push({ identity_key: Array.from(keySet).sort().join(" | "), node_ids: [nodeId] });
    }
  }

  const nodes = Array.from(byNodeId.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  collisions.sort((a, b) => (a.identity_key < b.identity_key ? -1 : a.identity_key > b.identity_key ? 1 : 0));

  return { nodes, collisions };
}

/** Resolves a (source_artifact, source_entity_id) pair to its deterministic node id, without requiring the node itself to already exist -- used by edge-builder.ts when it only has an upstream link's target id, not the resolved node. */
export function resolveNodeIdForEntity(sourceEntityId: string): string {
  return buildNodeId(sourceEntityId);
}
