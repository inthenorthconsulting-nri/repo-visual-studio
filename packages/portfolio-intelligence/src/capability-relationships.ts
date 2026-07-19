import type { CapabilityModel } from "@rvs/capability-intelligence";
import {
  type CapabilitySimilaritySignals,
  type ProductCapabilityRef,
  SAME_CAPABILITY_THRESHOLD,
  capabilityRefKey,
  collectCapabilityRefs,
  computeCapabilitySimilarity,
  isSameCapability,
} from "./capability-normalization.js";
import type { PortfolioProduct } from "./contracts.js";

// ---------------------------------------------------------------------------
// §9 Capability relationship classification
//
// capability-normalization.ts already merged every pair that clears
// SAME_CAPABILITY_THRESHOLD *and* the multi-signal structural gate into one
// PortfolioCapability ("shared" coverage). This module classifies every
// remaining cross-product capability pair — ones normalization deliberately
// left apart — into the weaker relationship bands from §9: complementary,
// overlapping, alternative_implementation, distinct, or unresolved.
// "distinct" pairs (the overwhelming majority — most capability pairs across
// two unrelated products share nothing) are computed but not persisted by
// default per §9 ("not stored unless needed for audit"); callers that want
// the audit trail can pass includeDistinct. "unresolved" must never be
// rendered as a confirmed executive conclusion (§9 hard rule) — narrative.ts
// and portfolio-plan.ts must treat it as "insufficient evidence", not as a
// weaker-but-real relationship.
// ---------------------------------------------------------------------------

export type CapabilityPairRelationship = "shared" | "complementary" | "overlapping" | "alternative_implementation" | "distinct" | "unresolved";

const RELATED_FLOOR = 0.2;
const OVERLAPPING_FLOOR = 0.35;

export interface CapabilityPairClassification {
  relationship: CapabilityPairRelationship;
  score: number;
  signals: CapabilitySimilaritySignals;
}

/**
 * Classifies one cross-product capability pair. `refToCapabilityId` is the
 * lookup produced by normalizePortfolioCapabilities() — used only to detect
 * pairs that normalization already merged (relationship "shared"); this
 * module never re-runs the merge decision itself.
 */
export function classifyCapabilityPair(a: ProductCapabilityRef, b: ProductCapabilityRef, refToCapabilityId: Map<string, string>): CapabilityPairClassification {
  if (a.productId === b.productId) {
    throw new Error("classifyCapabilityPair requires capabilities from two different products");
  }

  const { score, signals } = computeCapabilitySimilarity(a, b);

  const groupA = refToCapabilityId.get(capabilityRefKey(a));
  const groupB = refToCapabilityId.get(capabilityRefKey(b));
  if (groupA && groupA === groupB) {
    return { relationship: "shared", score, signals };
  }

  if (score < RELATED_FLOOR) {
    return { relationship: "distinct", score, signals };
  }

  // Crosses the "same" lexical threshold but failed the structural-agreement
  // gate (or the reverse) — evidence disagrees with itself, so the pair is
  // left unresolved rather than forced into a specific weaker category.
  if (score >= SAME_CAPABILITY_THRESHOLD && !isSameCapability(signals, score)) {
    return { relationship: "unresolved", score, signals };
  }

  const outcomeAndActorAgree = signals.nameOverlap >= 0.3 && signals.actorOverlap > 0;
  if (score >= OVERLAPPING_FLOOR && outcomeAndActorAgree && signals.domainOverlap > 0) {
    return { relationship: "overlapping", score, signals };
  }

  const sameDomainDifferentSystems = signals.domainOverlap > 0 && signals.externalSystemOverlap === 0 && a.capability.externalSystems.length > 0 && b.capability.externalSystems.length > 0;
  if (sameDomainDifferentSystems && signals.nameOverlap >= 0.2) {
    return { relationship: "alternative_implementation", score, signals };
  }

  if ((signals.actorOverlap > 0 || signals.workflowOverlap > 0) && signals.nameOverlap < 0.3) {
    return { relationship: "complementary", score, signals };
  }

  return { relationship: "unresolved", score, signals };
}

export interface CapabilityPairResult {
  productAId: string;
  productBId: string;
  capabilityAId: string;
  capabilityBId: string;
  relationship: CapabilityPairRelationship;
  score: number;
}

export function classifyAllCapabilityPairs(
  products: PortfolioProduct[],
  capabilityModelsByProductId: Map<string, CapabilityModel>,
  refToCapabilityId: Map<string, string>,
  options: { includeDistinct?: boolean } = {},
): CapabilityPairResult[] {
  const refs = collectCapabilityRefs(products, capabilityModelsByProductId);
  const results: CapabilityPairResult[] = [];

  for (let i = 0; i < refs.length; i += 1) {
    for (let j = i + 1; j < refs.length; j += 1) {
      if (refs[i].productId === refs[j].productId) continue;
      const { relationship, score } = classifyCapabilityPair(refs[i], refs[j], refToCapabilityId);
      if (relationship === "shared") continue; // already represented as one PortfolioCapability by normalization
      if (relationship === "distinct" && !options.includeDistinct) continue;

      const [first, second] = refs[i].productId.localeCompare(refs[j].productId) <= 0 ? [refs[i], refs[j]] : [refs[j], refs[i]];
      results.push({
        productAId: first.productId,
        productBId: second.productId,
        capabilityAId: first.capability.id,
        capabilityBId: second.capability.id,
        relationship,
        score,
      });
    }
  }

  return results.sort(
    (a, b) => a.productAId.localeCompare(b.productAId) || a.productBId.localeCompare(b.productBId) || a.capabilityAId.localeCompare(b.capabilityAId) || a.capabilityBId.localeCompare(b.capabilityBId),
  );
}
