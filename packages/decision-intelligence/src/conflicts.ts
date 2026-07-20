// Structural-only conflict detection. `confirmed` is reserved for pairs
// where the contradiction is directly readable from the decisions' own
// declared fields (status, explicit `conflicts_with` dependency) -- never
// semantic similarity of prose. Pairs that are only plausibly incompatible
// (same resolved link target, contradictory link types) are `probable` at
// best. There is no general "mutually exclusive entity" registry available
// to this package (no upstream type coupling), so mutually-exclusive-
// requirements detection is scoped to explicit author-declared
// `conflicts_with` dependency edges -- the one place that relationship is
// unambiguously structural rather than inferred.

import type { ArchitectureDecision, DecisionConflict, DecisionConflictKind, DecisionConflictStatus, DecisionDependency, DecisionLink, EvidenceRef } from "./contracts.js";
import { buildConflictId } from "./ids.js";

const ACTIVE_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["accepted", "implemented", "partially_implemented"]);

const CONTRADICTORY_LINK_PAIRS: ReadonlyArray<readonly [DecisionLink["link_type"], DecisionLink["link_type"]]> = [
  ["introduces", "removes"],
  ["permits", "deprecates"],
  ["requires", "excepts"],
  ["permits", "removes"],
];

export function buildDecisionConflicts(
  decisions: ArchitectureDecision[],
  links: DecisionLink[],
  dependencies: DecisionDependency[],
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionConflict[] {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const conflicts: DecisionConflict[] = [];

  for (const dependency of dependencies) {
    if (dependency.dependency_type !== "depends_on" && dependency.dependency_type !== "requires") continue;
    const from = byId.get(dependency.from_decision_id);
    const to = byId.get(dependency.to_decision_id);
    if (!from || !to) continue;
    if (ACTIVE_STATUSES.has(from.decision_status) && (to.decision_status === "rejected" || to.decision_status === "withdrawn")) {
      conflicts.push(buildConflict(from.id, to.id, "accepted_depends_on_rejected", "confirmed", `${from.id} (${from.decision_status}) depends on ${to.id} (${to.decision_status})`, evidenceRefsByDecisionId));
    }
  }

  for (const decision of decisions) {
    if (!ACTIVE_STATUSES.has(decision.decision_status)) continue;
    for (const supersederId of decision.superseded_by) {
      const superseder = byId.get(supersederId);
      if (superseder && ACTIVE_STATUSES.has(superseder.decision_status)) {
        conflicts.push(
          buildConflict(
            decision.id,
            superseder.id,
            "active_and_superseded_simultaneously",
            "confirmed",
            `${decision.id} is marked ${decision.decision_status} but is also superseded_by active decision ${superseder.id}`,
            evidenceRefsByDecisionId,
          ),
        );
      }
    }
  }

  for (const dependency of dependencies) {
    if (dependency.dependency_type !== "conflicts_with") continue;
    const from = byId.get(dependency.from_decision_id);
    const to = byId.get(dependency.to_decision_id);
    if (!from || !to) continue;
    const bothActive = ACTIVE_STATUSES.has(from.decision_status) && ACTIVE_STATUSES.has(to.decision_status);
    conflicts.push(
      buildConflict(
        from.id,
        to.id,
        "mutually_exclusive_requirements",
        bothActive ? "confirmed" : "possible",
        `${from.id} and ${to.id} declare an explicit conflicts_with relationship${bothActive ? "" : " (not both currently active)"}`,
        evidenceRefsByDecisionId,
      ),
    );
  }

  conflicts.push(
    ...detectContradictoryLinks(byId, links, ["architecture", "capability", "product", "portfolio"], "incompatible_required_states", evidenceRefsByDecisionId),
  );
  conflicts.push(...detectContradictoryLinks(byId, links, ["governance"], "incompatible_baseline_policy_linkage", evidenceRefsByDecisionId));

  return dedupe(conflicts).sort((a, b) => a.id.localeCompare(b.id));
}

function detectContradictoryLinks(
  byId: Map<string, ArchitectureDecision>,
  links: DecisionLink[],
  domains: ReadonlyArray<DecisionLink["target_domain"]>,
  kind: DecisionConflictKind,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionConflict[] {
  const resolved = links.filter((l) => domains.includes(l.target_domain) && l.target_id && (l.resolution === "resolved" || l.resolution === "partially_resolved"));
  const byTarget = new Map<string, DecisionLink[]>();
  for (const link of resolved) {
    const key = `${link.target_domain}:${link.target_id}`;
    const list = byTarget.get(key) ?? [];
    list.push(link);
    byTarget.set(key, list);
  }

  const conflicts: DecisionConflict[] = [];
  for (const linksForTarget of byTarget.values()) {
    for (let i = 0; i < linksForTarget.length; i += 1) {
      for (let j = i + 1; j < linksForTarget.length; j += 1) {
        const a = linksForTarget[i]!;
        const b = linksForTarget[j]!;
        if (a.decision_id === b.decision_id) continue;
        if (!isContradictoryPair(a.link_type, b.link_type)) continue;
        const decisionA = byId.get(a.decision_id);
        const decisionB = byId.get(b.decision_id);
        if (!decisionA || !decisionB) continue;
        const bothActive = ACTIVE_STATUSES.has(decisionA.decision_status) && ACTIVE_STATUSES.has(decisionB.decision_status);
        conflicts.push(
          buildConflict(
            decisionA.id,
            decisionB.id,
            kind,
            bothActive ? "probable" : "possible",
            `${decisionA.id} (${a.link_type}) and ${decisionB.id} (${b.link_type}) resolve to the same ${a.target_domain} target "${a.target_id}"`,
            evidenceRefsByDecisionId,
          ),
        );
      }
    }
  }
  return conflicts;
}

function isContradictoryPair(a: DecisionLink["link_type"], b: DecisionLink["link_type"]): boolean {
  return CONTRADICTORY_LINK_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function buildConflict(
  decisionAId: string,
  decisionBId: string,
  kind: DecisionConflictKind,
  status: DecisionConflictStatus,
  detail: string,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionConflict {
  const [first, second] = [decisionAId, decisionBId].sort() as [string, string];
  return {
    id: buildConflictId(decisionAId, decisionBId, kind),
    decision_ids: [first, second],
    kind,
    status,
    detail,
    evidence_refs: [...(evidenceRefsByDecisionId.get(decisionAId) ?? []), ...(evidenceRefsByDecisionId.get(decisionBId) ?? [])],
  };
}

function dedupe(conflicts: DecisionConflict[]): DecisionConflict[] {
  const byId = new Map<string, DecisionConflict>();
  for (const conflict of conflicts) byId.set(conflict.id, conflict);
  return [...byId.values()];
}
