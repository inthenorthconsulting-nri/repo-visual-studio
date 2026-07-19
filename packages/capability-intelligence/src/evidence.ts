import type { CapabilityCandidate, CapabilityEvidence, CapabilityEvidenceType } from "./contracts.js";

/**
 * Aggregates a candidate's raw evidence list into the shape maturity.ts and
 * readiness.ts actually reason over. Per §4, minimum evidence combinations
 * matter more than a single strongest item: "strong confirmation" requires a
 * runtime/workflow entrypoint plus implementation plus verification (or an
 * executable workflow plus implementation plus configuration); a single
 * strong item alone is only ever a "partial" signal.
 */
export interface CapabilityEvidenceAggregate {
  totalStrength: number;
  byType: Partial<Record<CapabilityEvidenceType, CapabilityEvidence[]>>;
  hasRuntimeEntrypoint: boolean;
  hasWorkflow: boolean;
  hasImplementation: boolean;
  hasConfiguration: boolean;
  hasSchema: boolean;
  hasTest: boolean;
  hasDeployment: boolean;
  hasRelease: boolean;
  hasUsage: boolean;
  hasDocumentation: boolean;
  hasExample: boolean;
  hasDeprecatedMarker: boolean;
  hasTodoMarker: boolean;
  /** Only documentation/example/todo evidence present — no structural (implementation/workflow/entrypoint/configuration/test/deployment) evidence at all. */
  isDocumentationOnly: boolean;
  /** Only example evidence, nothing else. */
  isExampleOnly: boolean;
  /** Confirmed structural evidence coexists with a deprecated/disabled marker — needs human review, not a silent pick. */
  isContradictory: boolean;
  meetsStrongConfirmation: boolean;
  meetsPartialConfirmation: boolean;
}

function has(byType: CapabilityEvidenceAggregate["byType"], type: CapabilityEvidenceType): boolean {
  return (byType[type]?.length ?? 0) > 0;
}

export function aggregateCandidateEvidence(candidate: CapabilityCandidate): CapabilityEvidenceAggregate {
  const byType: CapabilityEvidenceAggregate["byType"] = {};
  let totalStrength = 0;
  for (const item of candidate.evidence) {
    (byType[item.type] ??= []).push(item);
    totalStrength += item.strength;
  }

  const hasRuntimeEntrypoint = has(byType, "runtime_entrypoint");
  const hasWorkflow = has(byType, "workflow");
  const hasImplementation = has(byType, "implementation");
  const hasConfiguration = has(byType, "configuration");
  const hasSchema = has(byType, "schema");
  const hasTest = has(byType, "test");
  const hasDeployment = has(byType, "deployment");
  const hasRelease = has(byType, "release");
  const hasUsage = has(byType, "usage");
  const hasDocumentation = has(byType, "documentation");
  const hasExample = has(byType, "example");
  const hasDeprecatedMarker = has(byType, "deprecated_marker");
  const hasTodoMarker = has(byType, "todo_marker");

  const hasStructuralEvidence = hasRuntimeEntrypoint || hasWorkflow || hasImplementation || hasConfiguration || hasSchema || hasTest || hasDeployment || hasRelease;
  const isDocumentationOnly = !hasStructuralEvidence && (hasDocumentation || hasExample || hasTodoMarker) && candidate.evidence.length > 0;
  const isExampleOnly = hasExample && !hasStructuralEvidence && !hasDocumentation;

  const executionEvidence = hasRuntimeEntrypoint || hasWorkflow || hasDeployment;
  const meetsStrongConfirmation = (executionEvidence && hasImplementation && hasTest) || (hasWorkflow && hasImplementation && hasConfiguration);
  const meetsPartialConfirmation = hasImplementation && hasTest && !executionEvidence;

  const isContradictory = hasDeprecatedMarker && (hasWorkflow || hasRuntimeEntrypoint || hasImplementation) && candidate.evidence.some((e) => e.confidence === "confirmed" && e.type !== "deprecated_marker");

  return {
    totalStrength,
    byType,
    hasRuntimeEntrypoint,
    hasWorkflow,
    hasImplementation,
    hasConfiguration,
    hasSchema,
    hasTest,
    hasDeployment,
    hasRelease,
    hasUsage,
    hasDocumentation,
    hasExample,
    hasDeprecatedMarker,
    hasTodoMarker,
    isDocumentationOnly,
    isExampleOnly,
    isContradictory,
    meetsStrongConfirmation,
    meetsPartialConfirmation,
  };
}
