// Impact advisory: a thin wrapper around @rvs/knowledge-graph's own
// `runImpactAnalysis()`, called UNCHANGED against the overlay's own
// nodes/edges arrays. This module reimplements no traversal or impact
// logic of its own -- it only picks root entities (every ref this
// proposal's operations actually touch, that made it into the final
// overlay) and aggregates the per-root ImpactResult objects into one
// advisory-shaped summary.

import { DEFAULT_MAX_TRAVERSAL_DEPTH, buildDecisionStateLookup, runImpactAnalysis } from "@rvs/knowledge-graph";
import type { BlastRadiusLevel, DecisionStateLookup, EvidenceRef, ImpactResult } from "@rvs/knowledge-graph";
import type { ChangeAdvisory, ChangeOverlay, ProposalOperation } from "./contracts.js";

export interface ImpactAdvisoryParams {
  overlay: ChangeOverlay;
  operations: ProposalOperation[];
  maxDepth?: number;
  decisionStateLookup?: DecisionStateLookup;
}

export type ImpactAdvisoryResult = ChangeAdvisory["impact"] & {
  evidence_refs: EvidenceRef[];
  per_root_results: ImpactResult[];
};

const BLAST_RADIUS_RANK: Record<BlastRadiusLevel, number> = {
  isolated: 0,
  local: 1,
  cross_component: 2,
  cross_layer: 3,
  portfolio_wide: 4,
  unresolved: 5,
};

function touchedRefs(operation: ProposalOperation): string[] {
  switch (operation.kind) {
    case "add_entity":
      return [operation.ref];
    case "remove_entity":
    case "modify_attributes":
      return [operation.ref];
    case "add_relation":
    case "remove_relation":
    case "modify_relation":
      return [operation.from_ref, operation.to_ref];
  }
}

export function buildImpactAdvisory(params: ImpactAdvisoryParams): ImpactAdvisoryResult {
  const { overlay, operations, maxDepth = DEFAULT_MAX_TRAVERSAL_DEPTH, decisionStateLookup = buildDecisionStateLookup(undefined, undefined) } = params;

  const overlayNodeIds = new Set(overlay.nodes.map((node) => node.id));
  const roots = [...new Set(operations.flatMap(touchedRefs))].filter((ref) => overlayNodeIds.has(ref)).sort();

  if (roots.length === 0) {
    return {
      status: "not_evaluated",
      detail: "No operation in this proposal touches an entity present in the overlay -- there is nothing for impact analysis to run from.",
      directly_affected_refs: [],
      transitively_affected_refs: [],
      blast_radius_level: "isolated",
      unresolved_downstream_impact: false,
      truncated: false,
      evidence_refs: [],
      per_root_results: [],
    };
  }

  const perRoot: ImpactResult[] = roots.map((root) =>
    runImpactAnalysis(overlay.nodes, overlay.edges, { entity_node_id: root, max_depth: maxDepth, direction: "downstream" }, decisionStateLookup),
  );

  const directlyAffected = new Set<string>();
  const transitivelyAffected = new Set<string>();
  const evidenceRefKeys = new Set<string>();
  const evidenceRefs: EvidenceRef[] = [];
  let worstBlastRadius: BlastRadiusLevel = "isolated";
  let unresolvedDownstreamImpact = false;
  let truncated = false;

  for (const result of perRoot) {
    for (const finding of result.directly_affected) directlyAffected.add(finding.node_id);
    for (const finding of result.transitively_affected) transitivelyAffected.add(finding.node_id);
    if (BLAST_RADIUS_RANK[result.blast_radius_level] > BLAST_RADIUS_RANK[worstBlastRadius]) worstBlastRadius = result.blast_radius_level;
    unresolvedDownstreamImpact = unresolvedDownstreamImpact || result.unresolved_downstream_impact;
    truncated = truncated || result.truncated;
    for (const ref of result.evidence_refs) {
      const key = JSON.stringify(ref);
      if (evidenceRefKeys.has(key)) continue;
      evidenceRefKeys.add(key);
      evidenceRefs.push(ref);
    }
  }

  // A root itself is never its own "directly affected" entry.
  for (const root of roots) directlyAffected.delete(root);

  return {
    status: "evaluated",
    detail: `Impact analysis ran from ${roots.length} root ${roots.length === 1 ? "entity" : "entities"} touched by this proposal, against the proposal's own overlay (never the pre-proposal graph alone).`,
    directly_affected_refs: [...directlyAffected].sort(),
    transitively_affected_refs: [...transitivelyAffected].sort(),
    blast_radius_level: worstBlastRadius,
    unresolved_downstream_impact: unresolvedDownstreamImpact,
    truncated,
    evidence_refs: evidenceRefs,
    per_root_results: perRoot,
  };
}
