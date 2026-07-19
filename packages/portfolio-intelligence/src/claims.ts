import { containsAbsoluteSuperiorityTerm, containsGenericMarketingTerm } from "@rvs/product-intelligence";
import type {
  PortfolioCapability,
  PortfolioClaim,
  PortfolioClaimRejectionReasonCode,
  PortfolioClaimStatus,
  PortfolioClaimType,
  PortfolioConfig,
  PortfolioEvidence,
  PortfolioMaturitySummary,
  PortfolioOperatingModel,
  PortfolioProduct,
  PortfolioProductRelationship,
} from "./contracts.js";
import { portfolioClaimId, portfolioEvidenceId } from "./ids.js";
import { isOwnershipResolved } from "./ownership.js";

// ---------------------------------------------------------------------------
// §18 Portfolio claim control
//
// Mirrors @rvs/product-intelligence/src/claims.ts's ClaimDraft ->
// classifyDraft -> buildXClaims pipeline exactly: every claim starts as a
// draft with evidence ids attached, is classified against the evidence it
// actually cites (never against what would be convenient to say), and only
// approved/qualified/runtime-required claims ever reach the narrative
// layer (§19). Rejected claims are kept, not discarded, so the final report
// can show what was said and what was withheld.
// ---------------------------------------------------------------------------

export interface ClaimDraft {
  subjectId: string;
  claimType: PortfolioClaimType;
  text: string;
  evidenceIds: string[];
  /** Present when the draft depends on evidence that is only partial (qualified-only participant, inferred-not-observed stage) — the claim is still approved, just with this caveat attached. */
  qualifierText?: string;
  requiresResolvedRelationship?: boolean;
  requiresResolvedOwnership?: boolean;
  isRoadmapOnly?: boolean;
  isOverrideRuntimeClaim?: boolean;
  /** Set when the draft's number would double-count a capability implemented by more than one product (e.g. summing per-product capability counts instead of using the deduplicated portfolio total). */
  impliesDoubleCounting?: boolean;
  /** Set when the draft asserts a product currently/fully implements a capability the evidence only qualifies it for. */
  assertsUnqualifiedButIsQualified?: boolean;
  /** Set when the draft asserts operational/runtime verification for a capability with no runtime, usage, or deployment evidence. */
  requiresRuntimeEvidence?: boolean;
}

export function classifyDraft(draft: ClaimDraft, seenNormalizedText: Set<string>, disallowedTerms: readonly string[]): { status: PortfolioClaimStatus; rejectionReasons: PortfolioClaimRejectionReasonCode[]; qualifiers: string[] } {
  const rejectionReasons: PortfolioClaimRejectionReasonCode[] = [];
  const qualifiers: string[] = [];

  if (draft.evidenceIds.length === 0) rejectionReasons.push("PORTFOLIO_CLAIM_UNSUPPORTED");

  const normalizedText = draft.text.trim().toLowerCase();
  const lowerDisallowed = disallowedTerms.map((t) => t.toLowerCase());
  if (lowerDisallowed.some((term) => normalizedText.includes(term))) rejectionReasons.push("PORTFOLIO_CLAIM_GENERIC_MARKETING");
  if (containsGenericMarketingTerm(draft.text)) rejectionReasons.push("PORTFOLIO_CLAIM_GENERIC_MARKETING");
  if (containsAbsoluteSuperiorityTerm(draft.text)) rejectionReasons.push("PORTFOLIO_CLAIM_GENERIC_MARKETING");

  if (seenNormalizedText.has(normalizedText)) rejectionReasons.push("PORTFOLIO_CLAIM_UNSUPPORTED");
  else seenNormalizedText.add(normalizedText);

  if (draft.isRoadmapOnly) rejectionReasons.push("PORTFOLIO_CLAIM_ROADMAP_PROMOTED");
  if (draft.requiresResolvedRelationship) rejectionReasons.push("PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP");
  if (draft.requiresResolvedOwnership) rejectionReasons.push("PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP");
  if (draft.impliesDoubleCounting) rejectionReasons.push("PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY");
  if (draft.assertsUnqualifiedButIsQualified) rejectionReasons.push("PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED");
  if (draft.requiresRuntimeEvidence) rejectionReasons.push("PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED");

  if (rejectionReasons.length > 0) return { status: "rejected", rejectionReasons, qualifiers };

  if (draft.isOverrideRuntimeClaim) return { status: "runtime_verification_required", rejectionReasons, qualifiers };

  if (draft.qualifierText) {
    qualifiers.push(draft.qualifierText);
    return { status: "approved_with_qualification", rejectionReasons, qualifiers };
  }

  return { status: "approved", rejectionReasons, qualifiers };
}

