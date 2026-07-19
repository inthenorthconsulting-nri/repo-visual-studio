import type { PortfolioCapability, PortfolioClaim, PortfolioGap, PortfolioNarrative, PortfolioOperatingModel, PortfolioProduct, PortfolioProductRelationship } from "./contracts.js";

// ---------------------------------------------------------------------------
// §19 Portfolio narrative
//
// Every sentence in every section is assembled only from approved or
// approved_with_qualification claims (never from a rejected claim, and
// never from raw model facts that weren't first put through claims.ts's
// evidence gate) — mirrors @rvs/product-intelligence/src/narrative.ts's own
// "never invents a claim outside what claims.ts already approved" rule.
// Gaps are the one exception: they are already-validated structural facts
// (gaps.ts), not claims, so gapsAndDecisions may cite them directly, the
// same way product-intelligence's narrative cites identity.limitations
// directly alongside claim-derived proof points.
// ---------------------------------------------------------------------------

function approvedText(claims: PortfolioClaim[], claimType: PortfolioClaim["claimType"]): string[] {
  return claims
    .filter((c) => c.claimType === claimType && (c.status === "approved" || c.status === "approved_with_qualification"))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => c.text);
}

function joinSentences(sentences: string[], fallback: string): string {
  const nonEmpty = sentences.filter((s) => s.trim().length > 0);
  return nonEmpty.length > 0 ? nonEmpty.join(" ") : fallback;
}

function buildMissionSection(displayName: string, products: PortfolioProduct[], claims: PortfolioClaim[]): string {
  const identityClaims = approvedText(claims, "identity");
  const portfolioClaim = identityClaims.find((t) => t.startsWith(displayName) && t.includes("portfolio of"));
  const sentences = [portfolioClaim ?? `${displayName} is a portfolio of ${products.length} product${products.length === 1 ? "" : "s"}.`];
  return joinSentences(sentences, `${displayName} has no products with approved identity evidence yet.`);
}

function buildProductsAndRolesSection(products: PortfolioProduct[], claims: PortfolioClaim[]): string {
  const approvedIdentitySentences = new Set(approvedText(claims, "identity"));
  const sentences = [...products]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const identityText = `${p.displayName}: ${p.descriptor}`;
      const roleText = `${p.displayName} is classified as a ${p.primaryRole.replace(/_/g, " ")}.`;
      return approvedIdentitySentences.has(identityText) ? `${identityText} ${roleText}` : roleText;
    });
  return joinSentences(sentences, "No product identities are currently approved for narrative use.");
}

function buildOperatingModelSection(operatingModel: PortfolioOperatingModel, claims: PortfolioClaim[]): string {
  if (operatingModel.stages.length === 0) return "No products are currently assigned to an inferred operating-model stage.";
  const sentences = approvedText(claims, "operating_model");
  return joinSentences(sentences, "No operating-model stage assignment is currently backed by approved evidence.");
}

function buildCapabilityCoverageSection(capabilities: PortfolioCapability[], claims: PortfolioClaim[]): string {
  const totalClaim = approvedText(claims, "coverage").find((t) => t.startsWith("The portfolio provides"));
  const distinctCount = capabilities.length;
  const sharedCount = capabilities.filter((c) => c.coverage === "shared" || c.coverage === "overlapping").length;
  const sentences = [totalClaim, `The portfolio's normalized capability set contains ${distinctCount} distinct capabilit${distinctCount === 1 ? "y" : "ies"}, of which ${sharedCount} are implemented by more than one product.`].filter(
    (s): s is string => Boolean(s),
  );
  return joinSentences(sentences, "No capability coverage is currently backed by approved evidence.");
}

function buildProductRelationshipsSection(relationships: PortfolioProductRelationship[], unresolvedRelationships: PortfolioProductRelationship[], claims: PortfolioClaim[]): string {
  const relationshipSentences = [...approvedText(claims, "relationship"), ...approvedText(claims, "integration"), ...approvedText(claims, "unification")];
  const summary = `${relationships.length} cross-product relationship${relationships.length === 1 ? "" : "s"} resolved to a specific type; ${unresolvedRelationships.length} remain unresolved and are not asserted as any specific relationship.`;
  return joinSentences([summary, ...relationshipSentences], summary);
}

function buildProofAndMaturitySection(claims: PortfolioClaim[]): string {
  const maturitySentences = approvedText(claims, "maturity");
  const runtimeCount = claims.filter((c) => c.claimType === "maturity" && c.text.includes("verified in operation") && c.status === "approved").length;
  const summary = `${runtimeCount} confirmed capabilit${runtimeCount === 1 ? "y is" : "ies are"} backed by runtime, usage, or deployment evidence.`;
  return joinSentences([...maturitySentences, summary], "No maturity evidence is currently approved.");
}

function buildGapsAndDecisionsSection(gaps: PortfolioGap[]): string {
  if (gaps.length === 0) return "No structural gaps were detected from the evidence currently available.";
  const byType = new Map<string, number>();
  for (const gap of gaps) byType.set(gap.type, (byType.get(gap.type) ?? 0) + 1);
  const sentence = [...byType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
    .join(", ");
  return `${gaps.length} gap${gaps.length === 1 ? "" : "s"} detected: ${sentence}.`;
}

function buildStrategicDirectionSection(claims: PortfolioClaim[], gaps: PortfolioGap[]): string {
  const ownershipGapCount = claims.filter((c) => c.claimType === "ownership" && c.status === "rejected").length;
  const pieces = [
    "This portfolio is presented strictly by what current evidence supports; unresolved relationships, unverified runtime claims, and unresolved ownership remain visibly marked rather than folded into the current-state story.",
  ];
  if (gaps.length > 0) pieces.push(`${gaps.length} open gap${gaps.length === 1 ? "" : "s"} and ${ownershipGapCount} unresolved-ownership signal${ownershipGapCount === 1 ? "" : "s"} are the immediate candidates for portfolio-level decisions.`);
  return pieces.join(" ");
}

export function buildPortfolioNarrative(displayName: string, products: PortfolioProduct[], capabilities: PortfolioCapability[], relationships: PortfolioProductRelationship[], unresolvedRelationships: PortfolioProductRelationship[], operatingModel: PortfolioOperatingModel, gaps: PortfolioGap[], claims: PortfolioClaim[]): PortfolioNarrative {
  const approvedClaims = claims.filter((c) => c.status === "approved" || c.status === "approved_with_qualification");
  const rejectedClaims = claims.filter((c) => c.status === "rejected");
  const runtimeVerificationClaims = claims.filter((c) => c.status === "runtime_verification_required");

  return {
    mission: buildMissionSection(displayName, products, claims),
    productsAndRoles: buildProductsAndRolesSection(products, claims),
    sharedOperatingModel: buildOperatingModelSection(operatingModel, claims),
    capabilityCoverage: buildCapabilityCoverageSection(capabilities, claims),
    productRelationships: buildProductRelationshipsSection(relationships, unresolvedRelationships, claims),
    proofAndMaturity: buildProofAndMaturitySection(claims),
    gapsAndDecisions: buildGapsAndDecisionsSection(gaps),
    strategicDirection: buildStrategicDirectionSection(claims, gaps),
    approvedClaims: [...approvedClaims].sort((a, b) => a.id.localeCompare(b.id)),
    rejectedClaims: [...rejectedClaims].sort((a, b) => a.id.localeCompare(b.id)),
    runtimeVerificationClaims: [...runtimeVerificationClaims].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
