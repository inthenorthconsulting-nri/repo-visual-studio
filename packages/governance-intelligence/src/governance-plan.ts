import type { ContinuousIntelligenceReport, GovernanceChangeEntry, GovernanceNarrative, GovernancePlan, GovernanceSceneContent, GovernanceSceneKind } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { summarizeFindings } from "./findings.js";
import { buildPlanId } from "./ids.js";

// ---------------------------------------------------------------------------
// buildGovernancePlan -- one builder function per GovernanceSceneKind (13
// total), each returning a fully-populated GovernanceSceneContent or
// `undefined` when the evidence that scene would present simply isn't there
// (evidence-gated absence: never emit an empty presentational scene). Mirrors
// portfolio-intelligence/src/portfolio-plan.ts's "full content per scene"
// pattern (NOT narrative-planner's pointer-only VisualDoc adapter, which is a
// different, thinner pattern for a different rendering layer).
//
// scene_id is a small local sanitize-and-colon-join helper duplicated from
// ids.ts's own convention, rather than widening ids.ts's public surface for
// one call site -- this mirrors diff-utils.ts's own precedent of keeping
// small private helpers local to the file that needs them.
// ---------------------------------------------------------------------------

const SCENE_ID_UNSAFE = /[^a-zA-Z0-9_.-]/g;
function sanitize(part: string): string {
  return part.replace(SCENE_ID_UNSAFE, "-");
}
function buildSceneId(reportId: string, kind: GovernanceSceneKind): string {
  return `governance:scene:${sanitize(reportId)}:${sanitize(kind)}`;
}

/** Canonical GovernanceSceneKind order, exactly as declared in contracts.ts. */
const SCENE_KIND_ORDER: GovernanceSceneKind[] = [
  "governance-hero",
  "snapshot-comparison",
  "change-summary",
  "architecture-change-map",
  "capability-regression",
  "product-change",
  "portfolio-change",
  "evidence-regression",
  "blast-radius",
  "policy-findings",
  "exceptions",
  "decision-required",
  "governance-validation",
];
const SCENE_KIND_RANK: Record<GovernanceSceneKind, number> = Object.fromEntries(SCENE_KIND_ORDER.map((kind, index) => [kind, index])) as Record<GovernanceSceneKind, number>;

function allChangeEntries(report: ContinuousIntelligenceReport): GovernanceChangeEntry[] {
  return [...report.architecture_changes.changes, ...report.capability_changes.changes, ...report.product_changes.changes, ...(report.portfolio_changes?.changes ?? [])];
}

function changeCounts(changes: GovernanceChangeEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Per-kind scene builders
// ---------------------------------------------------------------------------

export function buildGovernanceHeroScene(report: ContinuousIntelligenceReport, narrative: GovernanceNarrative): GovernanceSceneContent {
  return {
    scene_id: buildSceneId(report.id, "governance-hero"),
    kind: "governance-hero",
    title: `Governance comparison: ${report.source_snapshot_id} -> ${report.target_snapshot_id}`,
    data: {
      summary: narrative.summary,
      compatibility: report.compatibility,
      findings_total: report.findings.length,
    },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(report.evidence_refs)),
  };
}

export function buildSnapshotComparisonScene(report: ContinuousIntelligenceReport): GovernanceSceneContent {
  return {
    scene_id: buildSceneId(report.id, "snapshot-comparison"),
    kind: "snapshot-comparison",
    title: "Snapshot comparison",
    data: {
      source_snapshot_id: report.source_snapshot_id,
      target_snapshot_id: report.target_snapshot_id,
      compatibility: report.compatibility,
      repository_id: report.repository_id,
    },
    evidence_refs: [],
  };
}

