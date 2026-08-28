// Runtime trust boundary for the three entity-reference types. TypeScript
// branding (see contracts.ts) is cosmetic -- it only prevents accidental
// mixing at compile time. The actual boundary is that a `ConfirmedEntityRef`
// can only be produced by an actual lookup against a loaded
// `KnowledgeNode[]`, and an `ExistingEntityMutationRef` can only be produced
// FROM an already-confirmed ref. Neither cast is exported unguarded.

import type { KnowledgeNode } from "@rvs/knowledge-graph";
import type { ConfirmedEntityRef, ExistingEntityMutationRef, ProposedEntityRef } from "./contracts.js";
import { buildProposedEntityRefId } from "./ids.js";

/**
 * The only way to mint a `ConfirmedEntityRef`. Returns `undefined` -- never
 * an unresolved/guessed ref -- when `candidateNodeId` is not present in
 * `knownNodes`.
 */
export function tryConfirmEntityRef(candidateNodeId: string, knownNodes: readonly KnowledgeNode[]): ConfirmedEntityRef | undefined {
  if (!isWellFormedRefString(candidateNodeId)) return undefined;
  const found = knownNodes.some((node) => node.id === candidateNodeId);
  return found ? (candidateNodeId as ConfirmedEntityRef) : undefined;
}

/**
 * The only way to mint an `ExistingEntityMutationRef`. Composes with
 * `tryConfirmEntityRef`: a mutation ref can never exist without first
 * passing the confirmed-lookup gate.
 */
export function mutateExistingEntityRef(confirmed: ConfirmedEntityRef): ExistingEntityMutationRef {
  return confirmed as unknown as ExistingEntityMutationRef;
}

/**
 * The only way to mint a `ProposedEntityRef`. A pure, deterministic
 * function of the proposal's own declared scope + caller-chosen local id --
 * never random, matching the repository's content-derived-id convention.
 * Two calls with the same (proposalScope, localId) always yield the same
 * ref, which is what lets `add_relation` operations in the same
 * `ProposedChangeSet` refer back to an entity a prior `add_entity`
 * operation in that same set introduced.
 */
export function proposeEntityRef(proposalScope: string, localId: string): ProposedEntityRef {
  return buildProposedEntityRefId(proposalScope, localId) as ProposedEntityRef;
}

/** Well-formedness gate shared by every ref constructor -- rejects path-traversal-shaped, null-byte, and prototype-pollution-shaped candidate strings before they can reach a lookup. See validation.ts for the full security/conflict validation pass over an entire proposal. */
export function isWellFormedRefString(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (candidate.includes("\0")) return false;
  if (candidate.includes("..")) return false;
  if (candidate === "__proto__" || candidate === "constructor" || candidate === "prototype") return false;
  return true;
}

export function isConfirmedEntityRef(value: string, knownNodes: readonly KnowledgeNode[]): value is ConfirmedEntityRef {
  return tryConfirmEntityRef(value, knownNodes) !== undefined;
}
