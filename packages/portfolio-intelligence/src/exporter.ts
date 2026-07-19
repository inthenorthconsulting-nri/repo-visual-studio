import type { PortfolioClaim, PortfolioDecision, PortfolioModel, PortfolioNarrative, PortfolioPlan } from "./contracts.js";

// §29: machine-readable outputs. Each function only serializes what synthesis
// already produced — rejected claims and reserved/unpopulated decision types
// are included verbatim (never filtered out here), so nothing is silently
// discarded on export. Mirrors @rvs/product-intelligence/src/exporter.ts.

export function exportPortfolioModelJson(model: PortfolioModel): string {
  return JSON.stringify(model, null, 2);
}

export function exportPortfolioClaimsJson(claims: PortfolioClaim[]): string {
  return JSON.stringify(claims, null, 2);
}

export function exportPortfolioDecisionsJson(decisions: PortfolioDecision[]): string {
  return JSON.stringify(decisions, null, 2);
}

export function exportPortfolioNarrativeJson(narrative: PortfolioNarrative): string {
  return JSON.stringify(narrative, null, 2);
}

export function exportPortfolioPlanJson(plan: PortfolioPlan): string {
  return JSON.stringify(plan, null, 2);
}

/** Human-readable rendering of a single portfolio claim, used by `rvs portfolio explain <id>`. */
export function explainPortfolioClaim(claim: PortfolioClaim): string {
  const lines: string[] = [];
  lines.push(`Claim: ${claim.text}`);
  lines.push(`  id: ${claim.id}`);
  lines.push(`  type: ${claim.claimType}`);
  lines.push(`  status: ${claim.status}`);
  if (claim.qualifiers.length > 0) {
    lines.push(`  qualifiers:`);
    for (const q of claim.qualifiers) lines.push(`    - ${q}`);
  }
  if (claim.rejectionReasons.length > 0) {
    lines.push(`  rejection reasons:`);
    for (const r of claim.rejectionReasons) lines.push(`    - ${r}`);
  }
  lines.push(`  evidence:`);
  if (claim.evidenceIds.length === 0) lines.push(`    (none recorded)`);
  for (const evidenceId of claim.evidenceIds) lines.push(`    - ${evidenceId}`);
  return lines.join("\n");
}

/** Human-readable rendering of a single portfolio decision, used by `rvs portfolio explain <id>`. */
export function explainPortfolioDecision(decision: PortfolioDecision): string {
  const lines: string[] = [];
  lines.push(`Decision: ${decision.statement}`);
  lines.push(`  id: ${decision.id}`);
  lines.push(`  type: ${decision.type}`);
  lines.push(`  urgency: ${decision.urgency}`);
  lines.push(`  confidence: ${decision.confidence}`);
  lines.push(`  recommended owner: ${decision.recommendedOwnerType}`);
  lines.push(`  why it matters: ${decision.whyItMatters}`);
  lines.push(`  current ambiguity: ${decision.currentAmbiguity}`);
  lines.push(`  affected products:`);
  if (decision.affectedProductIds.length === 0) lines.push(`    (none recorded)`);
  for (const productId of decision.affectedProductIds) lines.push(`    - ${productId}`);
  lines.push(`  evidence:`);
  if (decision.evidenceIds.length === 0) lines.push(`    (none recorded)`);
  for (const evidenceId of decision.evidenceIds) lines.push(`    - ${evidenceId}`);
  return lines.join("\n");
}
