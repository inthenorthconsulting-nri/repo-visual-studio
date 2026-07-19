import type { ProductArchetype, ProductIdentityCandidate } from "./contracts.js";

/**
 * §4: ranking is a thin, separately-testable seam over the archetype
 * classification already performed by archetypes.ts — it never
 * re-classifies, it only resolves "which discovered candidate corresponds
 * to the primary archetype selectArchetypes() picked" deterministically.
 */
export function pickWinningCandidate(candidates: ProductIdentityCandidate[], primaryArchetype: ProductArchetype): ProductIdentityCandidate | undefined {
  return candidates.find((c) => c.archetype === primaryArchetype);
}

export function rankSecondaryCandidates(candidates: ProductIdentityCandidate[], primaryArchetype: ProductArchetype, secondaryArchetypes: ProductArchetype[]): ProductIdentityCandidate[] {
  return candidates
    .filter((c) => c.archetype !== primaryArchetype && secondaryArchetypes.includes(c.archetype))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
