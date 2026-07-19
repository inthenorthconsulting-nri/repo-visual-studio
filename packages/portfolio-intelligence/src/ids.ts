// Mirrors @rvs/product-intelligence/src/ids.ts and @rvs/capability-intelligence/src/ids.ts:
// every id is a pure function of a stable input (config id / normalized
// label / product id pair, never scan order or timestamps) so two
// syntheses of the same set of input artifacts produce byte-identical output.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function portfolioProductId(configId: string): string {
  return `portfolio:product:${sanitize(configId)}`;
}

export function portfolioEvidenceId(sourceType: string, productId: string, index: number): string {
  return `portfolio:evidence:${sanitize(sourceType)}:${sanitize(productId)}:${index}`;
}

export function portfolioCapabilityId(normalizedKey: string): string {
  return `portfolio:capability:${sanitize(normalizedKey)}`;
}

export function portfolioDomainId(domainLabel: string): string {
  return `portfolio:domain:${sanitize(domainLabel.toLowerCase())}`;
}

export function portfolioRelationshipId(productAId: string, productBId: string, type: string): string {
  const [first, second] = [productAId, productBId].sort((a, b) => a.localeCompare(b));
  return `portfolio:relationship:${sanitize(type)}:${sanitize(first)}:${sanitize(second)}`;
}

export function portfolioDependencyNodeId(kind: string, label: string): string {
  return `portfolio:node:${sanitize(kind)}:${sanitize(label.toLowerCase())}`;
}

export function portfolioDependencyEdgeId(kind: string, sourceProductId: string, targetId: string): string {
  return `portfolio:edge:${sanitize(kind)}:${sanitize(sourceProductId)}:${sanitize(targetId)}`;
}

export function portfolioOverlapId(capabilityId: string): string {
  return `portfolio:overlap:${sanitize(capabilityId)}`;
}

export function portfolioGapId(type: string, key: string): string {
  return `portfolio:gap:${sanitize(type)}:${sanitize(key.toLowerCase())}`;
}

export function portfolioClaimId(claimType: string, subjectId: string): string {
  return `portfolio:claim:${sanitize(claimType)}:${sanitize(subjectId)}`;
}

export function portfolioDecisionId(type: string, key: string): string {
  return `portfolio:decision:${sanitize(type)}:${sanitize(key.toLowerCase())}`;
}

export function portfolioSceneId(type: string, index: number): string {
  return `portfolio:scene:${sanitize(type)}:${index}`;
}
