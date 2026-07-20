// Links a decision to product-intelligence entities, declared via the
// decision's own structured `links:` frontmatter -- never inferred from a
// decision merely discussing a product-facing feature.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink, collectKnownEntityIds, extractDeclaredLinks, resolveAgainstEntityIds } from "./links.js";

export function buildProductLinks(decision: ArchitectureDecision, frontmatter: Record<string, unknown> | undefined, productSnapshot: unknown): DecisionLink[] {
  const declared = extractDeclaredLinks(frontmatter).filter((d) => d.target_domain === "product");
  if (declared.length === 0) return [];

  const knownIds = productSnapshot === undefined ? undefined : collectKnownEntityIds(productSnapshot);

  return declared.map((d) => {
    const outcome = resolveAgainstEntityIds(d.target_key, knownIds);
    const detail =
      outcome.resolution === "resolved"
        ? `Decision "${decision.id}" ${d.link_type} product entity "${d.target_key}".`
        : `Decision "${decision.id}" declares a ${d.link_type} link to product entity "${d.target_key}", which could not be confirmed against the available product identity model.`;
    return buildDecisionLink(decision.id, d.link_type, "product", d.target_key, outcome, detail, decision.evidence_refs);
  });
}
