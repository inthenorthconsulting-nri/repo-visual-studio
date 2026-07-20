// Criticality is classified only from explicit metadata/config or a
// resolved link to a signal source that is itself explicitly known to be
// critical (a critical-flagged governance policy, a shared contract, a
// runtime entry point, a portfolio dependency) -- never word frequency or
// document length (spec §31). When none of those signal sources were even
// available to check (`signalsAvailable: false`), every decision without
// explicit frontmatter/config criticality resolves to "unresolved" -- "no
// way to even ask" never collapses into "standard."

import type { ArchitectureDecision, DecisionCriticality, DecisionCriticalityAssessment } from "./contracts.js";

const RANK: Record<Exclude<DecisionCriticality, "unresolved">, number> = { standard: 0, elevated: 1, critical: 2 };

export interface CriticalityInputs {
  configuredCriticalDecisionIds?: Set<string>;
  frontmatterCriticalityByDecisionId?: Map<string, Exclude<DecisionCriticality, "unresolved">>;
  linkedCriticalPolicyDecisionIds?: Set<string>;
  linkedSharedContractDecisionIds?: Set<string>;
  linkedRuntimeEntrypointDecisionIds?: Set<string>;
  linkedPortfolioDependencyDecisionIds?: Set<string>;
  linkedCriticalCapabilityDecisionIds?: Set<string>;
  signalsAvailable: boolean;
}

export function classifyDecisionCriticality(decisions: ArchitectureDecision[], inputs: CriticalityInputs): DecisionCriticalityAssessment[] {
  return decisions
    .map((decision) => classifyOne(decision, inputs))
    .sort((a, b) => a.decision_id.localeCompare(b.decision_id));
}

function classifyOne(decision: ArchitectureDecision, inputs: CriticalityInputs): DecisionCriticalityAssessment {
  const basis: string[] = [];
  let rank = -1;

  if (inputs.configuredCriticalDecisionIds?.has(decision.id)) {
    basis.push("configured_critical");
    rank = Math.max(rank, RANK.critical);
  }

  const frontmatterCriticality = inputs.frontmatterCriticalityByDecisionId?.get(decision.id);
  if (frontmatterCriticality) {
    basis.push(`frontmatter_criticality:${frontmatterCriticality}`);
    rank = Math.max(rank, RANK[frontmatterCriticality]);
  }

  if (inputs.linkedCriticalPolicyDecisionIds?.has(decision.id)) {
    basis.push("linked_critical_policy");
    rank = Math.max(rank, RANK.critical);
  }
  if (inputs.linkedSharedContractDecisionIds?.has(decision.id)) {
    basis.push("linked_shared_contract");
    rank = Math.max(rank, RANK.elevated);
  }
  if (inputs.linkedRuntimeEntrypointDecisionIds?.has(decision.id)) {
    basis.push("linked_runtime_entrypoint");
    rank = Math.max(rank, RANK.elevated);
  }
  if (inputs.linkedPortfolioDependencyDecisionIds?.has(decision.id)) {
    basis.push("linked_portfolio_dependency");
    rank = Math.max(rank, RANK.elevated);
  }
  if (inputs.linkedCriticalCapabilityDecisionIds?.has(decision.id)) {
    basis.push("linked_critical_capability");
    rank = Math.max(rank, RANK.elevated);
  }

  let criticality: DecisionCriticality;
  if (rank >= 0) {
    criticality = rank === RANK.critical ? "critical" : rank === RANK.elevated ? "elevated" : "standard";
  } else if (inputs.signalsAvailable) {
    criticality = "standard";
    basis.push("no_signal_matched");
  } else {
    criticality = "unresolved";
    basis.push("no_signal_sources_available");
  }

  return { decision_id: decision.id, criticality, basis, evidence_refs: decision.evidence_refs };
}
