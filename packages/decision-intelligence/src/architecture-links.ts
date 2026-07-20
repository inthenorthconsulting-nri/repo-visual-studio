// Links a decision to architecture-intelligence entities (components,
// actors, external systems, flows, boundaries, dependencies, ...) declared
// via the decision's own structured `links:` frontmatter -- never inferred
// from a textual mention of a component's name in `context`/`decision_text`.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink, collectKnownEntityIds, extractDeclaredLinks, resolveAgainstEntityIds } from "./links.js";

export function buildArchitectureLinks(decision: ArchitectureDecision, frontmatter: Record<string, unknown> | undefined, architectureSnapshot: unknown): DecisionLink[] {
  const declared = extractDeclaredLinks(frontmatter).filter((d) => d.target_domain === "architecture");
  if (declared.length === 0) return [];

  const knownIds = architectureSnapshot === undefined ? undefined : collectKnownEntityIds(architectureSnapshot);

  return declared.map((d) => {
    const outcome = resolveAgainstEntityIds(d.target_key, knownIds);
    const detail =
      outcome.resolution === "resolved"
        ? `Decision "${decision.id}" ${d.link_type} architecture entity "${d.target_key}".`
        : `Decision "${decision.id}" declares a ${d.link_type} link to architecture entity "${d.target_key}", which could not be confirmed against the available architecture snapshot.`;
    return buildDecisionLink(decision.id, d.link_type, "architecture", d.target_key, outcome, detail, decision.evidence_refs);
  });
}
