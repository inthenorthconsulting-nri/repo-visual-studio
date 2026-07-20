// Links a decision to another decision, declared via the decision's own
// structured `links:` frontmatter -- the one target domain (`"decision"`)
// with no upstream artifact to resolve against, since the known-decision-id
// set is always populatable within a single analysis run (this package
// always knows every decision it just parsed). A decision linking to itself
// is never valid and is never silently dropped -- it always resolves
// "unresolved" with a self-link-specific detail message.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink, extractDeclaredLinks, resolveAgainstEntityIds } from "./links.js";

export function buildDecisionToDecisionLinks(
  decision: ArchitectureDecision,
  frontmatter: Record<string, unknown> | undefined,
  knownDecisionIds: Set<string>,
): DecisionLink[] {
  const declared = extractDeclaredLinks(frontmatter).filter((d) => d.target_domain === "decision");
  if (declared.length === 0) return [];

  return declared.map((d) => {
    if (d.target_key === decision.id) {
      return buildDecisionLink(
        decision.id,
        d.link_type,
        "decision",
        d.target_key,
        { resolution: "unresolved" },
        `Decision "${decision.id}" cannot link to itself.`,
        decision.evidence_refs,
      );
    }

    const outcome = resolveAgainstEntityIds(d.target_key, knownDecisionIds);
    const detail =
      outcome.resolution === "resolved"
        ? `Decision "${decision.id}" ${d.link_type}s decision "${d.target_key}".`
        : `Decision "${decision.id}" declares a "${d.link_type}" link to decision "${d.target_key}", which was not found among discovered decisions.`;
    return buildDecisionLink(decision.id, d.link_type, "decision", d.target_key, outcome, detail, decision.evidence_refs);
  });
}
