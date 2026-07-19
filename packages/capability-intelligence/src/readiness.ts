import type { CapabilityCandidate, CapabilityReadiness, CapabilityReadinessThresholds, CapabilityReadinessWeights, CapabilityStatus } from "./contracts.js";
import { DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "./contracts.js";
import type { CapabilityEvidenceAggregate } from "./evidence.js";
import type { CapabilityMaturityScores } from "./maturity.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Bounded 0-100, weighted per DEFAULT_CAPABILITY_READINESS_WEIGHTS (configurable) — never the sole basis for status; classifyCapabilityStatus applies hard gates independent of this score. */
export function computeCapabilityReadiness(maturity: CapabilityMaturityScores, weights: CapabilityReadinessWeights = DEFAULT_CAPABILITY_READINESS_WEIGHTS): CapabilityReadiness {
  const weightTotal = weights.implementation + weights.execution + weights.verification + weights.documentation + weights.adoption;
  const weighted =
    maturity.implementation * weights.implementation +
    maturity.execution * weights.execution +
    maturity.verification * weights.verification +
    maturity.documentation * weights.documentation +
    maturity.adoption * weights.adoption;

  return {
    score: clamp(weighted / weightTotal),
    implementationScore: maturity.implementation,
    executionScore: maturity.execution,
    verificationScore: maturity.verification,
    documentationScore: maturity.documentation,
    adoptionScore: maturity.adoption,
    blockers: maturity.blockers,
    qualifiers: maturity.qualifiers,
  };
}

/**
 * Hard gates first, score thresholds second — a high implementation+
 * verification score with zero execution score must never read as
 * "implemented"/"operational" (§6). Documentation alone never proves
 * implementation, so documentation-only candidates cap out at "planned" or
 * "unknown", never higher, regardless of score.
 */
export function classifyCapabilityStatus(
  candidate: CapabilityCandidate,
  aggregate: CapabilityEvidenceAggregate,
  readiness: CapabilityReadiness,
  thresholds: CapabilityReadinessThresholds = DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
): CapabilityStatus {
  if (candidate.evidence.length === 0) return "unknown";

  if (aggregate.hasDeprecatedMarker && !aggregate.isContradictory) return "deprecated";

  const abandonedSignal = candidate.matchedIncompleteSignals.includes("archived") || candidate.matchedIncompleteSignals.includes("abandoned");
  if (abandonedSignal && readiness.executionScore === 0 && readiness.implementationScore < 40) return "abandoned";

  if (aggregate.isDocumentationOnly || aggregate.isExampleOnly) {
    const roadmapSignal = candidate.roadmapStatement || candidate.matchedIncompleteSignals.some((s) => ["planned", "future", "coming soon", "todo", "fixme"].includes(s));
    return roadmapSignal ? "planned" : "unknown";
  }

  const executionGated = readiness.implementationScore >= 40 && readiness.executionScore === 0;

  if (!executionGated && readiness.score >= thresholds.operational && readiness.executionScore > 0 && readiness.verificationScore > 0) return "operational";
  if (!executionGated && readiness.score >= thresholds.implemented && readiness.executionScore > 0) return "implemented";
  if (readiness.score >= thresholds.partial) return "partial";
  if (readiness.score >= thresholds.experimental) return "experimental";
  if (readiness.score >= thresholds.scaffolded) return "scaffolded";
  return "planned";
}
