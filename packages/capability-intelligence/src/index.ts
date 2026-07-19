import type { ArchitectureIntelligence, ConfidenceSummary } from "@rvs/architecture-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { discoverCapabilityCandidates } from "./candidates.js";
import type { InclusionDecision } from "./inclusion-policy.js";
import { decideCapabilityInclusion } from "./inclusion-policy.js";
import type {
  Capability,
  CapabilityCandidate,
  CapabilityConfidence,
  CapabilityEvidenceSummary,
  CapabilityEvidenceType,
  CapabilityGenerationMetadata,
  CapabilityModel,
  CapabilityReadiness,
  CapabilityReadinessThresholds,
  CapabilityReadinessWeights,
  CapabilityStatus,
  ExcludedCapabilityCandidate,
} from "./contracts.js";
import { CAPABILITY_INTELLIGENCE_SCHEMA_VERSION, DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "./contracts.js";
import type { CapabilityEvidenceAggregate } from "./evidence.js";
import { aggregateCandidateEvidence } from "./evidence.js";
import { buildCapabilityDomains } from "./grouping.js";
import { capDomainId } from "./ids.js";
import { humanizeCapabilityName } from "./label.js";
import { assessCapabilityMaturity } from "./maturity.js";
import { deriveCapabilityOutcome } from "./outcomes.js";
import { classifyCapabilityStatus, computeCapabilityReadiness } from "./readiness.js";

export * from "./candidates.js";
export * from "./contracts.js";
export * from "./evidence.js";
export * from "./exporter.js";
export * from "./grouping.js";
export * from "./ids.js";
export * from "./inclusion-policy.js";
export * from "./label.js";
export * from "./maturity.js";
export * from "./outcomes.js";
export * from "./readiness.js";
export * from "./validation.js";

export interface SynthesizeCapabilitiesInput {
  architecture: ArchitectureIntelligence;
  model: RepositoryModel;
  workflowGraphs: WorkflowGraph[];
  terraformTopologies: TerraformTopology[];
  gitCommit: string;
  generatedAt: string;
  readinessWeights?: CapabilityReadinessWeights;
  readinessThresholds?: CapabilityReadinessThresholds;
}

function buildCapability(candidate: CapabilityCandidate, aggregate: CapabilityEvidenceAggregate, status: CapabilityStatus, readiness: CapabilityReadiness, decision: InclusionDecision, domainId: string): Capability {
  const naming = humanizeCapabilityName(candidate.naming);
  return {
    id: candidate.id,
    displayName: naming.displayLabel,
    shortDescription: naming.shortLabel,
    purpose: candidate.purpose.value,
    outcome: deriveCapabilityOutcome(candidate, aggregate),
    domainId,
    status,
    confidence: decision.confidence,
    inclusion: decision.inclusion,
    readiness,
    actors: candidate.actors,
    workflows: candidate.workflows,
    logicalComponents: candidate.logicalComponents,
    externalSystems: candidate.externalSystems,
    evidence: candidate.evidence,
    exclusions: decision.reasonCodes.length > 0 ? decision.reasonCodes : undefined,
    matchedIncompleteSignals: candidate.matchedIncompleteSignals,
    naming: { sourceLabel: candidate.sourceLabel, basis: naming.basis ?? "title-case" },
    granularity: candidate.granularity,
    roadmapStatement: decision.inclusion === "roadmap_only" ? candidate.roadmapStatement ?? candidate.purpose : undefined,
    gapStatement: decision.inclusion === "gap_only" ? candidate.gapStatement ?? candidate.purpose : undefined,
  };
}

function buildExcludedCandidate(candidate: CapabilityCandidate, status: CapabilityStatus, readiness: CapabilityReadiness, decision: InclusionDecision, domainId: string): ExcludedCapabilityCandidate {
  const naming = humanizeCapabilityName(candidate.naming);
  return {
    id: candidate.id,
    displayName: naming.displayLabel,
    domainId,
    sourceLabel: candidate.sourceLabel,
    granularity: candidate.granularity,
    status,
    confidence: decision.confidence,
    readiness,
    reasonCodes: decision.reasonCodes,
    reasonSummary: decision.reasonSummary,
    evidence: candidate.evidence,
  };
}

function summarizeConfidence(entries: CapabilityConfidence[]): ConfidenceSummary {
  const summary: ConfidenceSummary = { confirmed: 0, derived: 0, suggested: 0, unresolved: 0, total: entries.length };
  for (const c of entries) summary[c] += 1;
  return summary;
}

/**
 * The single pipeline entrypoint: candidates -> evidence -> maturity ->
 * readiness -> status -> inclusion decision -> outcome -> domain grouping.
 * Pure function over already-synthesized ArchitectureIntelligence plus the
 * same cached repository-model/workflow-graphs/terraform-topologies inputs
 * architecture synthesis itself consumes — this never re-scans the repo and
 * never calls an external model.
 */
export function synthesizeCapabilities(input: SynthesizeCapabilitiesInput): CapabilityModel {
  const { architecture, model, workflowGraphs, terraformTopologies, gitCommit, generatedAt } = input;
  const weights = input.readinessWeights ?? DEFAULT_CAPABILITY_READINESS_WEIGHTS;
  const thresholds = input.readinessThresholds ?? DEFAULT_CAPABILITY_READINESS_THRESHOLDS;

  const candidates = discoverCapabilityCandidates({ architecture, model, workflowGraphs, terraformTopologies });

  const domainLabels = new Map<string, string>();
  const includedCapabilities: Capability[] = [];
  const qualifiedCapabilities: Capability[] = [];
  const roadmapCapabilities: Capability[] = [];
  const gapCapabilities: Capability[] = [];
  const unresolvedCapabilities: Capability[] = [];
  const excludedCandidates: ExcludedCapabilityCandidate[] = [];
  const confidenceEntries: CapabilityConfidence[] = [];
  const evidenceTypeCounts: Partial<Record<CapabilityEvidenceType, number>> = {};

  for (const candidate of candidates) {
    const domainId = capDomainId(candidate.domainHint);
    if (!domainLabels.has(domainId)) domainLabels.set(domainId, candidate.domainHint);

    for (const item of candidate.evidence) {
      evidenceTypeCounts[item.type] = (evidenceTypeCounts[item.type] ?? 0) + 1;
    }

    const aggregate = aggregateCandidateEvidence(candidate);
    const maturity = assessCapabilityMaturity(candidate, aggregate);
    const readiness = computeCapabilityReadiness(maturity, weights);
    const status = classifyCapabilityStatus(candidate, aggregate, readiness, thresholds);
    const decision = decideCapabilityInclusion(candidate, aggregate, status, readiness);
    confidenceEntries.push(decision.confidence);

    switch (decision.inclusion) {
      case "include":
        includedCapabilities.push(buildCapability(candidate, aggregate, status, readiness, decision, domainId));
        break;
      case "include_with_qualification":
        qualifiedCapabilities.push(buildCapability(candidate, aggregate, status, readiness, decision, domainId));
        break;
      case "roadmap_only":
        roadmapCapabilities.push(buildCapability(candidate, aggregate, status, readiness, decision, domainId));
        break;
      case "gap_only":
        gapCapabilities.push(buildCapability(candidate, aggregate, status, readiness, decision, domainId));
        break;
      case "exclude":
        excludedCandidates.push(buildExcludedCandidate(candidate, status, readiness, decision, domainId));
        break;
      default: {
        const exhaustive: never = decision.inclusion;
        throw new Error(`Unhandled capability inclusion: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  includedCapabilities.sort((a, b) => a.id.localeCompare(b.id));
  qualifiedCapabilities.sort((a, b) => a.id.localeCompare(b.id));
  roadmapCapabilities.sort((a, b) => a.id.localeCompare(b.id));
  gapCapabilities.sort((a, b) => a.id.localeCompare(b.id));
  unresolvedCapabilities.sort((a, b) => a.id.localeCompare(b.id));
  excludedCandidates.sort((a, b) => a.id.localeCompare(b.id));

  const { domains } = buildCapabilityDomains([...includedCapabilities, ...qualifiedCapabilities], domainLabels);

  const evidenceSummary: CapabilityEvidenceSummary = {
    totalCandidates: candidates.length,
    includedCount: includedCapabilities.length,
    qualifiedCount: qualifiedCapabilities.length,
    excludedCount: excludedCandidates.length,
    roadmapCount: roadmapCapabilities.length,
    gapCount: gapCapabilities.length,
    unresolvedCount: unresolvedCapabilities.length,
    evidenceTypeCounts,
    confidence: summarizeConfidence(confidenceEntries),
  };

  const generationMetadata: CapabilityGenerationMetadata = {
    generated_at: generatedAt,
    git_commit: gitCommit,
    schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    source_architecture_intelligence_generated_at: architecture.metadata.generated_at,
    assist_used: false,
    readinessThresholds: thresholds,
    readinessWeights: weights,
    candidateCount: candidates.length,
  };

  const purposeStatement = architecture.purpose.problemStatement;
  const systemIdentity = {
    displayName: architecture.identity.name.displayLabel,
    purpose: purposeStatement.inference === "confirmed" || purposeStatement.inference === "derived" ? purposeStatement.value : undefined,
  };

  return {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity,
    domains,
    includedCapabilities,
    qualifiedCapabilities,
    excludedCandidates,
    roadmapCapabilities,
    gapCapabilities,
    unresolvedCapabilities,
    evidenceSummary,
    generationMetadata,
  };
}
