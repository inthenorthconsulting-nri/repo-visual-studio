import type { BlastRadiusEntry, ContinuousIntelligenceReport, EvidenceRef, GovernanceChangeEntry, GovernanceClaim, GovernanceClaimRejectionReason, GovernanceClaimStatus, GovernanceClaimType, GovernanceFinding } from "./contracts.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { buildClaimId } from "./ids.js";

// ---------------------------------------------------------------------------
// §26 Governance claim control
//
// Mirrors @rvs/portfolio-intelligence/src/claims.ts's draft -> classify
// pipeline shape exactly: every claim starts as a draft, is classified
// against the ContinuousIntelligenceReport content it actually cites (never
// against what would be convenient to say), and only approved/qualified
// claims ever reach the narrative layer's `approvedClaims` (§26: "qualified"
// counts as approved-with-caveats -- see GovernanceClaimStatus's own doc
// comment in contracts.ts). Rejected claims are kept, not discarded, so the
// final narrative can show what was said and what was withheld.
//
// Unlike portfolio's ClaimDraft (whose classifyDraft reads pre-computed
// boolean flags the draft-builder already derived), a GovernanceClaimDraft
// carries only the MINIMAL scoping a caller can state declaratively --
// which report fields to check support against -- and classifyGovernanceClaim
// itself performs every support check against the supplied
// ContinuousIntelligenceReport. This follows the brief's explicit
// instruction that `context` "carries whatever the classifier needs to check
// support: the ContinuousIntelligenceReport fields relevant to the claim".
// ---------------------------------------------------------------------------

/**
 * The five positive/safe/complete outcome shapes §26 requires be
 * independently checked against real report support before a claim
 * asserting one of them can be approved. Absent on a draft that does not
 * assert any such outcome (e.g. a purely descriptive claim never needs this
 * check at all).
 */
export type GovernanceAssertedOutcome = "safety" | "no_impact" | "improvement" | "risk_reduction" | "completeness";

export interface GovernanceClaimDraft {
  subjectId: string;
  claimType: GovernanceClaimType;
  text: string;
  evidenceRefs: EvidenceRef[];
  /** See GovernanceAssertedOutcome. */
  assertedOutcome?: GovernanceAssertedOutcome;
  /**
   * GovernanceChangeEntry.id values (NOT entity_id) this claim's lineage and
   * blast-radius support should be checked against, when the claim is about
   * specific changes rather than the whole report. Absent means
   * "whole-report scope" for claim types that have a well-defined
   * whole-report lineage/blast-radius check (lineage_integrity /
   * blast_radius_bound); absent + any other claim type means "this claim
   * makes no lineage/blast-radius assertion at all".
   */
  subjectChangeIds?: string[];
  /** Set for policy_compliance claims to scope the policy_result_mismatch check to one policy's evaluation. Absent means "every evaluated policy in this report". */
  policyId?: string;
  /** Caller-supplied caveat text the drafter has already verified is backed by real report content -- attached as a qualifier ONLY when the claim is otherwise approved, exactly like portfolio's ClaimDraft.qualifierText. Never invented by the classifier itself. */
  qualifierText?: string;
}

export interface GovernanceClaimContext {
  report: ContinuousIntelligenceReport;
}

// ---------------------------------------------------------------------------
// Shared lookups over ContinuousIntelligenceReport
// ---------------------------------------------------------------------------

function allChangeEntries(report: ContinuousIntelligenceReport): GovernanceChangeEntry[] {
  return [...report.architecture_changes.changes, ...report.capability_changes.changes, ...report.product_changes.changes, ...(report.portfolio_changes?.changes ?? [])];
}

function findChangeEntry(report: ContinuousIntelligenceReport, changeId: string): GovernanceChangeEntry | undefined {
  return allChangeEntries(report).find((entry) => entry.id === changeId);
}

function resolveLineageScope(draft: GovernanceClaimDraft, report: ContinuousIntelligenceReport): GovernanceChangeEntry[] {
  if (draft.subjectChangeIds && draft.subjectChangeIds.length > 0) {
    return draft.subjectChangeIds.map((id) => findChangeEntry(report, id)).filter((entry): entry is GovernanceChangeEntry => entry !== undefined);
  }
  if (draft.claimType === "lineage_integrity") {
    return allChangeEntries(report).filter((entry) => entry.type !== "unchanged");
  }
  return [];
}