interface DraftResult {
  drafts: ClaimDraft[];
  evidence: PortfolioEvidence[];
}

function draftIdentityClaims(products: PortfolioProduct[], portfolioId: string, displayName: string): DraftResult {
  const drafts: ClaimDraft[] = [];
  const evidence: PortfolioEvidence[] = [];

  const portfolioEvidenceEntry: PortfolioEvidence = {
    id: portfolioEvidenceId("product_identity", portfolioId, 0),
    sourceType: "product_identity",
    productId: portfolioId,
    text: `${displayName} combines ${products.length} independently generated product artifact set${products.length === 1 ? "" : "s"}.`,
    confidence: "confirmed",
  };
  evidence.push(portfolioEvidenceEntry);
  drafts.push({
    subjectId: "portfolio",
    claimType: "identity",
    text: `${displayName} is a portfolio of ${products.length} product${products.length === 1 ? "" : "s"}.`,
    evidenceIds: [portfolioEvidenceEntry.id],
  });

  for (const product of products) {
    const entry: PortfolioEvidence = {
      id: portfolioEvidenceId("product_identity", product.id, 0),
      sourceType: "product_identity",
      productId: product.id,
      text: `${product.displayName}: ${product.descriptor}`,
      confidence: "confirmed",
    };
    evidence.push(entry);
    drafts.push({
      subjectId: product.id,
      claimType: "identity",
      text: `${product.displayName}: ${product.descriptor}`,
      evidenceIds: [entry.id],
    });
  }

  return { drafts, evidence };
}

function draftCoverageClaims(capabilities: PortfolioCapability[]): ClaimDraft[] {
  return capabilities.map((capability) => {
    const productIds = [...new Set(capability.participation.map((p) => p.productId))].sort((a, b) => a.localeCompare(b));
    const isQualifiedOnly = capability.participation.length > 0 && capability.participation.every((p) => p.qualified);
    return {
      subjectId: capability.id,
      claimType: "coverage" as const,
      text:
        productIds.length === 1
          ? `"${capability.displayName}" is implemented by 1 product in the portfolio.`
          : `"${capability.displayName}" is implemented across ${productIds.length} products in the portfolio.`,
      evidenceIds: capability.evidenceIds,
      qualifierText: isQualifiedOnly ? "Every current participant only qualifies for this capability; none fully implement it." : undefined,
    };
  });
}

/** One claim per (product, normalized capability) participation, guarding directly against overstating a qualified-only capability as fully current (§18 hard rule). */
function draftProductCapabilityClaims(capabilities: PortfolioCapability[], productDisplayNameById: Map<string, string>): ClaimDraft[] {
  const drafts: ClaimDraft[] = [];
  for (const capability of capabilities) {
    for (const participation of [...capability.participation].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const productName = productDisplayNameById.get(participation.productId) ?? participation.productId;
      drafts.push({
        subjectId: `${participation.productId}:${capability.id}`,
        claimType: "coverage",
        text: `${productName} currently implements "${capability.displayName}".`,
        evidenceIds: capability.evidenceIds,
        assertsUnqualifiedButIsQualified: participation.qualified,
      });
    }
  }
  return drafts;
}

/** A naive sum of each product's own capability count double-counts every shared/overlapping capability; only the deduplicated portfolio total is ever approved (§18 double-counting hard rule). */
function draftCapabilityCountClaim(products: PortfolioProduct[], capabilities: PortfolioCapability[]): ClaimDraft {
  const summedProductCounts = products.reduce((sum, p) => sum + p.currentCapabilityCount, 0);
  const evidenceIds = [...new Set(capabilities.flatMap((c) => c.evidenceIds))];
  return {
    subjectId: "portfolio-capability-total",
    claimType: "coverage",
    text: `The portfolio provides ${summedProductCounts} capabilities across ${products.length} products.`,
    evidenceIds,
    impliesDoubleCounting: summedProductCounts !== capabilities.length,
  };
}

