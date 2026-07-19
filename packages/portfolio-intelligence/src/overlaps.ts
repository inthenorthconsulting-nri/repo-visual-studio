import type { PortfolioCapability, PortfolioOverlap, PortfolioOverlapSeverity } from "./contracts.js";
import { portfolioOverlapId } from "./ids.js";
import { isOwnershipResolved } from "./ownership.js";

// ---------------------------------------------------------------------------
// §14 Overlap and duplication intelligence
//
// Every "shared"-coverage normalized capability is a CANDIDATE overlap, not
// an automatic one — multiple products deliberately reusing the same
// responsibility is often healthy, not wasteful. This module only escalates
// a shared capability into a recorded PortfolioOverlap — and reclassifies
// its coverage from "shared" to "overlapping" — when ownership is NOT
// resolved (ownership.ts: no single fully-current participant clearly
// leads it). Severity is a 4-tier function of participant count and
// evidence confidence, never of unsupported language like
// "wasteful"/"redundant"/"unnecessary" (§14 hard rule on conservative
// language — statements here only ever describe what the evidence shows:
// multiple products, no resolved lead).
// ---------------------------------------------------------------------------

export function classifyOverlapSeverity(participantCount: number, confidence: string): PortfolioOverlapSeverity {
  if (confidence === "unresolved") return "informational";
  if (participantCount >= 4) return "strategic";
  if (participantCount === 3) return "material";
  if (confidence === "confirmed") return "minor";
  return "informational";
}

export interface OverlapDetectionResult {
  overlaps: PortfolioOverlap[];
  capabilities: PortfolioCapability[];
}

export function detectOverlaps(capabilities: PortfolioCapability[]): OverlapDetectionResult {
  const overlaps: PortfolioOverlap[] = [];

  const updated = capabilities.map((capability) => {
    if (capability.coverage !== "shared" || isOwnershipResolved(capability)) return capability;

    const participantIds = [...new Set(capability.participation.map((p) => p.productId))].sort((a, b) => a.localeCompare(b));
    const severity = classifyOverlapSeverity(participantIds.length, capability.confidence);

    overlaps.push({
      id: portfolioOverlapId(capability.id),
      capabilityId: capability.id,
      productIds: participantIds,
      severity,
      statement: `${participantIds.length} products each implement "${capability.displayName}" and no single product clearly leads it; ownership of this capability is not yet separated.`,
      ownershipResolved: false,
      evidenceIds: capability.evidenceIds,
    });

    return { ...capability, coverage: "overlapping" as const };
  });

  return { overlaps: overlaps.sort((a, b) => a.id.localeCompare(b.id)), capabilities: updated };
}
