import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ClaimStatus, ClaimType, ProductClaim, ProductIdentity, ProductIdentityOverride, ShowcaseClaimRejectionReasonCode } from "./contracts.js";
import { claimId } from "./ids.js";
import { containsAbsoluteSuperiorityTerm, containsGenericMarketingTerm } from "./label.js";

const TECHNICAL_TOKEN_PATTERN = /[a-z0-9_-]+\/[a-z0-9_.-]+|\b[a-z]+(?:[A-Z][a-z0-9]*){2,}\b/;

interface ClaimDraft {
  subjectId: string;
  claimType: ClaimType;
  text: string;
  evidenceIds: string[];
  /** Set when this draft references a capability that must be checked against the model's roadmap/excluded/qualified sets. */
  capabilityId?: string;
  /** Set only for scale/adoption drafts sourced from a `.rvs/product.yml` runtime_claims override — never fabricated internally. */
  isOverrideRuntimeClaim?: boolean;
}

function classifyDraft(
  draft: ClaimDraft,
  model: CapabilityModel,
  seenNormalizedText: Set<string>,
  approvedTerms: ReadonlySet<string>,
): { status: ClaimStatus; rejectionReasons: ShowcaseClaimRejectionReasonCode[]; qualifiers: string[] } {
  const rejectionReasons: ShowcaseClaimRejectionReasonCode[] = [];
  const qualifiers: string[] = [];

  // approved_terms may only suppress this check for the "identity"/"purpose"
  // claim types — the only claim text built directly from the override's own
  // displayName/descriptor/purpose fields (see buildProductClaims below).
  // Every other claim type (outcome, capability, differentiator, maturity)
  // is strictly evidence-derived and stays fully subject to the check.
  const overrideControlledClaim = draft.claimType === "identity" || draft.claimType === "purpose";

  const marketingTerm = containsGenericMarketingTerm(draft.text);
  if (marketingTerm && !(overrideControlledClaim && approvedTerms.has(marketingTerm))) rejectionReasons.push("SHOWCASE_CLAIM_GENERIC_MARKETING");

  const absoluteTerm = containsAbsoluteSuperiorityTerm(draft.text);
  if (absoluteTerm && !(overrideControlledClaim && approvedTerms.has(absoluteTerm))) rejectionReasons.push("SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE");

  if (TECHNICAL_TOKEN_PATTERN.test(draft.text)) rejectionReasons.push("SHOWCASE_CLAIM_TOO_TECHNICAL");

  const normalized = draft.text.trim().toLowerCase();
  if (seenNormalizedText.has(normalized)) rejectionReasons.push("SHOWCASE_CLAIM_DUPLICATE");
  seenNormalizedText.add(normalized);

  let isQualifiedPartial = false;
  if (draft.capabilityId) {
    const isRoadmap = model.roadmapCapabilities.some((c) => c.id === draft.capabilityId);
    const isExcluded = model.excludedCandidates.some((c) => c.id === draft.capabilityId);
    const isQualified = model.qualifiedCapabilities.some((c) => c.id === draft.capabilityId);
    if (isRoadmap) rejectionReasons.push("SHOWCASE_CLAIM_ROADMAP_PROMOTED");
    if (isExcluded) rejectionReasons.push("SHOWCASE_CLAIM_EXCLUDED_CAPABILITY");
    if (isQualified) isQualifiedPartial = true;
  }

  if ((draft.claimType === "scale" || draft.claimType === "adoption") && !draft.isOverrideRuntimeClaim) {
    rejectionReasons.push(draft.claimType === "scale" ? "SHOWCASE_CLAIM_UNSUPPORTED_SCALE" : "SHOWCASE_CLAIM_UNSUPPORTED_ROI");
  }

  if (draft.evidenceIds.length === 0 && draft.claimType !== "maturity") {
    rejectionReasons.push("SHOWCASE_CLAIM_UNSUPPORTED");
  }

  if (rejectionReasons.length > 0) {
    return { status: "rejected", rejectionReasons, qualifiers };
  }

  if (draft.isOverrideRuntimeClaim) {
    qualifiers.push("Pending runtime verification; not yet independently confirmed.");
    return { status: "runtime_verification_required", rejectionReasons: [], qualifiers };
  }

  if (isQualifiedPartial) {
    qualifiers.push("Evidence for this capability is partial; treat as qualified, not fully verified.");
    return { status: "approved_with_qualification", rejectionReasons: [], qualifiers };
  }

  return { status: "approved", rejectionReasons: [], qualifiers };
}