export function buildChangeSummaryScene(report: ContinuousIntelligenceReport): GovernanceSceneContent {
  const domains: { label: string; changes: GovernanceChangeEntry[] }[] = [
    { label: "architecture", changes: report.architecture_changes.changes },
    { label: "capability", changes: report.capability_changes.changes },
    { label: "product", changes: report.product_changes.changes },
  ];
  if (report.portfolio_changes) domains.push({ label: "portfolio", changes: report.portfolio_changes.changes });

  const byDomain: Record<string, number> = {};
  for (const domain of domains) byDomain[domain.label] = domain.changes.filter((change) => change.type !== "unchanged").length;

  return {
    scene_id: buildSceneId(report.id, "change-summary"),
    kind: "change-summary",
    title: "Change summary",
    data: { by_domain: byDomain, total: Object.values(byDomain).reduce((a, b) => a + b, 0) },
    evidence_refs: [],
  };
}

export function buildArchitectureChangeMapScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const changed = report.architecture_changes.changes.filter((change) => change.type !== "unchanged");
  if (changed.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "architecture-change-map"),
    kind: "architecture-change-map",
    title: "Architecture changes",
    data: { total: changed.length, by_type: changeCounts(changed), change_ids: [...changed.map((change) => change.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(changed.flatMap((change) => change.evidence_refs))),
  };
}

/**
 * Judgment call: gated on entries whose type is specifically "reclassified"
 * or "removed" (a genuine regression signal), not on "any capability
 * change", since the scene's own name ("capability-regression") promises
 * something narrower than the generic change-summary scene above.
 */
export function buildCapabilityRegressionScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const regressed = report.capability_changes.changes.filter((change) => change.type === "reclassified" || change.type === "removed");
  if (regressed.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "capability-regression"),
    kind: "capability-regression",
    title: "Capability regressions",
    data: { total: regressed.length, change_ids: [...regressed.map((change) => change.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(regressed.flatMap((change) => change.evidence_refs))),
  };
}

export function buildProductChangeScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const changed = report.product_changes.changes.filter((change) => change.type !== "unchanged");
  if (changed.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "product-change"),
    kind: "product-change",
    title: "Product changes",
    data: { total: changed.length, by_type: changeCounts(changed), change_ids: [...changed.map((change) => change.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(changed.flatMap((change) => change.evidence_refs))),
  };
}

/**
 * Judgment call: gated on `report.portfolio_changes` being both present AND
 * non-empty. The brief only calls out the "undefined" case explicitly, but
 * an empty (present-but-zero-change) portfolio changeset carries the same
 * "no evidence to show" character the rest of this file's evidence-gating
 * follows, so the stricter check is applied consistently.
 */
export function buildPortfolioChangeScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  if (!report.portfolio_changes) return undefined;
  const changed = report.portfolio_changes.changes.filter((change) => change.type !== "unchanged");
  if (changed.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "portfolio-change"),
    kind: "portfolio-change",
    title: "Portfolio changes",
    data: { total: changed.length, by_type: changeCounts(changed), change_ids: [...changed.map((change) => change.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(changed.flatMap((change) => change.evidence_refs))),
  };
}

export function buildEvidenceRegressionScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const regressed = report.evidence_changes.changes.filter((change) => change.type !== "added");
  if (regressed.length === 0) return undefined;
  const byType: Record<string, number> = {};
  for (const change of regressed) byType[change.type] = (byType[change.type] ?? 0) + 1;
  return {
    scene_id: buildSceneId(report.id, "evidence-regression"),
    kind: "evidence-regression",
    title: "Evidence regressions",
    data: { total: regressed.length, by_type: byType, change_ids: [...regressed.map((change) => change.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(regressed.map((change) => change.evidence_ref))),
  };
}

export function buildBlastRadiusScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  if (report.blast_radius.entries.length === 0) return undefined;
  const byLevel: Record<string, number> = {};
  for (const entry of report.blast_radius.entries) byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
  return {
    scene_id: buildSceneId(report.id, "blast-radius"),
    kind: "blast-radius",
    title: "Blast radius",
    data: { total: report.blast_radius.entries.length, by_level: byLevel },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(report.blast_radius.evidence_refs)),
  };
}

export function buildPolicyFindingsScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  if (report.findings.length === 0) return undefined;
  const summary = summarizeFindings(report.findings);
  return {
    scene_id: buildSceneId(report.id, "policy-findings"),
    kind: "policy-findings",
    title: "Policy findings",
    data: { total: summary.total, by_severity: summary.by_severity, by_result: summary.by_result },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(report.findings.flatMap((finding) => finding.evidence_refs))),
  };
}

