// Missing-decision detection is policy-driven, never automatic: it is the
// caller's responsibility (via .rvs/decisions.yml-configured entity
// classifications cross-referenced with upstream change data) to supply
// which entity ids fall under which of the 6 named rule kinds -- this
// module never decides on its own that "every code change needs a
// decision." Its only job is to check whether a supplied entity id is
// covered by an accepted decision's resolved link.

import type { ArchitectureDecision, DecisionLink, EvidenceRef, MissingDecisionFinding, MissingDecisionRuleKind } from "./contracts.js";
import { buildMissingDecisionFindingId } from "./ids.js";

const ACCEPTABLE_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["accepted", "implemented", "partially_implemented"]);

export interface MissingDecisionRuleInput {
  rule_kind: MissingDecisionRuleKind;
  affected_entity_ids: string[];
}

export function detectMissingDecisions(
  rules: MissingDecisionRuleInput[],
  links: DecisionLink[],
  decisionStatusById: Map<string, ArchitectureDecision["decision_status"]>,
  evidenceRefs: EvidenceRef[],
): MissingDecisionFinding[] {
  const findings: MissingDecisionFinding[] = [];

  for (const rule of rules) {
    for (const entityId of rule.affected_entity_ids) {
      const covered = links.some(
        (l) =>
          l.target_id === entityId &&
          (l.resolution === "resolved" || l.resolution === "partially_resolved") &&
          ACCEPTABLE_STATUSES.has(decisionStatusById.get(l.decision_id) ?? "unknown"),
      );
      if (covered) continue;

      findings.push({
        id: buildMissingDecisionFindingId(rule.rule_kind, entityId),
        rule_kind: rule.rule_kind,
        affected_entity_id: entityId,
        detail: `No accepted decision has a resolved link to "${entityId}", required by rule "${rule.rule_kind}".`,
        evidence_refs: evidenceRefs,
      });
    }
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
