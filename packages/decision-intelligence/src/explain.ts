import type {
  DecisionAssumption,
  DecisionBlastRadiusAssessment,
  DecisionChangeSet,
  DecisionConflict,
  DecisionConsequence,
  DecisionCoverageMetric,
  DecisionDebtFinding,
  DecisionDrift,
  DecisionImplementationState,
  DecisionLink,
  DecisionSnapshot,
  DecisionSupersessionChain,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// explainDecisionId -- fallback-across-id-spaces lookup, mirroring
// @rvs/governance-intelligence/src/explain.ts's shape exactly: a pure
// function (no filesystem/logger access), a caller-supplied context carrying
// whatever already-loaded artifacts are available, and a plain thrown Error
// naming every space tried when nothing resolves. The CLI wrapper
// (packages/cli/src/commands/decisions-explain.ts) is the only try/catch
// site, matching governance-explain.ts's split.
//
// Search order, exactly as specified: decision id -> assumption id ->
// consequence id -> link id -> conflict id -> drift id -> debt id ->
// coverage id -> implementation-state id -> change id ->
// supersession-chain id.
// ---------------------------------------------------------------------------

export interface DecisionExplainContext {
  snapshot?: DecisionSnapshot;
  assumptions?: DecisionAssumption[];
  consequences?: DecisionConsequence[];
  links?: DecisionLink[];
  conflicts?: DecisionConflict[];
  drift?: DecisionDrift[];
  debtFindings?: DecisionDebtFinding[];
  coverage?: DecisionCoverageMetric[];
  implementationStates?: DecisionImplementationState[];
  changeSet?: DecisionChangeSet;
  supersessionChains?: DecisionSupersessionChain[];
  blastRadius?: DecisionBlastRadiusAssessment[];
}

export interface DecisionExplanation {
  /** Human-readable, multi-sentence explanation of what the id refers to. */
  explanation: string;
  /** The resolved object itself, for callers that want to inspect it further (e.g. an `rvs decisions explain --json` CLI layer, out of this package's scope). */
  resolved: unknown;
}

export function explainDecisionId(id: string, context: DecisionExplainContext): DecisionExplanation {
  const decision = context.snapshot?.decisions.find((candidate) => candidate.id === id);
  if (decision) {
    const assessment = context.blastRadius?.find((b) => b.decision_id === decision.id);
    const blastRadiusText = assessment
      ? ` Blast radius: "${assessment.level}" (${assessment.affected_entity_ids.length} affected entit${assessment.affected_entity_ids.length === 1 ? "y" : "ies"}).`
      : "";
    return {
      explanation: `Decision "${decision.id}" ("${decision.title}"): status "${decision.decision_status}", implementation status "${decision.implementation_status}", scope "${decision.scope}".${blastRadiusText}`,
      resolved: decision,
    };
  }

  const assumption = context.assumptions?.find((candidate) => candidate.id === id);
  if (assumption) {
    return {
      explanation: `Assumption "${assumption.id}" of decision "${assumption.decision_id}" (state "${assumption.state}"): ${assumption.statement}`,
      resolved: assumption,
    };
  }

  const consequence = context.consequences?.find((candidate) => candidate.id === id);
  if (consequence) {
    return {
      explanation: `Consequence "${consequence.id}" of decision "${consequence.decision_id}" (classification "${consequence.classification}"): ${consequence.statement}`,
      resolved: consequence,
    };
  }

  const link = context.links?.find((candidate) => candidate.id === id);
  if (link) {
    return {
      explanation: `Link "${link.id}" from decision "${link.decision_id}" (${link.link_type} -> ${link.target_domain}${link.target_id ? ` "${link.target_id}"` : ""}), resolution "${link.resolution}": ${link.detail}`,
      resolved: link,
    };
  }

  const conflict = context.conflicts?.find((candidate) => candidate.id === id);
  if (conflict) {
    return {
      explanation: `Conflict "${conflict.id}" (${conflict.kind}) between decisions "${conflict.decision_ids[0]}" and "${conflict.decision_ids[1]}", status "${conflict.status}": ${conflict.detail}`,
      resolved: conflict,
    };
  }

  const drift = context.drift?.find((candidate) => candidate.id === id);
  if (drift) {
    return {
      explanation: `Drift "${drift.id}" on decision "${drift.decision_id}" (cause "${drift.cause}", severity "${drift.severity}"): ${drift.detail}`,
      resolved: drift,
    };
  }

  const debt = context.debtFindings?.find((candidate) => candidate.id === id);
  if (debt) {
    return {
      explanation: `Decision debt "${debt.id}" on decision "${debt.decision_id}" (category "${debt.category}", severity "${debt.severity}", resolution "${debt.resolution_state}"${debt.requires_human_review ? ", requires human review" : ""}): ${debt.detail}`,
      resolved: debt,
    };
  }

  const coverage = context.coverage?.find((candidate) => candidate.id === id);
  if (coverage) {
    return {
      explanation: `Decision coverage "${coverage.id}" for dimension "${coverage.dimension}": ${coverage.numerator}/${coverage.denominator}.`,
      resolved: coverage,
    };
  }

  const implementationState = context.implementationStates?.find((candidate) => candidate.id === id);
  if (implementationState) {
    return {
      explanation: `Implementation state "${implementationState.id}" for decision "${implementationState.decision_id}" (status "${implementationState.status}"): ${implementationState.detail}`,
      resolved: implementationState,
    };
  }

  const change = context.changeSet?.changes.find((candidate) => candidate.id === id);
  if (change) {
    return {
      explanation: `Change "${change.id}" for decision "${change.decision_id}" (type "${change.change_type}", classification "${change.classification}"): ${change.detail}`,
      resolved: change,
    };
  }

  const chain = context.supersessionChains?.find((candidate) => candidate.id === id);
  if (chain) {
    return {
      explanation: `Supersession chain "${chain.id}" (${chain.is_valid ? "valid" : "invalid"}): ${chain.decision_ids_in_order.join(" -> ")}.`,
      resolved: chain,
    };
  }

  throw new Error(
    `No decision, assumption, consequence, link, conflict, drift, decision-debt, coverage, implementation-state, change, or supersession-chain found matching id "${id}". Run \`rvs decisions analyze\` first to produce a decision snapshot, then re-check the id against the cached artifacts.`,
  );
}
