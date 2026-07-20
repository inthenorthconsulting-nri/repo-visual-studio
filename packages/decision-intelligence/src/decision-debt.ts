// The 14 debt categories from spec §30 -- no cost or effort estimation
// anywhere in this module (explicitly forbidden by spec §30). Every finding
// is stateless: `resolution_state` is always "open" at detection time,
// since tracking acknowledgement/resolution across runs requires persisted
// state this package does not own -- an external layer that stores debt
// findings over time is responsible for advancing that field, not this
// function.

import type {
  ArchitectureDecision,
  DecisionAssumption,
  DecisionConflict,
  DecisionCriticality,
  DecisionDebtCategory,
  DecisionDebtFinding,
  DecisionDependency,
  DecisionDrift,
  DecisionDriftSeverity,
  DecisionGovernanceStatus,
  DecisionImplementationState,
  DecisionLink,
  DecisionSourceIssue,
  DecisionSupersessionIssue,
  EvidenceRef,
  MissingDecisionFinding,
} from "./contracts.js";
import { buildDebtFindingId } from "./ids.js";

const ACTIVE_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["accepted", "implemented", "partially_implemented"]);
const STALE_PROPOSAL_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["proposed", "draft", "under_review"]);
const DEFAULT_STALE_PROPOSED_THRESHOLD_DAYS = 90;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DecisionDebtInputs {
  decisions: ArchitectureDecision[];
  implementationStates: DecisionImplementationState[];
  drift: DecisionDrift[];
  conflicts: DecisionConflict[];
  supersessionIssues: DecisionSupersessionIssue[];
  missingDecisionFindings: MissingDecisionFinding[];
  assumptions: DecisionAssumption[];
  sourceIssues: DecisionSourceIssue[];
  links: DecisionLink[];
  dependencies: DecisionDependency[];
  governanceStatusByDecisionId: Map<string, DecisionGovernanceStatus | undefined>;
  criticalityByDecisionId: Map<string, DecisionCriticality>;
  policyExceptionExpiredDecisionIds?: Set<string>;
  blastRadiusIdByDecisionId?: Map<string, string>;
  now: string;
  staleProposedThresholdDays?: number;
}

