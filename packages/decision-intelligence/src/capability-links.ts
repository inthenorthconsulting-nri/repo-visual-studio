// Links a decision to capability-intelligence entities, declared via the
// decision's own structured `links:` frontmatter -- never inferred from
// shared terminology between a decision's prose and a capability's name.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink, collectKnownEntityIds, extractDeclaredLinks, resolveAgainstEntityIds } from "./links.js";

export function buildCapabilityLinks(decision: ArchitectureDecision, frontmatter: Record<string, unknown> | undefined, capabilitySnapshot: unknown): DecisionLink[] {
  const declared = extractDeclaredLinks(frontmatter).filter((d) => d.target_domain === "capability");
  if (declared.length === 0) return [];

  const knownIds = capabilitySnapshot === undefined ? undefined : collectKnownEntityIds(capabilitySnapshot);

  return declared.map((d) => {
    const outcome = resolveAgainstEntityIds(d.target_key, knownIds);
    const detail =
      outcome.resolution === "resolved"
        ? `Decision "${decision.id}" ${d.link_type} capability "${d.target_key}".`
        : `Decision "${decision.id}" declares a ${d.link_type} link to capability "${d.target_key}", which could not be confirmed against the available capability model.`;
    return buildDecisionLink(decision.id, d.link_type, "capability", d.target_key, outcome, detail, decision.evidence_refs);
  });
}