function resolveBlastRadiusScope(draft: GovernanceClaimDraft, report: ContinuousIntelligenceReport): BlastRadiusEntry[] {
  if (draft.subjectChangeIds && draft.subjectChangeIds.length > 0) {
    return report.blast_radius.entries.filter((entry) => draft.subjectChangeIds!.includes(entry.change_id));
  }
  if (draft.claimType === "blast_radius_bound") {
    return report.blast_radius.entries;
  }
  return [];
}

function resolveQualifierFindings(draft: GovernanceClaimDraft, report: ContinuousIntelligenceReport): GovernanceFinding[] {
  if (draft.claimType === "policy_compliance") {
    const evaluations = draft.policyId ? report.evaluations.filter((evaluation) => evaluation.policy_id === draft.policyId) : report.evaluations;
    return evaluations.flatMap((evaluation) => evaluation.findings);
  }
  if (draft.subjectChangeIds && draft.subjectChangeIds.length > 0) {
    return report.findings.filter((finding) => finding.change_id !== undefined && draft.subjectChangeIds!.includes(finding.change_id));
  }
  return report.findings;
}

// ---------------------------------------------------------------------------
// Rejection checks -- ordered exactly as evaluated: compatibility gates
// first (mirrors policy-evaluator.ts's "compatibility gate FIRST" pattern),
// then lineage, then blast radius, then policy-result agreement, then the
// claim's own asserted-outcome-specific support check.
// ---------------------------------------------------------------------------

function checkAssertedOutcome(draft: GovernanceClaimDraft, report: ContinuousIntelligenceReport): GovernanceClaimRejectionReason | undefined {
  switch (draft.assertedOutcome) {
    case "no_impact": {
      const regressed = report.findings.some((finding) => finding.result === "fail" && (finding.severity === "blocking" || finding.severity === "review_required"));
      return regressed ? "unsupported_no_impact_claim" : undefined;
    }
    case "safety": {
      const unsafe = report.findings.some((finding) => finding.result === "fail" && finding.severity === "blocking");
      return unsafe ? "unsupported_safety_claim" : undefined;
    }
    case "improvement": {
      // Judgment call: "improvement" is checked against classification.evidence_impact
      // (the change's own classified evidence-impact signal) rather than the
      // entry's top-level `lineage` field, which the lineage_integrity/
      // missing_lineage check already owns -- these are two distinct
      // contracts.ts fields (GovernanceChangeEntry.lineage vs
      // GovernanceChangeEntry.classification.evidence_impact) and this keeps
      // each rejection reason backed by its own distinct signal.
      const strengthened = allChangeEntries(report).some((entry) => entry.classification.evidence_impact === "strengthened");
      return strengthened ? undefined : "unsupported_improvement_claim";
    }
    case "risk_reduction": {
      const risky = report.findings.some((finding) => finding.result === "fail" && (finding.severity === "blocking" || finding.severity === "review_required")) || report.blast_radius.entries.some((entry) => entry.level === "unresolved");
      return risky ? "unsupported_risk_reduction" : undefined;
    }
    case "completeness": {
      const incomplete = report.evidence_changes.changes.some((change) => change.type === "unresolved");
      return incomplete ? "unsupported_completeness_claim" : undefined;
    }
    default:
      return undefined;
  }
}

function computeQualifiers(draft: GovernanceClaimDraft, report: ContinuousIntelligenceReport): string[] {
  const findings = resolveQualifierFindings(draft, report);
  const qualifiers: string[] = [];

  const unverifiable = findings.filter((finding) => finding.result === "unverifiable");
  if (unverifiable.length > 0) {
    qualifiers.push(`${unverifiable.length} related finding(s) have result "unverifiable" and could not be conclusively resolved.`);
  }

  const excepted = findings.filter((finding) => finding.excepted);
  if (excepted.length > 0) {
    qualifiers.push(`${excepted.length} related finding(s) were only permitted via an explicit governance exception.`);
  }

  if (draft.qualifierText) qualifiers.push(draft.qualifierText);

  return qualifiers;
}

