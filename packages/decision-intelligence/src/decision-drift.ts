// Drift severity always derives from an explicit policy/criticality/
// evidence-state signal already present in the inputs -- a decision is
// never marked "blocking" purely because it looks stale or old (spec §28).
// Several of the 13 named causes are inherently comparisons against a
// prior snapshot (implementation_regressed, governance_status_downgraded,
// conflict_introduced, criticality_upgraded_without_review): they only
// fire when the caller supplies `previous`, never inferred from a single
// snapshot. `coverage_regressed` is intentionally never emitted here --
// the same underlying event (a link flipping from resolved to unresolved)
// is already reported once as `linked_entity_removed`; reporting it again
// under a second cause would double-count the same fact. The coverage
// regression itself remains visible directly via coverage.ts's own
// numerator/denominator pair compared across snapshots by the caller.
// `linked_entity_materially_changed` and `upstream_artifact_incompatible`
// fire only when the caller supplies the relevant change/compatibility
// signal -- this package does not itself diff upstream entity content.

import type {
  ArchitectureDecision,
  DecisionAssumption,
  DecisionConflict,
  DecisionCriticality,
  DecisionDrift,
  DecisionDriftSeverity,
  DecisionGovernanceStatus,
  DecisionImplementationStatus,
  DecisionLink,
  DecisionSourceIssue,
  DecisionSupersessionIssue,
  EvidenceRef,
} from "./contracts.js";
import { buildDriftId } from "./ids.js";

const ACTIVE_STATUSES = new Set<ArchitectureDecision["decision_status"]>(["accepted", "implemented", "partially_implemented"]);
const CRITICALITY_RANK: Record<DecisionCriticality, number> = { standard: 0, elevated: 1, critical: 2, unresolved: -1 };
const GOVERNANCE_RANK: Record<DecisionGovernanceStatus, number> = { aligned: 0, review_required: 1, unverifiable: 1, conflicting: 2 };

export interface DecisionDriftPreviousState {
  linkResolutionById: Map<string, DecisionLink["resolution"]>;
  implementationStatusByDecisionId: Map<string, DecisionImplementationStatus>;
  governanceStatusByDecisionId: Map<string, DecisionGovernanceStatus | undefined>;
  conflictIds: Set<string>;
  criticalityByDecisionId: Map<string, DecisionCriticality>;
}

export interface DecisionDriftInputs {
  decisions: ArchitectureDecision[];
  assumptions: DecisionAssumption[];
  links: DecisionLink[];
  conflicts: DecisionConflict[];
  supersessionIssues: DecisionSupersessionIssue[];
  sourceIssues: DecisionSourceIssue[];
  criticalityByDecisionId: Map<string, DecisionCriticality>;
  implementationStatusByDecisionId: Map<string, DecisionImplementationStatus>;
  governanceStatusByDecisionId: Map<string, DecisionGovernanceStatus | undefined>;
  materiallyChangedEntityIds?: Set<string>;
  incompatibleUpstreamDomains?: Set<DecisionLink["target_domain"]>;
  policyExceptionExpiredDecisionIds?: Set<string>;
  previous?: DecisionDriftPreviousState;
}

