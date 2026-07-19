import { compressToAtomicClaim } from "@rvs/architecture-intelligence";
import type { CapabilityCandidate } from "./contracts.js";
import type { CapabilityEvidenceAggregate } from "./evidence.js";

const GENERIC_OUTCOME_PHRASES = [/improves? efficiency/i, /increases? productivity/i, /streamlines? workflows?/i, /enhances? experience/i, /boosts? performance/i, /saves? time and money/i];

/**
 * Outcome statements must be evidence-supported, never a fabricated
 * quantified saving, never a production-use claim without production
 * evidence, and never a generic marketing phrase. A candidate whose purpose
 * is only "suggested"/"unresolved", or whose only outcome-shaped text reads
 * as generic filler, gets no derived outcome at all rather than a padded one.
 */
export function deriveCapabilityOutcome(candidate: CapabilityCandidate, aggregate: CapabilityEvidenceAggregate): string | undefined {
  const source = candidate.outcome ?? candidate.purpose;
  if (source.inference !== "confirmed" && source.inference !== "derived") return undefined;

  const compressed = compressToAtomicClaim(source.value, 24);
  if (compressed.length === 0) return undefined;
  if (GENERIC_OUTCOME_PHRASES.some((pattern) => pattern.test(compressed))) return undefined;

  const hasProductionEvidence = aggregate.hasRelease || aggregate.hasDeployment || aggregate.hasUsage;
  if (!hasProductionEvidence && /\b(in production|at scale|production[- ]use)\b/i.test(compressed)) return undefined;

  return compressed;
}
