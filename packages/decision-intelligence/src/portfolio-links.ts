// Links a decision to portfolio-intelligence entities, declared via the
// decision's own structured `links:` frontmatter -- never inferred from
// shared dependency usage alone between two repositories/products.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink, collectKnownEntityIds, extractDeclaredLinks, resolveAgainstEntityIds } from "./links.js";

export function buildPortfolioLinks(decision: ArchitectureDecision, frontmatter: Record<string, unknown> | undefined, portfolioSnapshot: unknown): DecisionLink[] {
  const declared = extractDeclaredLinks(frontmatter).filter((d) => d.target_domain === "portfolio");
  if (declared.length === 0) return [];

  const knownIds = portfolioSnapshot === undefined ? undefined : collectKnownEntityIds(portfolioSnapshot);

  return declared.map((d) => {
    const outcome = resolveAgainstEntityIds(d.target_key, knownIds);
    const detail =
      outcome.resolution === "resolved"
        ? `Decision "${decision.id}" ${d.link_type} portfolio relationship "${d.target_key}".`
        : `Decision "${decision.id}" declares a ${d.link_type} link to portfolio relationship "${d.target_key}", which could not be confirmed against the available portfolio model.`;
    return buildDecisionLink(decision.id, d.link_type, "portfolio", d.target_key, outcome, detail, decision.evidence_refs);
  });
}
