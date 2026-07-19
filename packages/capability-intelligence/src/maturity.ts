import type { CapabilityCandidate } from "./contracts.js";
import type { CapabilityEvidenceAggregate } from "./evidence.js";

/**
 * Five independent 0-100 axes. Each is scored from structural evidence only
 * — keyword signals (matchedIncompleteSignals) are corroborating context,
 * never the sole basis for a score, per §5's "documentation alone must never
 * prove implementation."
 */
export interface CapabilityMaturityScores {
  implementation: number;
  execution: number;
  verification: number;
  documentation: number;
  adoption: number;
  blockers: string[];
  qualifiers: string[];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function scoreImplementation(aggregate: CapabilityEvidenceAggregate, candidate: CapabilityCandidate): number {
  if (aggregate.isDocumentationOnly || aggregate.isExampleOnly) return 0;
  const scaffoldSignals = candidate.matchedIncompleteSignals.filter((s) => s === "scaffold" || s === "stub" || s === "placeholder" || s === "not implemented").length;
  if (!aggregate.hasImplementation && !aggregate.hasConfiguration && !aggregate.hasWorkflow && !aggregate.hasRuntimeEntrypoint) return 0;

  let score = 0;
  if (aggregate.hasImplementation) score += 45;
  if (aggregate.hasConfiguration) score += 15;
  if (aggregate.hasSchema) score += 10;
  if (aggregate.hasWorkflow || aggregate.hasRuntimeEntrypoint) score += 25;
  const implementationItems = aggregate.byType.implementation?.length ?? 0;
  score += Math.min(implementationItems * 3, 15);
  score -= scaffoldSignals * 25;
  if (aggregate.hasDeprecatedMarker) score -= 30;
  return clamp(score);
}

function scoreExecution(aggregate: CapabilityEvidenceAggregate): number {
  let score = 0;
  if (aggregate.hasRuntimeEntrypoint) score += 55;
  if (aggregate.hasWorkflow) score += 55;
  if (aggregate.hasDeployment) score += 30;
  if (aggregate.hasRelease) score += 15;
  if (aggregate.hasDeprecatedMarker) score -= 40;
  return clamp(score);
}

function scoreVerification(aggregate: CapabilityEvidenceAggregate): number {
  const testItems = aggregate.byType.test ?? [];
  if (testItems.length === 0) return 0;
  const strongTests = testItems.filter((t) => t.strength >= 4).length;
  const weakTests = testItems.length - strongTests;
  return clamp(strongTests * 55 + weakTests * 25);
}

function scoreDocumentation(aggregate: CapabilityEvidenceAggregate): number {
  const docItems = aggregate.byType.documentation ?? [];
  if (docItems.length === 0) return 0;
  const withImplementationSupport = aggregate.hasImplementation || aggregate.hasWorkflow;
  return clamp((withImplementationSupport ? 60 : 30) + Math.min(docItems.length * 10, 30));
}

// hasDeployment deliberately does not contribute here — it already scores
// execution (§ scoreExecution), and a Terraform module being provisioned is
// not evidence that anyone adopted/uses what it provisions. Counting it here
// too would make the "external-runtime-dependent, zero adoption evidence"
// qualifier below unreachable for exactly the candidates it exists to flag.
function scoreAdoption(aggregate: CapabilityEvidenceAggregate): number {
  let score = 0;
  if (aggregate.hasUsage) score += 60;
  if (aggregate.hasRelease) score += 30;
  return clamp(score);
}

/**
 * Hard gates independent of the weighted score: a candidate with high
 * implementation and verification scores but zero execution score must
 * never be classified "implemented"/"operational" — it is, at best,
 * "partial" (real code, no proven path to actually run it). Blockers feed
 * CapabilityReadiness.blockers; qualifiers feed .qualifiers (rendered under
 * "Available with limitations").
 */
export function assessCapabilityMaturity(candidate: CapabilityCandidate, aggregate: CapabilityEvidenceAggregate): CapabilityMaturityScores {
  const implementation = scoreImplementation(aggregate, candidate);
  const execution = scoreExecution(aggregate);
  const verification = scoreVerification(aggregate);
  const documentation = scoreDocumentation(aggregate);
  const adoption = scoreAdoption(aggregate);

  const blockers: string[] = [];
  const qualifiers: string[] = [];

  if (implementation >= 40 && execution === 0) {
    blockers.push("Real implementation evidence exists, but no execution path (runtime entrypoint, workflow, or deployment) was found.");
  }
  if (implementation >= 40 && verification === 0) {
    qualifiers.push("No automated test evidence was found for this capability.");
  }
  if (aggregate.isContradictory) {
    blockers.push("Confirmed implementation/execution evidence coexists with a deprecated- or disabled-looking marker; evidence is contradictory and requires human review.");
  }
  if (aggregate.isDocumentationOnly) {
    blockers.push("Only documentation evidence was found; no implementation, execution, or test evidence backs this claim.");
  }
  if (candidate.isExternalRuntimeDependent && adoption === 0) {
    qualifiers.push("Requires an external runtime/platform this repository does not control; no adoption/usage telemetry is available from repository evidence alone.");
  }

  return { implementation, execution, verification, documentation, adoption, blockers, qualifiers };
}