export function detectDecisionDebt(inputs: DecisionDebtInputs): DecisionDebtFinding[] {
  const findings: DecisionDebtFinding[] = [];
  const implementationById = new Map(inputs.implementationStates.map((s) => [s.decision_id, s]));

  for (const decision of inputs.decisions) {
    const implementation = implementationById.get(decision.id);
    if (decision.decision_status === "accepted" && implementation?.status === "not_started") {
      add(findings, inputs, decision.id, "accepted_without_implementation", isCritical(inputs, decision.id) ? "blocking" : "review_required", true, `${decision.id} is accepted with no implementation evidence found.`, decision.evidence_refs);
    }
  }

  for (const entry of inputs.drift) {
    if (entry.cause !== "implementation_regressed") continue;
    add(findings, inputs, entry.decision_id, "implementation_regressed_from_decision", entry.severity, true, entry.detail, entry.evidence_refs);
  }

  for (const decision of inputs.decisions) {
    if (!STALE_PROPOSAL_STATUSES.has(decision.decision_status) || !decision.date) continue;
    const ageMillis = new Date(inputs.now).getTime() - new Date(decision.date).getTime();
    if (!Number.isFinite(ageMillis) || ageMillis <= 0) continue;
    const thresholdDays = inputs.staleProposedThresholdDays ?? DEFAULT_STALE_PROPOSED_THRESHOLD_DAYS;
    if (ageMillis / MILLIS_PER_DAY < thresholdDays) continue;
    add(findings, inputs, decision.id, "stale_proposed_decision", "advisory", true, `${decision.id} has been "${decision.decision_status}" since ${decision.date}, exceeding the ${thresholdDays}-day staleness threshold.`, decision.evidence_refs);
  }

  for (const conflict of inputs.conflicts) {
    if (conflict.status !== "confirmed" && conflict.status !== "probable") continue;
    const severity: DecisionDriftSeverity = conflict.status === "confirmed" ? (isCritical(inputs, conflict.decision_ids[0]) ? "blocking" : "review_required") : "advisory";
    for (const decisionId of conflict.decision_ids) {
      add(findings, inputs, decisionId, "unresolved_conflict", severity, true, conflict.detail, conflict.evidence_refs);
    }
  }

  for (const issue of inputs.supersessionIssues) {
    const severity: DecisionDriftSeverity = issue.decision_ids.some((id) => isCritical(inputs, id)) ? "blocking" : "review_required";
    for (const decisionId of issue.decision_ids) {
      add(findings, inputs, decisionId, "broken_supersession_chain", severity, true, issue.detail, issue.evidence_refs);
    }
  }

  for (const finding of inputs.missingDecisionFindings) {
    add(findings, inputs, finding.affected_entity_id, "missing_required_decision", "review_required", true, finding.detail, finding.evidence_refs);
  }

  const contradictedByDecision = new Map<string, DecisionAssumption[]>();
  for (const assumption of inputs.assumptions) {
    if (assumption.state !== "contradicted") continue;
    const list = contradictedByDecision.get(assumption.decision_id) ?? [];
    list.push(assumption);
    contradictedByDecision.set(assumption.decision_id, list);
  }
  for (const [decisionId, assumptions] of contradictedByDecision) {
    add(
      findings,
      inputs,
      decisionId,
      "contradicted_assumption_unaddressed",
      isCritical(inputs, decisionId) ? "blocking" : "review_required",
      true,
      `${decisionId} has ${assumptions.length} contradicted assumption(s) unaddressed.`,
      assumptions.flatMap((a) => a.evidence_refs),
    );
  }

  if (inputs.policyExceptionExpiredDecisionIds) {
    for (const decisionId of inputs.policyExceptionExpiredDecisionIds) {
      add(findings, inputs, decisionId, "expired_policy_exception", isCritical(inputs, decisionId) ? "blocking" : "review_required", true, `${decisionId} backs a governance policy exception that has expired.`, decisionById(inputs, decisionId)?.evidence_refs ?? []);
    }
  }

  for (const [decisionId, status] of inputs.governanceStatusByDecisionId) {
    if (status !== "unverifiable") continue;
    const criticality = inputs.criticalityByDecisionId.get(decisionId);
    const requiresReview = criticality === "critical" || criticality === "elevated";
    add(findings, inputs, decisionId, "unverifiable_governance_status", "advisory", requiresReview, `${decisionId}'s governance status is unverifiable.`, decisionById(inputs, decisionId)?.evidence_refs ?? []);
  }

  for (const decision of inputs.decisions) {
    if (!ACTIVE_STATUSES.has(decision.decision_status)) continue;
    const hasLinks = inputs.links.some((l) => l.decision_id === decision.id && (l.resolution === "resolved" || l.resolution === "partially_resolved"));
    const hasDependencies = inputs.dependencies.some((d) => d.from_decision_id === decision.id || d.to_decision_id === decision.id);
    if (hasLinks || hasDependencies) continue;
    const critical = isCritical(inputs, decision.id);
    add(findings, inputs, decision.id, "orphaned_decision", critical ? "review_required" : "advisory", critical, `${decision.id} is ${decision.decision_status} with no resolved links or dependencies to any other artifact.`, decision.evidence_refs);
  }

  for (const issue of inputs.sourceIssues) {
    const category: DecisionDebtCategory | undefined =
      issue.kind === "unparseable_structure"
        ? "unparseable_decision_document"
        : issue.kind === "duplicate_id_exact" || issue.kind === "duplicate_id_case_only" || issue.kind === "multiple_files_claim_one_id" || issue.kind === "id_reused_with_changed_content"
          ? "duplicate_decision_identity"
          : undefined;
    if (!category) continue;
    for (const path of issue.affected_paths) {
      const decision = inputs.decisions.find((d) => d.source.repo_relative_path === path);
      if (!decision) continue;
      add(findings, inputs, decision.id, category, "review_required", true, issue.detail, issue.evidence_refs);
    }
  }

  for (const entry of inputs.drift) {
    if (entry.cause !== "upstream_artifact_incompatible") continue;
    add(findings, inputs, entry.decision_id, "incompatible_upstream_linkage", "informational", false, entry.detail, entry.evidence_refs);
  }

  for (const entry of inputs.drift) {
    if (entry.cause !== "criticality_upgraded_without_review") continue;
    add(findings, inputs, entry.decision_id, "criticality_unreviewed", entry.severity, true, entry.detail, entry.evidence_refs);
  }

  return dedupe(findings).sort((a, b) => a.id.localeCompare(b.id));
}

function isCritical(inputs: DecisionDebtInputs, decisionId: string): boolean {
  return inputs.criticalityByDecisionId.get(decisionId) === "critical";
}

function decisionById(inputs: DecisionDebtInputs, decisionId: string): ArchitectureDecision | undefined {
  return inputs.decisions.find((d) => d.id === decisionId);
}

function add(
  findings: DecisionDebtFinding[],
  inputs: DecisionDebtInputs,
  decisionId: string,
  category: DecisionDebtCategory,
  severity: DecisionDriftSeverity,
  requiresHumanReview: boolean,
  detail: string,
  evidenceRefs: EvidenceRef[],
): void {
  findings.push({
    id: buildDebtFindingId(category, decisionId),
    category,
    decision_id: decisionId,
    severity,
    blast_radius_id: inputs.blastRadiusIdByDecisionId?.get(decisionId),
    resolution_state: "open",
    requires_human_review: requiresHumanReview,
    detail,
    evidence_refs: evidenceRefs,
  });
}

function dedupe(findings: DecisionDebtFinding[]): DecisionDebtFinding[] {
  const byId = new Map<string, DecisionDebtFinding>();
  for (const finding of findings) byId.set(finding.id, finding);
  return [...byId.values()];
}
