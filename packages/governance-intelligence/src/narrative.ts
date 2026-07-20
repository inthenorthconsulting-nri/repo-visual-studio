import type { ContinuousIntelligenceReport, GovernanceChangeEntry, GovernanceNarrative } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { classifyGovernanceClaim, draftStandardGovernanceClaims, type GovernanceClaimContext } from "./claims.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { summarizeFindings } from "./findings.js";
import { buildNarrativeId } from "./ids.js";

// ---------------------------------------------------------------------------
// buildGovernanceNarrative -- deterministic prose synthesis over a
// ContinuousIntelligenceReport. Every sentence is generated from real report
// counts/ids; nothing here ever asserts an outcome the report doesn't
// evidence. The five text fields are produced in the fixed order
// contracts.ts's GovernanceNarrative declares them (summary, whatChanged,
// whyItMatters, riskAssessment, recommendedActions), and every one of them
// is scanned by containsForbiddenPhrasing before this function returns --
// this is a self-enforcing invariant (a thrown Error, not just a test), so a
// future edit to these builders that starts asserting an unsupported
// outcome fails loudly at synthesis time rather than only in a test suite.
// ---------------------------------------------------------------------------

/**
 * Fixed, case-insensitive forbidden substrings. Per the brief these (and
 * "obvious paraphrases") must never appear in generated narrative text.
 * "no impact" is treated as unconditionally forbidden -- rather than trying
 * to detect whether a "no impact" occurrence is "bare" vs. "qualified" via
 * substring scanning (not reliably decidable that way), this package's
 * narrative generators simply never use that phrase at all, preferring
 * evidence-qualified phrasing such as "no blocking findings were identified,
 * based on the evidence available" instead. Documented as a judgment call.
 */
const FORBIDDEN_PHRASES = ["architecture is improved", "risk is reduced", "portfolio is more efficient", "change is safe", "no impact"];

/** Scans `text` for each fixed forbidden substring (case-insensitive) and returns every one found, in FORBIDDEN_PHRASES order. Empty array means clean. */
export function containsForbiddenPhrasing(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));
}

function allChangeEntries(report: ContinuousIntelligenceReport): GovernanceChangeEntry[] {
  return [...report.architecture_changes.changes, ...report.capability_changes.changes, ...report.product_changes.changes, ...(report.portfolio_changes?.changes ?? [])];
}

function buildSummary(report: ContinuousIntelligenceReport): string {
  const evaluationCount = report.evaluations.length;
  const blockingFailures = report.findings.filter((finding) => finding.severity === "blocking" && finding.result === "fail").length;
  return `Comparing snapshot "${report.source_snapshot_id}" to "${report.target_snapshot_id}" evaluated ${evaluationCount} polic${evaluationCount === 1 ? "y" : "ies"} and produced ${report.findings.length} finding(s), ${blockingFailures} of which are blocking failures. Overall compatibility is "${report.compatibility}".`;
}

function buildWhatChanged(report: ContinuousIntelligenceReport): string {
  const domains: { label: string; changes: GovernanceChangeEntry[] }[] = [
    { label: "architecture", changes: report.architecture_changes.changes },
    { label: "capability", changes: report.capability_changes.changes },
    { label: "product", changes: report.product_changes.changes },
  ];
  if (report.portfolio_changes) domains.push({ label: "portfolio", changes: report.portfolio_changes.changes });

  const parts = domains.map((domain) => `${domain.changes.filter((change) => change.type !== "unchanged").length} ${domain.label} change(s)`);

  const material = allChangeEntries(report)
    .filter((change) => change.classification.materiality === "material")
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 5);
  const materialText = material.length > 0 ? ` Material changes include: ${material.map((change) => `"${change.entity_id}" (${change.type})`).join(", ")}.` : " No material changes were identified in this comparison.";

  return `${parts.join(", ")}.${materialText}`;
}

function buildWhyItMatters(report: ContinuousIntelligenceReport): string {
  const summary = summarizeFindings(report.findings);
  const levelCounts = report.blast_radius.entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.level] = (acc[entry.level] ?? 0) + 1;
    return acc;
  }, {});
  const blastText = Object.keys(levelCounts).length > 0 ? `Blast radius spans ${Object.entries(levelCounts).map(([level, count]) => `${count} ${level}`).join(", ")}.` : "No blast radius entries were assessed for this comparison, because no changes were detected.";

  return `${summary.by_severity.blocking} blocking, ${summary.by_severity.review_required} review-required, ${summary.by_severity.advisory} advisory, and ${summary.by_severity.informational} informational finding(s) were produced. ${blastText}`;
}

