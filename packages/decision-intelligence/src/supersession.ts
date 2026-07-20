// Supersession is declared purely via a decision's own `supersedes` field --
// `superseded_by` is treated only as a reciprocal cross-check, never as a
// second independent source of graph edges, so a decision pair is never
// double-counted as two edges. There is no "newest date wins" heuristic
// anywhere here: a cycle is always invalid, never resolved by timestamp.

import type { ArchitectureDecision, DecisionSupersessionChain, DecisionSupersessionIssue, EvidenceRef } from "./contracts.js";
import { buildDecisionGraph, findCycles } from "./decision-graph.js";
import { buildSupersessionChainId, buildSupersessionIssueId } from "./ids.js";

export interface BuildSupersessionResult {
  issues: DecisionSupersessionIssue[];
  chains: DecisionSupersessionChain[];
}

export function buildDecisionSupersession(decisions: ArchitectureDecision[], evidenceRefsByDecisionId: Map<string, EvidenceRef[]>): BuildSupersessionResult {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const issues: DecisionSupersessionIssue[] = [];
  const flaggedIds = new Set<string>();

  for (const decision of decisions) {
    for (const supersededId of decision.supersedes) {
      const target = byId.get(supersededId);
      if (!target) {
        issues.push(buildIssue("missing_target", [decision.id], `${decision.id} declares supersedes of unknown decision "${supersededId}"`, evidenceRefsByDecisionId));
        continue;
      }
      if (!target.superseded_by.includes(decision.id)) {
        issues.push(
          buildIssue(
            "reciprocal_inconsistency",
            [decision.id, target.id],
            `${decision.id} declares supersedes of ${target.id}, but ${target.id}'s superseded_by does not name ${decision.id}`,
            evidenceRefsByDecisionId,
          ),
        );
        flaggedIds.add(decision.id);
        flaggedIds.add(target.id);
      }
    }
    for (const supersederId of decision.superseded_by) {
      const superseder = byId.get(supersederId);
      if (!superseder) {
        issues.push(buildIssue("missing_target", [decision.id], `${decision.id} declares superseded_by of unknown decision "${supersederId}"`, evidenceRefsByDecisionId));
        continue;
      }
      if (!superseder.supersedes.includes(decision.id)) {
        issues.push(
          buildIssue(
            "reciprocal_inconsistency",
            [decision.id, superseder.id],
            `${decision.id} declares superseded_by of ${superseder.id}, but ${superseder.id}'s supersedes does not name ${decision.id}`,
            evidenceRefsByDecisionId,
          ),
        );
        flaggedIds.add(decision.id);
        flaggedIds.add(superseder.id);
      }
    }
  }

  for (const decision of decisions) {
    const activeSuperseders = decisions.filter((d) => d.supersedes.includes(decision.id) && d.decision_status !== "superseded");
    if (activeSuperseders.length > 1) {
      const decisionIds = [...new Set([decision.id, ...activeSuperseders.map((d) => d.id)])].sort();
      issues.push(
        buildIssue(
          "multiple_active_superseders",
          decisionIds,
          `${decision.id} is superseded by more than one currently-active decision: ${activeSuperseders.map((d) => d.id).join(", ")}`,
          evidenceRefsByDecisionId,
        ),
      );
      for (const id of decisionIds) flaggedIds.add(id);
    }
  }

  const graph = buildDecisionGraph(
    decisions.map((d) => d.id),
    decisions.flatMap((d) => d.supersedes.filter((id) => byId.has(id)).map((id) => ({ from: d.id, to: id, kind: "supersedes" as const }))),
  );

  for (const cycle of findCycles(graph, ["supersedes"])) {
    issues.push(buildIssue("supersession_cycle", [...cycle].sort(), `Supersession cycle detected: ${cycle.join(" -> ")}`, evidenceRefsByDecisionId));
    for (const id of cycle) flaggedIds.add(id);
  }

  const chains = buildChains(graph, flaggedIds, evidenceRefsByDecisionId);

  return { issues: sortIssues(issues), chains: sortChains(chains) };
}

function buildChains(
  graph: ReturnType<typeof buildDecisionGraph<"supersedes">>,
  flaggedIds: Set<string>,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionSupersessionChain[] {
  const hasIncoming = new Set<string>(graph.edges.map((e) => e.to));
  const heads = graph.nodeIds.filter((id) => !hasIncoming.has(id) && (graph.adjacency.get(id)?.length ?? 0) > 0);

  const chains: DecisionSupersessionChain[] = [];
  for (const head of heads) {
    collectPaths(graph, head, [head], new Set([head]), (path) => {
      if (path.length < 2) return;
      const orderedOldestFirst = [...path].reverse();
      const isValid = path.every((id) => !flaggedIds.has(id));
      chains.push({
        id: buildSupersessionChainId(orderedOldestFirst),
        decision_ids_in_order: orderedOldestFirst,
        is_valid: isValid,
        evidence_refs: orderedOldestFirst.flatMap((id) => evidenceRefsByDecisionId.get(id) ?? []),
      });
    });
  }
  return chains;
}

function collectPaths(
  graph: ReturnType<typeof buildDecisionGraph<"supersedes">>,
  current: string,
  path: string[],
  onPath: Set<string>,
  onMaximalPath: (path: string[]) => void,
): void {
  const next = (graph.adjacency.get(current) ?? []).filter((edge) => edge.kind === "supersedes" && !onPath.has(edge.to));
  if (next.length === 0) {
    onMaximalPath(path);
    return;
  }
  for (const edge of next) {
    path.push(edge.to);
    onPath.add(edge.to);
    collectPaths(graph, edge.to, path, onPath, onMaximalPath);
    path.pop();
    onPath.delete(edge.to);
  }
}

function buildIssue(
  kind: DecisionSupersessionIssue["kind"],
  decisionIds: string[],
  detail: string,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionSupersessionIssue {
  const sorted = [...decisionIds].sort();
  return {
    id: buildSupersessionIssueId(kind, sorted),
    kind,
    decision_ids: sorted,
    detail,
    evidence_refs: sorted.flatMap((id) => evidenceRefsByDecisionId.get(id) ?? []),
  };
}

function sortIssues(issues: DecisionSupersessionIssue[]): DecisionSupersessionIssue[] {
  return [...issues].sort((a, b) => a.id.localeCompare(b.id));
}

function sortChains(chains: DecisionSupersessionChain[]): DecisionSupersessionChain[] {
  return [...chains].sort((a, b) => a.id.localeCompare(b.id));
}