function buildClaim(draft: GovernanceClaimDraft, status: GovernanceClaimStatus, rejectionReason: GovernanceClaimRejectionReason | undefined, qualifiers: string[]): GovernanceClaim {
  return {
    id: buildClaimId(draft.claimType, draft.subjectId),
    text: draft.text,
    claim_type: draft.claimType,
    status,
    rejection_reason: rejectionReason,
    qualifiers,
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(draft.evidenceRefs)),
  };
}

/**
 * Classifies one GovernanceClaimDraft against the ContinuousIntelligenceReport
 * it is about. Never mutates `context.report`; never invents support --
 * every rejection reason and every qualifier text is a direct function of
 * real report content (findings, blast_radius entries, change-entry
 * lineage/classification, evidence_changes, compatibility).
 */
export function classifyGovernanceClaim(draft: GovernanceClaimDraft, context: GovernanceClaimContext): GovernanceClaim {
  const { report } = context;

  if (report.compatibility === "incompatible") {
    return buildClaim(draft, "rejected", "incompatible_snapshot", []);
  }
  if (report.compatibility === "partial") {
    return buildClaim(draft, "rejected", "partial_snapshot", []);
  }

  const lineageScope = resolveLineageScope(draft, report);
  if (lineageScope.some((entry) => entry.lineage === "weakened" || entry.lineage === "broken" || entry.lineage === "unverifiable")) {
    return buildClaim(draft, "rejected", "missing_lineage", []);
  }

  const blastScope = resolveBlastRadiusScope(draft, report);
  if (blastScope.some((entry) => entry.level === "unresolved")) {
    return buildClaim(draft, "rejected", "unresolved_blast_radius", []);
  }

  if (draft.claimType === "policy_compliance") {
    const evaluations = draft.policyId ? report.evaluations.filter((evaluation) => evaluation.policy_id === draft.policyId) : report.evaluations;
    if (evaluations.some((evaluation) => evaluation.findings.some((finding) => finding.result === "fail"))) {
      return buildClaim(draft, "rejected", "policy_result_mismatch", []);
    }
  }

  if (draft.assertedOutcome) {
    const reason = checkAssertedOutcome(draft, report);
    if (reason) return buildClaim(draft, "rejected", reason, []);
  }

  const qualifiers = computeQualifiers(draft, report);
  if (qualifiers.length > 0) return buildClaim(draft, "qualified", undefined, qualifiers);
  return buildClaim(draft, "approved", undefined, []);
}

// ---------------------------------------------------------------------------
// Standard claim set -- deterministic, exactly the 5 GovernanceClaimType
// kinds, one draft each. This is the claim set narrative.ts classifies to
// populate GovernanceNarrative.approvedClaims/rejectedClaims; it never
// invents claims beyond these 5.
// ---------------------------------------------------------------------------

export function draftStandardGovernanceClaims(report: ContinuousIntelligenceReport): GovernanceClaimDraft[] {
  const firstPolicyId = report.evaluations[0]?.policy_id;

  return [
    {
      subjectId: report.id,
      claimType: "no_regression",
      text: `No blocking or review-required regression was identified between snapshot "${report.source_snapshot_id}" and "${report.target_snapshot_id}".`,
      evidenceRefs: report.evidence_refs,
      assertedOutcome: "no_impact",
    },
    {
      subjectId: firstPolicyId ?? report.id,
      claimType: "policy_compliance",
      text: firstPolicyId ? `This comparison complies with every evaluated governance policy, including "${firstPolicyId}".` : `No governance policy was evaluated for this comparison.`,
      evidenceRefs: report.evaluations.flatMap((evaluation) => evaluation.evidence_refs),
    },
    {
      subjectId: report.id,
      claimType: "lineage_integrity",
      text: `Evidence lineage was preserved or strengthened for every changed entity between the two snapshots.`,
      evidenceRefs: report.evidence_refs,
    },
    {
      subjectId: report.id,
      claimType: "blast_radius_bound",
      text: `The blast radius of every change in this comparison was resolved to a known level.`,
      evidenceRefs: report.blast_radius.evidence_refs,
    },
    {
      subjectId: report.id,
      claimType: "evidence_strength",
      text: `Evidence coverage for this comparison is complete, with no unresolved evidence changes.`,
      evidenceRefs: report.evidence_changes.evidence_refs,
      assertedOutcome: "completeness",
    },
  ];
}