function relationshipClaimType(rel: PortfolioProductRelationship): PortfolioClaimType {
  if (rel.type === "shared_platform" || rel.type === "shared_contract") return "integration";
  if (rel.type === "shared_capability") return "unification";
  return "relationship";
}

function draftRelationshipClaims(relationships: PortfolioProductRelationship[], unresolvedRelationships: PortfolioProductRelationship[]): ClaimDraft[] {
  const drafts: ClaimDraft[] = relationships.map((rel) => ({
    subjectId: rel.id,
    claimType: relationshipClaimType(rel),
    text: rel.statement,
    evidenceIds: rel.evidenceIds,
  }));
  for (const rel of unresolvedRelationships) {
    drafts.push({
      subjectId: rel.id,
      claimType: "relationship",
      text: rel.statement,
      evidenceIds: rel.evidenceIds,
      requiresResolvedRelationship: true,
    });
  }
  return drafts;
}

function draftMaturityClaims(maturity: PortfolioMaturitySummary, evidenceIds: string[]): ClaimDraft[] {
  return (Object.keys(maturity) as (keyof PortfolioMaturitySummary)[])
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const dim = maturity[key];
      return {
        subjectId: `maturity:${key}`,
        claimType: "maturity" as const,
        text: `${dim.label} ${dim.numerator}/${dim.denominator}.`,
        evidenceIds,
      };
    });
}

/** Guards against asserting operational/runtime verification for a capability that is only statically confirmed (§15 runtime_verification_gap's claim-layer counterpart). */
function draftRuntimeVerificationClaims(capabilities: PortfolioCapability[], runtimeEvidenceByCapability: Map<string, boolean>): ClaimDraft[] {
  return capabilities
    .filter((c) => c.confidence === "confirmed")
    .map((capability) => ({
      subjectId: `runtime:${capability.id}`,
      claimType: "maturity" as const,
      text: `"${capability.displayName}" is verified in operation by runtime, usage, or deployment evidence.`,
      evidenceIds: capability.evidenceIds,
      requiresRuntimeEvidence: !runtimeEvidenceByCapability.get(capability.id),
    }));
}

function draftOwnershipClaims(capabilities: PortfolioCapability[]): ClaimDraft[] {
  const drafts: ClaimDraft[] = [];
  for (const capability of capabilities) {
    if (capability.coverage !== "shared" && capability.coverage !== "overlapping") continue;
    const resolved = isOwnershipResolved(capability);
    drafts.push({
      subjectId: capability.id,
      claimType: "ownership",
      text: resolved
        ? `Ownership of "${capability.displayName}" is resolved to a single current-implementing product.`
        : `Ownership of "${capability.displayName}" is not yet resolved to a single product.`,
      evidenceIds: capability.evidenceIds,
      requiresResolvedOwnership: !resolved,
    });
  }
  return drafts;
}

function draftOperatingModelClaims(operatingModel: PortfolioOperatingModel, capabilities: PortfolioCapability[]): ClaimDraft[] {
  const capabilityById = new Map(capabilities.map((c) => [c.id, c]));
  return operatingModel.stages.map((stage) => {
    const evidenceIds = [...new Set(stage.capabilityIds.flatMap((id) => capabilityById.get(id)?.evidenceIds ?? []))].sort((a, b) => a.localeCompare(b));
    return {
      subjectId: `stage:${stage.stage}`,
      claimType: "operating_model" as const,
      text: `${stage.productIds.length} product${stage.productIds.length === 1 ? "" : "s"} are inferred to operate at the "${stage.stage}" stage of the portfolio's operating model.`,
      evidenceIds,
      qualifierText: stage.inferred ? "Stage placement is inferred from product role and capability domain, not from observed pipeline or deployment order." : undefined,
    };
  });
}

function draftScaleAdoptionClaims(config: PortfolioConfig | undefined, portfolioId: string): DraftResult {
  const drafts: ClaimDraft[] = [];
  const evidence: PortfolioEvidence[] = [];
  const runtimeClaims = config?.runtime_claims ?? [];
  for (const [index, text] of runtimeClaims.entries()) {
    const entry: PortfolioEvidence = {
      id: portfolioEvidenceId("config", portfolioId, index),
      sourceType: "config",
      productId: portfolioId,
      text,
      confidence: "suggested",
    };
    evidence.push(entry);
    drafts.push({
      subjectId: `runtime-claim:${index}`,
      claimType: /adopt/i.test(text) ? "adoption" : "scale",
      text,
      evidenceIds: [entry.id],
      isOverrideRuntimeClaim: true,
    });
  }
  return { drafts, evidence };
}