function buildRiskAssessment(report: ContinuousIntelligenceReport): string {
  const blockingFails = report.findings.filter((finding) => finding.severity === "blocking" && finding.result === "fail");
  const reviewFails = report.findings.filter((finding) => finding.severity === "review_required" && finding.result === "fail");
  const unresolvedBlast = report.blast_radius.entries.filter((entry) => entry.level === "unresolved");
  const brokenLineage = allChangeEntries(report).filter((change) => change.lineage === "broken");

  const parts: string[] = [];
  if (blockingFails.length > 0) parts.push(`${blockingFails.length} blocking finding(s) failed policy evaluation and must be resolved or excepted before this change is trustworthy.`);
  if (reviewFails.length > 0) parts.push(`${reviewFails.length} finding(s) require human review before this change can be trusted.`);
  if (unresolvedBlast.length > 0) parts.push(`${unresolvedBlast.length} change(s) have an unresolved blast radius; their downstream reach could not be determined from available evidence.`);
  if (brokenLineage.length > 0) parts.push(`${brokenLineage.length} change(s) lost evidence lineage entirely (lineage state "broken").`);

  if (parts.length === 0) {
    return "No blocking findings, review-required findings, unresolved blast-radius entries, or broken evidence lineage were identified in this comparison, based on the evidence available.";
  }
  return parts.join(" ");
}

function buildRecommendedActions(report: ContinuousIntelligenceReport): string {
  const blocking = report.findings.filter((finding) => finding.severity === "blocking" && finding.result === "fail");
  const reviewRequired = report.findings.filter((finding) => finding.human_review_required && finding.result !== "excepted");
  const unresolvedBlast = report.blast_radius.entries.filter((entry) => entry.level === "unresolved");

  const actions: string[] = [];
  actions.push(blocking.length > 0 ? `${blocking.length} blocking finding(s) require resolution or an explicit governance exception before this change can be promoted.` : "No blocking findings were identified in this comparison.");
  if (reviewRequired.length > 0) actions.push(`${reviewRequired.length} finding(s) require human review before this change is approved.`);
  if (unresolvedBlast.length > 0) actions.push(`${unresolvedBlast.length} change(s) need additional evidence to resolve their blast radius before this change can be fully assessed.`);

  return actions.join(" ");
}

export interface BuildGovernanceNarrativeInput {
  report: ContinuousIntelligenceReport;
  /** Caller-supplied wall-clock timestamp -- this package never calls Date.now()/new Date() internally. */
  generatedAt: string;
}

export function buildGovernanceNarrative(input: BuildGovernanceNarrativeInput): GovernanceNarrative {
  const { report, generatedAt } = input;

  const summary = buildSummary(report);
  const whatChanged = buildWhatChanged(report);
  const whyItMatters = buildWhyItMatters(report);
  const riskAssessment = buildRiskAssessment(report);
  const recommendedActions = buildRecommendedActions(report);

  const fields: [string, string][] = [
    ["summary", summary],
    ["whatChanged", whatChanged],
    ["whyItMatters", whyItMatters],
    ["riskAssessment", riskAssessment],
    ["recommendedActions", recommendedActions],
  ];
  for (const [field, text] of fields) {
    const hits = containsForbiddenPhrasing(text);
    if (hits.length > 0) {
      throw new Error(`Generated governance narrative field "${field}" contains forbidden phrasing (${hits.join(", ")}). This is a synthesis bug: narrative text must never assert an unsupported safety/no-impact/improvement/risk-reduction/efficiency claim.`);
    }
  }

  const claimContext: GovernanceClaimContext = { report };
  const claims = draftStandardGovernanceClaims(report).map((draft) => classifyGovernanceClaim(draft, claimContext));
  const approvedClaims = claims.filter((claim) => claim.status !== "rejected").sort((a, b) => a.id.localeCompare(b.id));
  const rejectedClaims = claims.filter((claim) => claim.status === "rejected").sort((a, b) => a.id.localeCompare(b.id));

  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs([...report.evidence_refs, ...claims.flatMap((claim) => claim.evidence_refs)]));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildNarrativeId(report.source_snapshot_id, report.target_snapshot_id),
    source_snapshot_id: report.source_snapshot_id,
    target_snapshot_id: report.target_snapshot_id,
    summary,
    whatChanged,
    whyItMatters,
    riskAssessment,
    recommendedActions,
    approvedClaims,
    rejectedClaims,
    evidence_refs: evidenceRefs,
    generation: { generated_at: generatedAt },
  };
}
