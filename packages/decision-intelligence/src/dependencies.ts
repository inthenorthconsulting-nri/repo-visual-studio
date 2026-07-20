// Decision-to-decision dependency graph, declared only via structured
// frontmatter syntax (a `dependencies:` array of `{ type, target }`
// entries, or per-type arrays keyed by the dependency type name itself).
// A declared dependency whose target does not resolve to a discovered
// decision is dropped -- DecisionDependency has no "unresolved" slot,
// unlike DecisionLink, so an unresolvable cross-reference here simply
// never becomes an edge.

import type { ArchitectureDecision, DecisionCycleClassification, DecisionDependency, DecisionDependencyCycle, DecisionDependencyType, EvidenceRef } from "./contracts.js";
import { buildDecisionGraph, findCycles } from "./decision-graph.js";
import { buildDependencyCycleId, buildDependencyId } from "./ids.js";

const DEPENDENCY_TYPES: readonly DecisionDependencyType[] = ["depends_on", "blocks", "requires", "is_required_by", "related_to", "conflicts_with"];

// "supersession_invalid" is reserved for supersession.ts's own cycle
// detector (over the supersedes/superseded_by graph, not this one) --
// dependencies.ts never produces that classification.
const INFORMATIONAL_KINDS: readonly DecisionDependencyType[] = ["related_to"];
const BLOCKING_KINDS: readonly DecisionDependencyType[] = ["depends_on", "blocks", "requires", "is_required_by"];

export interface DeclaredDependency {
  type: DecisionDependencyType;
  target: string;
}

export function extractDeclaredDependencies(frontmatter: Record<string, unknown> | undefined): DeclaredDependency[] {
  const results: DeclaredDependency[] = [];

  const structured = frontmatter?.["dependencies"];
  if (Array.isArray(structured)) {
    for (const entry of structured) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const type = record["type"];
      const target = record["target"];
      if (typeof type === "string" && isDependencyType(type) && typeof target === "string" && target.trim().length > 0) {
        results.push({ type, target: target.trim() });
      }
    }
  }

  for (const type of DEPENDENCY_TYPES) {
    const raw = frontmatter?.[type];
    if (!Array.isArray(raw)) continue;
    for (const target of raw) {
      if (typeof target === "string" && target.trim().length > 0) {
        results.push({ type, target: target.trim() });
      }
    }
  }

  return results;
}

function isDependencyType(value: string): value is DecisionDependencyType {
  return (DEPENDENCY_TYPES as readonly string[]).includes(value);
}

export interface BuildDependenciesResult {
  dependencies: DecisionDependency[];
  cycles: DecisionDependencyCycle[];
}

export function buildDecisionDependencies(
  decisions: ArchitectureDecision[],
  declaredByDecisionId: Map<string, DeclaredDependency[]>,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): BuildDependenciesResult {
  const knownIds = new Set(decisions.map((d) => d.id));
  const dependencies: DecisionDependency[] = [];

  for (const decision of decisions) {
    const declared = declaredByDecisionId.get(decision.id) ?? [];
    for (const dep of declared) {
      if (!knownIds.has(dep.target)) continue;
      dependencies.push({
        id: buildDependencyId(decision.id, dep.type, dep.target),
        from_decision_id: decision.id,
        to_decision_id: dep.target,
        dependency_type: dep.type,
        evidence_refs: evidenceRefsByDecisionId.get(decision.id) ?? [],
      });
    }
  }

  const graph = buildDecisionGraph(
    decisions.map((d) => d.id),
    dependencies.map((d) => ({ from: d.from_decision_id, to: d.to_decision_id, kind: d.dependency_type })),
  );

  const cycles: DecisionDependencyCycle[] = [
    ...buildCyclesForClassification(graph, INFORMATIONAL_KINDS, "informational_allowed", evidenceRefsByDecisionId),
    ...buildCyclesForClassification(graph, BLOCKING_KINDS, "blocking_flagged", evidenceRefsByDecisionId),
  ];

  return { dependencies: sortDependencies(dependencies), cycles: sortCycles(cycles) };
}

function buildCyclesForClassification(
  graph: ReturnType<typeof buildDecisionGraph<DecisionDependencyType>>,
  kinds: readonly DecisionDependencyType[],
  classification: DecisionCycleClassification,
  evidenceRefsByDecisionId: Map<string, EvidenceRef[]>,
): DecisionDependencyCycle[] {
  return findCycles(graph, kinds).map((decisionIds) => ({
    id: buildDependencyCycleId([...decisionIds].sort()),
    decision_ids: decisionIds,
    classification,
    evidence_refs: decisionIds.flatMap((id) => evidenceRefsByDecisionId.get(id) ?? []),
  }));
}

function sortDependencies(dependencies: DecisionDependency[]): DecisionDependency[] {
  return [...dependencies].sort((a, b) => a.id.localeCompare(b.id));
}

function sortCycles(cycles: DecisionDependencyCycle[]): DecisionDependencyCycle[] {
  return [...cycles].sort((a, b) => a.id.localeCompare(b.id));
}