export interface BuildPortfolioClaimsInput {
  portfolioId: string;
  displayName: string;
  products: PortfolioProduct[];
  capabilities: PortfolioCapability[];
  relationships: PortfolioProductRelationship[];
  unresolvedRelationships: PortfolioProductRelationship[];
  maturity: PortfolioMaturitySummary;
  operatingModel: PortfolioOperatingModel;
  /** Shared with gaps.ts/maturity.ts via computeRuntimeEvidenceByCapability so all three never drift on what counts as "observed in operation". */
  runtimeEvidenceByCapability: Map<string, boolean>;
  evidence: PortfolioEvidence[];
  config: PortfolioConfig | undefined;
}

export interface BuildPortfolioClaimsResult {
  claims: PortfolioClaim[];
  evidence: PortfolioEvidence[];
}

export function buildPortfolioClaims(input: BuildPortfolioClaimsInput): BuildPortfolioClaimsResult {
  const seenNormalizedText = new Set<string>();
  const disallowedTerms = input.config?.disallowed_claims ?? [];
  const maturityEvidenceIds = input.evidence.filter((e) => e.sourceType === "capability" || e.sourceType === "capability_domain").map((e) => e.id);
  const productDisplayNameById = new Map(input.products.map((p) => [p.id, p.displayName]));

  const identity = draftIdentityClaims(input.products, input.portfolioId, input.displayName);
  const scaleAdoption = draftScaleAdoptionClaims(input.config, input.portfolioId);

  const drafts: ClaimDraft[] = [
    ...identity.drafts,
    ...draftCoverageClaims(input.capabilities),
    ...draftProductCapabilityClaims(input.capabilities, productDisplayNameById),
    draftCapabilityCountClaim(input.products, input.capabilities),
    ...draftRelationshipClaims(input.relationships, input.unresolvedRelationships),
    ...draftMaturityClaims(input.maturity, maturityEvidenceIds),
    ...draftRuntimeVerificationClaims(input.capabilities, input.runtimeEvidenceByCapability),
    ...draftOwnershipClaims(input.capabilities),
    ...draftOperatingModelClaims(input.operatingModel, input.capabilities),
    ...scaleAdoption.drafts,
  ];

  const claims: PortfolioClaim[] = drafts.map((draft) => {
    const { status, rejectionReasons, qualifiers } = classifyDraft(draft, seenNormalizedText, disallowedTerms);
    return {
      id: portfolioClaimId(draft.claimType, draft.subjectId),
      text: draft.text,
      claimType: draft.claimType,
      status,
      evidenceIds: draft.evidenceIds,
      qualifiers,
      rejectionReasons: augmentRejectionReasons(draft, rejectionReasons),
    };
  });

  return {
    claims: claims.sort((a, b) => a.id.localeCompare(b.id)),
    evidence: [...identity.evidence, ...scaleAdoption.evidence],
  };
}

/** Re-maps the generic UNSUPPORTED reason to the claim-type-specific scale/adoption/integration/unification codes contracts.ts defines, without changing classifyDraft's shared control flow. */
function augmentRejectionReasons(draft: ClaimDraft, reasons: PortfolioClaimRejectionReasonCode[]): PortfolioClaimRejectionReasonCode[] {
  if (!reasons.includes("PORTFOLIO_CLAIM_UNSUPPORTED")) return reasons;
  const specific = specificUnsupportedReason(draft.claimType);
  if (!specific) return reasons;
  return reasons.map((r) => (r === "PORTFOLIO_CLAIM_UNSUPPORTED" ? specific : r));
}

function specificUnsupportedReason(claimType: PortfolioClaimType): PortfolioClaimRejectionReasonCode | undefined {
  switch (claimType) {
    case "scale":
      return "PORTFOLIO_CLAIM_UNSUPPORTED_SCALE";
    case "adoption":
      return "PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION";
    case "integration":
      return "PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION";
    case "unification":
      return "PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION";
    default:
      return undefined;
  }
}