export function detectDecisionDrift(inputs: DecisionDriftInputs): DecisionDrift[] {
  const drift: DecisionDrift[] = [];
  const decisionsById = new Map(inputs.decisions.map((d) => [d.id, d]));

  for (const link of inputs.links) {
    if (link.resolution !== "unresolved") continue;
    const previousResolution = inputs.previous?.linkResolutionById.get(link.id);
    if (previousResolution === "resolved" || previousResolution === "partially_resolved") {
      push(drift, link.decision_id, "linked_entity_removed", severityFor(inputs, link.decision_id, "hard"), `Link "${link.id}" was resolved in the previous snapshot but is unresolved now.`, link.evidence_refs);
    }
  }

  if (inputs.materiallyChangedEntityIds) {
    for (const link of inputs.links) {
      if (link.resolution !== "resolved" && link.resolution !== "partially_resolved") continue;
      if (!link.target_id || !inputs.materiallyChangedEntityIds.has(link.target_id)) continue;
      push(drift, link.decision_id, "linked_entity_materially_changed", severityFor(inputs, link.decision_id, "soft"), `Link "${link.id}" targets "${link.target_id}", which materially changed upstream.`, link.evidence_refs);
    }
  }

  for (const assumption of inputs.assumptions) {
    if (assumption.state !== "contradicted") continue;
    push(drift, assumption.decision_id, "assumption_contradicted", severityFor(inputs, assumption.decision_id, "hard"), `Assumption "${assumption.id}" is contradicted.`, assumption.evidence_refs);
  }

  if (inputs.previous) {
    for (const [decisionId, currentStatus] of inputs.implementationStatusByDecisionId) {
      const previousStatus = inputs.previous.implementationStatusByDecisionId.get(decisionId);
      const wasWorking = previousStatus === "implemented" || previousStatus === "partial";
      const nowBroken = currentStatus === "not_started" || currentStatus === "unverifiable";
      if (wasWorking && nowBroken) {
        push(
          drift,
          decisionId,
          "implementation_regressed",
          severityFor(inputs, decisionId, "hard"),
          `Implementation status regressed from "${previousStatus}" to "${currentStatus}".`,
          decisionsById.get(decisionId)?.evidence_refs ?? [],
        );
      }
    }

    for (const [decisionId, currentStatus] of inputs.governanceStatusByDecisionId) {
      const previousStatus = inputs.previous.governanceStatusByDecisionId.get(decisionId);
      if (!currentStatus || !previousStatus) continue;
      if (GOVERNANCE_RANK[currentStatus] > GOVERNANCE_RANK[previousStatus]) {
        push(
          drift,
          decisionId,
          "governance_status_downgraded",
          currentStatus === "conflicting" ? severityFor(inputs, decisionId, "hard") : "advisory",
          `Governance status downgraded from "${previousStatus}" to "${currentStatus}".`,
          decisionsById.get(decisionId)?.evidence_refs ?? [],
        );
      }
    }

    for (const conflict of inputs.conflicts) {
      if (inputs.previous.conflictIds.has(conflict.id)) continue;
      const severity = conflict.status === "confirmed" ? severityFor(inputs, conflict.decision_ids[0], "hard") : "advisory";
      for (const decisionId of conflict.decision_ids) {
        push(drift, decisionId, "conflict_introduced", severity, `New conflict "${conflict.id}" (${conflict.kind}, ${conflict.status}) introduced since the previous snapshot.`, conflict.evidence_refs);
      }
    }

    for (const [decisionId, currentCriticality] of inputs.criticalityByDecisionId) {
      const previousCriticality = inputs.previous.criticalityByDecisionId.get(decisionId);
      if (!previousCriticality || CRITICALITY_RANK[previousCriticality] < 0 || CRITICALITY_RANK[currentCriticality] < 0) continue;
      if (CRITICALITY_RANK[currentCriticality] > CRITICALITY_RANK[previousCriticality]) {
        push(
          drift,
          decisionId,
          "criticality_upgraded_without_review",
          currentCriticality === "critical" ? "blocking" : "review_required",
          `Criticality upgraded from "${previousCriticality}" to "${currentCriticality}" since the previous snapshot.`,
          decisionsById.get(decisionId)?.evidence_refs ?? [],
        );
      }
    }
  }

  if (inputs.incompatibleUpstreamDomains) {
    for (const link of inputs.links) {
      if (!inputs.incompatibleUpstreamDomains.has(link.target_domain)) continue;
      push(drift, link.decision_id, "upstream_artifact_incompatible", "informational", `Link "${link.id}" targets the "${link.target_domain}" domain, whose upstream artifact is only partially/unavailable.`, link.evidence_refs);
    }
  }

  for (const issue of inputs.supersessionIssues) {
    if (issue.kind !== "missing_target") continue;
    const decisionId = issue.decision_ids[0];
    if (!decisionId) continue;
    push(drift, decisionId, "supersession_target_removed", severityFor(inputs, decisionId, "hard"), issue.detail, issue.evidence_refs);
  }

  for (const decision of inputs.decisions) {
    if (!ACTIVE_STATUSES.has(decision.decision_status)) continue;
    if (decision.evidence_refs.length === 0) {
      push(drift, decision.id, "evidence_lineage_broken", "advisory", `${decision.id} is ${decision.decision_status} but carries no evidence references.`, []);
    }
  }

  for (const issue of inputs.sourceIssues) {
    if (issue.kind !== "unparseable_structure") continue;
    for (const path of issue.affected_paths) {
      const decision = inputs.decisions.find((d) => d.source.repo_relative_path === path);
      if (!decision) continue;
      push(drift, decision.id, "decision_document_unparseable", "review_required", issue.detail, issue.evidence_refs);
    }
  }

  if (inputs.policyExceptionExpiredDecisionIds) {
    for (const decisionId of inputs.policyExceptionExpiredDecisionIds) {
      push(
        drift,
        decisionId,
        "policy_exception_expired",
        severityFor(inputs, decisionId, "hard"),
        `${decisionId} backs a governance policy exception that has expired.`,
        decisionsById.get(decisionId)?.evidence_refs ?? [],
      );
    }
  }

  return dedupe(drift).sort((a, b) => a.id.localeCompare(b.id));
}

function severityFor(inputs: DecisionDriftInputs, decisionId: string, weight: "hard" | "soft"): DecisionDriftSeverity {
  const criticality = inputs.criticalityByDecisionId.get(decisionId);
  if (weight === "hard" && criticality === "critical") return "blocking";
  if (weight === "hard") return "review_required";
  if (criticality === "critical" || criticality === "elevated") return "review_required";
  return "advisory";
}

function push(drift: DecisionDrift[], decisionId: string, cause: DecisionDrift["cause"], severity: DecisionDriftSeverity, detail: string, evidenceRefs: EvidenceRef[]): void {
  drift.push({ id: buildDriftId(decisionId, cause), decision_id: decisionId, cause, severity, detail, evidence_refs: evidenceRefs });
}

function dedupe(drift: DecisionDrift[]): DecisionDrift[] {
  const byId = new Map<string, DecisionDrift>();
  for (const d of drift) byId.set(d.id, d);
  return [...byId.values()];
}
