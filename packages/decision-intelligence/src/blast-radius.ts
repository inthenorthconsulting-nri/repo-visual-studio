// Conservative, decision-scoped reach assessment -- a structural echo of
// governance-intelligence's blast-radius.ts BFS pattern (single-hop
// adjacency lookup, gated by an explicit availability check performed
// BEFORE any neighbor lookup), rebuilt on decision-intelligence's own
// DecisionLink/DecisionDependency data rather than raw architecture
// flows/components/boundaries -- those raw shapes are architecture-
// intelligence-specific and not meaningfully reusable here.
//
// §-critical rule (mirrors governance's own, tested explicitly): if there is
// no way to even ask whether this decision has neighbors (links/dependency
// resolution never ran, or the decision's own document was unparseable),
// the level MUST be "unresolved", never "isolated". A confirmed, data-backed
// absence of connections ("resolution ran, this decision simply has zero
// resolved links and zero dependency edges") is "isolated". Levels beyond
// that are derived only from the domains a decision's own resolved links
// touch and the decision-to-decision dependency edges it participates in --
// never from prose/semantic inference, and never more than one hop out.

import type { ArchitectureDecision, DecisionBlastRadiusAssessment, DecisionBlastRadiusLevel, DecisionDependency, DecisionLink, DecisionSourceIssue, EvidenceRef } from "./contracts.js";
import { buildBlastRadiusAssessmentId } from "./ids.js";

export interface BlastRadiusInputs {
  decisions: ArchitectureDecision[];
  links: DecisionLink[];
  dependencies: DecisionDependency[];
  sourceIssues: DecisionSourceIssue[];
  /** Whether link resolution (links.ts + the 5 *-links.ts files) ran at all across this snapshot. */
  linksAvailable: boolean;
  /** Whether dependency-graph construction (dependencies.ts) ran at all across this snapshot. */
  dependenciesAvailable: boolean;
}

export function assessDecisionBlastRadius(inputs: BlastRadiusInputs): DecisionBlastRadiusAssessment[] {
  const unparseablePaths = new Set(inputs.sourceIssues.filter((i) => i.kind === "unparseable_structure").flatMap((i) => i.affected_paths));

  return inputs.decisions
    .map((decision) => assessOne(decision, inputs, unparseablePaths))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function assessOne(decision: ArchitectureDecision, inputs: BlastRadiusInputs, unparseablePaths: Set<string>): DecisionBlastRadiusAssessment {
  const id = buildBlastRadiusAssessmentId(decision.id);

  if (!inputs.linksAvailable && !inputs.dependenciesAvailable) {
    return { id, decision_id: decision.id, level: "unresolved", affected_entity_ids: [], evidence_refs: [] };
  }
  if (unparseablePaths.has(decision.source.repo_relative_path)) {
    return { id, decision_id: decision.id, level: "unresolved", affected_entity_ids: [], evidence_refs: decision.evidence_refs };
  }

  const resolvedLinks = inputs.links.filter((l) => l.decision_id === decision.id && (l.resolution === "resolved" || l.resolution === "partially_resolved"));
  const targetDomains = new Set(resolvedLinks.map((l) => l.target_domain));
  const targetIds = new Set(resolvedLinks.map((l) => l.target_id).filter((v): v is string => Boolean(v)));

  const dependencyNeighborIds = new Set<string>();
  for (const dep of inputs.dependencies) {
    if (dep.from_decision_id === decision.id) dependencyNeighborIds.add(dep.to_decision_id);
    else if (dep.to_decision_id === decision.id) dependencyNeighborIds.add(dep.from_decision_id);
  }

  const evidenceRefs: EvidenceRef[] = [...resolvedLinks.flatMap((l) => l.evidence_refs), ...inputs.dependencies.filter((d) => d.from_decision_id === decision.id || d.to_decision_id === decision.id).flatMap((d) => d.evidence_refs)];

  const affectedEntityIds = [...new Set([...targetIds, ...dependencyNeighborIds])].sort();

  let level: DecisionBlastRadiusLevel;
  if (targetDomains.size === 0 && dependencyNeighborIds.size === 0) {
    level = "isolated";
  } else if (targetDomains.has("portfolio")) {
    level = "portfolio_wide";
  } else if (targetDomains.size >= 2) {
    level = "cross_layer";
  } else if (targetIds.size > 1 || dependencyNeighborIds.size > 0) {
    level = "cross_component";
  } else {
    level = "local";
  }

  return { id, decision_id: decision.id, level, affected_entity_ids: affectedEntityIds, evidence_refs: evidenceRefs };
}