/**
 * §10: every claim proposed for the showcase — identity, purpose, pillar,
 * capability, differentiator, maturity, and any override-sourced runtime
 * claim — is classified here before it may reach a scene. Rejected/held
 * claims are returned, never silently discarded (§26).
 */
export function buildProductClaims(identity: ProductIdentity, model: CapabilityModel, override?: ProductIdentityOverride): ProductClaim[] {
  const drafts: ClaimDraft[] = [];
  const approvedTerms = new Set((override?.approved_terms ?? []).map((t) => t.toLowerCase()));

  drafts.push({
    subjectId: "identity",
    claimType: "identity",
    text: `${identity.displayName} is a ${identity.descriptor}.`,
    evidenceIds: identity.evidence.slice(0, 3).map((e) => e.id),
  });

  drafts.push({
    subjectId: "purpose",
    claimType: "purpose",
    text: identity.purpose,
    evidenceIds: identity.evidence.slice(0, 5).map((e) => e.id),
  });

  for (const pillar of identity.valuePillars) {
    drafts.push({
      subjectId: pillar.id,
      claimType: "outcome",
      text: `${pillar.title}: ${pillar.explanation}`,
      evidenceIds: pillar.evidenceIds,
    });
    for (const capId of pillar.includedCapabilityIds) {
      const cap = model.includedCapabilities.find((c) => c.id === capId);
      if (!cap) continue;
      drafts.push({ subjectId: capId, claimType: "capability", text: `${cap.displayName}: ${cap.purpose}`, evidenceIds: pillar.evidenceIds, capabilityId: capId });
    }
    for (const capId of pillar.qualifiedCapabilityIds) {
      const cap = model.qualifiedCapabilities.find((c) => c.id === capId);
      if (!cap) continue;
      drafts.push({ subjectId: capId, claimType: "capability", text: `${cap.displayName}: ${cap.purpose}`, evidenceIds: pillar.evidenceIds, capabilityId: capId });
    }
  }

  for (const differentiator of identity.differentiators) {
    drafts.push({
      subjectId: differentiator.id,
      claimType: "differentiator",
      text: `${differentiator.title}. ${differentiator.description}`,
      evidenceIds: differentiator.evidenceIds,
    });
  }

  const { includedCount, qualifiedCount, totalCandidates } = model.evidenceSummary;
  drafts.push({
    subjectId: "maturity",
    claimType: "maturity",
    text: `${includedCount} of ${totalCandidates} evaluated capabilities are currently included, with ${qualifiedCount} included under a stated qualification.`,
    evidenceIds: [],
  });

  for (const runtimeClaim of override?.runtime_claims ?? []) {
    drafts.push({
      subjectId: `override:${runtimeClaim.slice(0, 40)}`,
      claimType: runtimeClaim.toLowerCase().includes("adopt") || runtimeClaim.toLowerCase().includes("user") ? "adoption" : "scale",
      text: runtimeClaim,
      evidenceIds: ["product.yml:runtime_claims"],
      isOverrideRuntimeClaim: true,
    });
  }

  const seenNormalizedText = new Set<string>();
  const claims: ProductClaim[] = drafts.map((draft) => {
    const { status, rejectionReasons, qualifiers } = classifyDraft(draft, model, seenNormalizedText, approvedTerms);
    return {
      id: claimId(draft.claimType, draft.subjectId),
      text: draft.text,
      claimType: draft.claimType,
      status,
      evidenceIds: draft.evidenceIds,
      qualifiers,
      rejectionReasons,
    };
  });

  claims.sort((a, b) => a.id.localeCompare(b.id));
  return claims;
}
