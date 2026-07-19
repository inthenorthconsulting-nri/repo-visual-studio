import type { ExecutiveNarrative, ProductClaim, ProductIdentityCandidate, ProductIdentityModel, ShowcasePlan } from "./contracts.js";

// §26: machine-readable outputs. Each function only serializes what synthesis
// already produced — rejected/held claims are included verbatim (never
// filtered out here), so nothing is silently discarded on export.

export function exportProductIdentityJson(model: ProductIdentityModel): string {
  return JSON.stringify(model, null, 2);
}

export function exportProductIdentityCandidatesJson(candidates: ProductIdentityCandidate[]): string {
  return JSON.stringify(candidates, null, 2);
}

export function exportExecutiveNarrativeJson(narrative: ExecutiveNarrative): string {
  return JSON.stringify(narrative, null, 2);
}

export function exportShowcasePlanJson(plan: ShowcasePlan): string {
  return JSON.stringify(plan, null, 2);
}

export function exportShowcaseClaimsJson(claims: ProductClaim[]): string {
  return JSON.stringify(claims, null, 2);
}

/** Human-readable rendering of a single claim, used by `rvs showcase explain <claim-id>`. */
export function explainClaim(claim: ProductClaim): string {
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
