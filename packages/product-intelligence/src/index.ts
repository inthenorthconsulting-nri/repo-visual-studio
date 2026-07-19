import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { classifyArchetypes, selectArchetypes } from "./archetypes.js";
import type {
  AudienceType,
  ExecutiveNarrative,
  ProductClaim,
  ProductIdentity,
  ProductIdentityConfidence,
  ProductIdentityGenerationMetadata,
  ProductIdentityModel,
  ProductIdentityOverride,
  ShowcaseEvidenceMode,
  ShowcasePlan,
} from "./contracts.js";
import { PRODUCT_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildProductClaims } from "./claims.js";
import { buildDifferentiators } from "./differentiators.js";
import { buildIdentityCandidates, descriptorForArchetype, shortPromiseFromPurpose } from "./identity-candidates.js";
import { gatherIdentityEvidence } from "./identity-evidence.js";
import { buildExecutiveNarrative } from "./narrative.js";
import { synthesizeProductPurpose } from "./purpose.js";
import { pickWinningCandidate, rankSecondaryCandidates } from "./ranking.js";
import { buildShowcasePlan } from "./showcase-plan.js";
import { deriveUsers } from "./users.js";
import { buildValuePillars } from "./value-pillars.js";

export * from "./archetypes.js";
export * from "./claims.js";
export * from "./contracts.js";
export * from "./differentiators.js";
export * from "./exporter.js";
export * from "./identity-candidates.js";
export * from "./identity-evidence.js";
export * from "./ids.js";
export * from "./label.js";
export * from "./narrative.js";
export * from "./override.js";
export * from "./purpose.js";
export * from "./ranking.js";
export * from "./showcase-plan.js";
export * from "./users.js";
export * from "./validation.js";
export * from "./value-pillars.js";

export interface SynthesizeProductIdentityInput {
  architecture: ArchitectureIntelligence;
  capabilityModel: CapabilityModel;
  override?: ProductIdentityOverride;
  gitCommit: string;
  generatedAt: string;
}

/**
 * The single pipeline entrypoint for Product Identity Intelligence:
 * evidence -> archetype classification -> candidates -> purpose/users ->
 * value pillars -> differentiators -> identity composition -> optional
 * `.rvs/product.yml` override. Pure function over an already-accepted
 * CapabilityModel plus its source ArchitectureIntelligence — never re-scans
 * the repository and never calls an external model (§ hard constraint).
 */
export function synthesizeProductIdentity(input: SynthesizeProductIdentityInput): ProductIdentityModel {
  const { architecture, capabilityModel, override, gitCommit, generatedAt } = input;

  const evidence = gatherIdentityEvidence(capabilityModel, architecture);
  const archetypeScores = classifyArchetypes(capabilityModel, architecture);
  const { primary, secondary } = selectArchetypes(archetypeScores);
  const { primaryUsers, secondaryUsers } = deriveUsers(capabilityModel, architecture);
  const purpose = synthesizeProductPurpose(capabilityModel, architecture, primaryUsers);
  const candidates = buildIdentityCandidates(archetypeScores, capabilityModel, architecture, evidence, primaryUsers);
  const valuePillars = buildValuePillars(capabilityModel, evidence);
  const differentiators = buildDifferentiators(capabilityModel, architecture, evidence);

  const winningCandidate = pickWinningCandidate(candidates, primary);
  const secondaryCandidates = rankSecondaryCandidates(candidates, primary, secondary);
  void secondaryCandidates; // retained on candidates[]/archetypeScores for output traceability; no separate field needed on ProductIdentity itself.

  const limitations = [
    ...capabilityModel.gapCapabilities.map((g) => g.gapStatement?.value ?? `${g.displayName} is a known gap.`),
    ...valuePillars.filter((p) => p.qualification).map((p) => p.qualification!),
  ];

  const baseConfidence: ProductIdentityConfidence = primary === "unknown" ? "unresolved" : (winningCandidate?.confidence ?? "suggested");

  let identity: ProductIdentity = {
    displayName: architecture.identity.name.displayLabel,
    descriptor: descriptorForArchetype(primary),
    shortPromise: shortPromiseFromPurpose(purpose.value),
    archetype: primary,
    secondaryArchetypes: secondary,
    purpose: purpose.value,
    primaryUsers,
    secondaryUsers,
    valuePillars,
    differentiators,
    currentCapabilities: capabilityModel.includedCapabilities.map((c) => c.id).sort((a, b) => a.localeCompare(b)),
    qualifiedCapabilities: capabilityModel.qualifiedCapabilities.map((c) => c.id).sort((a, b) => a.localeCompare(b)),
    limitations: [...new Set(limitations)].sort((a, b) => a.localeCompare(b)),
    evidence,
    confidence: baseConfidence,
    overrideApplied: false,
  };

  if (override) {
    identity = {
      ...identity,
      displayName: override.display_name ?? identity.displayName,
      descriptor: override.descriptor_override ?? identity.descriptor,
      purpose: override.purpose_override ?? identity.purpose,
      shortPromise: override.purpose_override ? shortPromiseFromPurpose(override.purpose_override) : identity.shortPromise,
      primaryUsers: override.primary_users ?? identity.primaryUsers,
      overrideApplied: true,
    };
  }

  const generationMetadata: ProductIdentityGenerationMetadata = {
    generated_at: generatedAt,
    git_commit: gitCommit,
    schema_version: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    source_capability_model_generated_at: capabilityModel.generationMetadata.generated_at,
    assist_used: false,
    overrideApplied: Boolean(override),
    overridePath: override ? ".rvs/product.yml" : undefined,
    candidateCount: candidates.length,
  };

  return {
    schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
    identity,
    candidates,
    archetypeScores,
    generationMetadata,
  };
}

export interface SynthesizeExecutiveNarrativeInput {
  identityModel: ProductIdentityModel;
  capabilityModel: CapabilityModel;
  override?: ProductIdentityOverride;
  audience: AudienceType;
}

export interface ExecutiveNarrativeResult {
  narrative: ExecutiveNarrative;
  claims: ProductClaim[];
}

/** §10/§11: claim control always runs before narrative synthesis — the narrative is composed only from claims.ts's output, never from raw identity text directly. */
export function synthesizeExecutiveNarrative(input: SynthesizeExecutiveNarrativeInput): ExecutiveNarrativeResult {
  const claims = buildProductClaims(input.identityModel.identity, input.capabilityModel, input.override);
  const narrative = buildExecutiveNarrative(input.identityModel.identity, claims, input.audience);
  return { narrative, claims };
}

export interface SynthesizeShowcasePlanInput {
  identityModel: ProductIdentityModel;
  narrative: ExecutiveNarrative;
  claims: ProductClaim[];
  capabilityModel: CapabilityModel;
  audience: AudienceType;
  theme: string;
  evidenceMode?: ShowcaseEvidenceMode;
  gitCommit: string;
  generatedAt: string;
}

export function synthesizeShowcasePlan(input: SynthesizeShowcasePlanInput): ShowcasePlan {
  return buildShowcasePlan(input.identityModel.identity, input.narrative, input.capabilityModel, input.claims, {
    audience: input.audience,
    theme: input.theme,
    evidenceMode: input.evidenceMode ?? "concise",
    gitCommit: input.gitCommit,
    generatedAt: input.generatedAt,
  });
}