export function buildExceptionsScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const excepted = report.findings.filter((finding) => finding.excepted);
  if (excepted.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "exceptions"),
    kind: "exceptions",
    title: "Active governance exceptions",
    data: { total: excepted.length, finding_ids: [...excepted.map((finding) => finding.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(excepted.flatMap((finding) => finding.evidence_refs))),
  };
}

/**
 * Judgment call: excludes findings that were already excepted -- an excepted
 * finding no longer needs a human decision, it already received one.
 */
export function buildDecisionRequiredScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const needsDecision = report.findings.filter((finding) => finding.human_review_required && finding.result !== "excepted");
  if (needsDecision.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "decision-required"),
    kind: "decision-required",
    title: "Decisions required",
    data: { total: needsDecision.length, finding_ids: [...needsDecision.map((finding) => finding.id)].sort() },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(needsDecision.flatMap((finding) => finding.evidence_refs))),
  };
}

/**
 * Judgment call: this scene surfaces data-completeness/verifiability
 * concerns about the underlying report itself (not a re-run of
 * validateGovernancePlan against the plan being built here -- that would be
 * circular, since the plan doesn't exist yet while its own scenes are being
 * assembled). Gated on there being an actual concern to show: overall
 * compatibility isn't fully "compatible", or at least one finding's result
 * is "unverifiable".
 */
export function buildGovernanceValidationScene(report: ContinuousIntelligenceReport): GovernanceSceneContent | undefined {
  const unverifiable = report.findings.filter((finding) => finding.result === "unverifiable");
  if (report.compatibility === "compatible" && unverifiable.length === 0) return undefined;
  return {
    scene_id: buildSceneId(report.id, "governance-validation"),
    kind: "governance-validation",
    title: "Data completeness and verifiability",
    data: {
      compatibility: report.compatibility,
      unverifiable_finding_count: unverifiable.length,
      unverifiable_finding_ids: [...unverifiable.map((finding) => finding.id)].sort(),
    },
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(unverifiable.length > 0 ? unverifiable.flatMap((finding) => finding.evidence_refs) : report.evidence_refs)),
  };
}

// ---------------------------------------------------------------------------
// buildGovernancePlan
// ---------------------------------------------------------------------------

export interface BuildGovernancePlanInput {
  report: ContinuousIntelligenceReport;
  narrative: GovernanceNarrative;
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  generatedAt: string;
}

export function buildGovernancePlan(input: BuildGovernancePlanInput): GovernancePlan {
  const { report, narrative, generatedAt } = input;

  const candidates: (GovernanceSceneContent | undefined)[] = [
    buildGovernanceHeroScene(report, narrative),
    buildSnapshotComparisonScene(report),
    buildChangeSummaryScene(report),
    buildArchitectureChangeMapScene(report),
    buildCapabilityRegressionScene(report),
    buildProductChangeScene(report),
    buildPortfolioChangeScene(report),
    buildEvidenceRegressionScene(report),
    buildBlastRadiusScene(report),
    buildPolicyFindingsScene(report),
    buildExceptionsScene(report),
    buildDecisionRequiredScene(report),
    buildGovernanceValidationScene(report),
  ];

  const scenes = candidates
    .filter((scene): scene is GovernanceSceneContent => scene !== undefined)
    .sort((a, b) => {
      if (SCENE_KIND_RANK[a.kind] !== SCENE_KIND_RANK[b.kind]) return SCENE_KIND_RANK[a.kind] - SCENE_KIND_RANK[b.kind];
      return a.scene_id < b.scene_id ? -1 : a.scene_id > b.scene_id ? 1 : 0;
    });

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs([...report.evidence_refs, ...narrative.evidence_refs, ...scenes.flatMap((scene) => scene.evidence_refs)]));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildPlanId(report.id),
    report,
    narrative,
    scenes,
    evidence_refs: evidenceRefs,
    generation: { generated_at: generatedAt },
  };
}
