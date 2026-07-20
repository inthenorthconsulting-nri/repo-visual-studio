import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import {
  GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
  GOVERNANCE_OUTPUT_FILES,
  assessBlastRadius,
  assessSnapshotCompatibility,
  buildGovernanceNarrative,
  buildGovernancePlan,
  buildIntelligenceSnapshot,
  buildReportId,
  diffArchitecture,
  diffCapability,
  diffEvidence,
  diffPortfolio,
  diffProduct,
  evaluatePolicy,
  loadGovernanceConfig,
  loadPolicyFiles,
  mergeFindings,
  summarizeFindings,
} from "@rvs/governance-intelligence";
import type {
  ContinuousIntelligenceReport,
  EvidenceRef,
  GovernanceConfig,
  GovernanceEvaluation,
  GovernanceNarrative,
  GovernancePlan,
  GovernanceSeverity,
  IntelligenceSnapshot,
  PortfolioChangeSet,
} from "@rvs/governance-intelligence";
import {
  type GovernanceBaselineFile,
  type RawArtifacts,
  readCurrentRawArtifacts,
  readSnapshotEnvelope,
  writeGovernanceOutputs,
} from "../governance-cache.js";

export interface GovernanceCompareOptions {
  from?: string;
  to?: string;
}

export interface GovernanceComparisonResult {
  report: ContinuousIntelligenceReport;
  narrative: GovernanceNarrative;
  plan: GovernancePlan;
  config: GovernanceConfig | undefined;
}

function sortEvidenceRefsLocal(refs: EvidenceRef[]): EvidenceRef[] {
  return [...refs].sort((a, b) => {
    if (a.source_artifact !== b.source_artifact) return a.source_artifact < b.source_artifact ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const aLines = a.lines ?? "";
    const bLines = b.lines ?? "";
    return aLines < bLines ? -1 : aLines > bLines ? 1 : 0;
  });
}

function dedupeEvidenceRefsLocal(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source_artifact}:${ref.path}:${ref.lines ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Runs the full governance comparison pipeline (compatibility gate -> four
 * domain diffs + evidence diff -> blast radius -> policy load/evaluate ->
 * merge findings -> assemble the report -> narrative -> plan) and caches
 * every GOVERNANCE_OUTPUT_FILES artifact under .rvs/cache/governance/.
 * Shared by both `rvs governance compare` (inspection-only) and
 * `rvs governance check` (adds --ci exit-code gating on top) so the
 * pipeline itself is defined exactly once.
 */
export async function runGovernanceComparison(repoRoot: string, opts: GovernanceCompareOptions, logger: Logger): Promise<GovernanceComparisonResult> {
  const config = loadGovernanceConfig(repoRoot);
  const generatedAt = new Date().toISOString();

  // --- Resolve source ("from") snapshot + raw artifacts -------------------
  let sourceSnapshot: IntelligenceSnapshot;
  let sourceArtifacts: RawArtifacts;
  if (opts.from) {
    const envelope = readSnapshotEnvelope(repoRoot, opts.from);
    sourceSnapshot = envelope.snapshot;
    sourceArtifacts = envelope.rawArtifacts;
  } else {
    if (!config?.baseline) {
      throw new Error("No governance baseline is configured and no --from snapshot was given. Run `rvs governance baseline set <snapshot>` first, or pass --from <snapshot>.");
    }
    const baselinePath = resolve(repoRoot, config.baseline.snapshot);
    if (!existsSync(baselinePath)) {
      throw new Error(`Configured baseline snapshot "${config.baseline.snapshot}" (.rvs/governance.yml) does not exist at ${baselinePath}.`);
    }
    const baselineFile = JSON.parse(readFileSync(baselinePath, "utf8")) as GovernanceBaselineFile;
    sourceSnapshot = baselineFile.snapshot;
    sourceArtifacts = baselineFile.rawArtifacts ?? {};
  }

  // --- Resolve target ("to") snapshot + raw artifacts ----------------------
  let targetSnapshot: IntelligenceSnapshot;
  let targetArtifacts: RawArtifacts;
  if (opts.to) {
    const envelope = readSnapshotEnvelope(repoRoot, opts.to);
    targetSnapshot = envelope.snapshot;
    targetArtifacts = envelope.rawArtifacts;
  } else {
    targetArtifacts = readCurrentRawArtifacts(repoRoot, true);
    targetSnapshot = buildIntelligenceSnapshot({ generatedAt, ...targetArtifacts });
  }

  // --- Compatibility gate ---------------------------------------------------
  const compatibility = assessSnapshotCompatibility(sourceSnapshot, targetSnapshot);
  if (compatibility.status === "incompatible") {
    logger.error(`Snapshots are incompatible; cannot compare "${sourceSnapshot.id}" -> "${targetSnapshot.id}".`);
    for (const reason of compatibility.reasons) logger.error(`  - ${reason}`);
    throw new Error("Governance compare aborted: snapshots are incompatible (see reasons above).");
  }
  if (compatibility.reasons.length > 0) {
    for (const reason of compatibility.reasons) logger.warn(reason);
  }

  // --- Domain diffs -----------------------------------------------------
  const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArtifacts.architecture, targetArtifact: targetArtifacts.architecture });
  const capabilityChanges = diffCapability({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArtifacts.capability, targetArtifact: targetArtifacts.capability });
  const productChanges = diffProduct({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArtifacts.product, targetArtifact: targetArtifacts.product });

  const sourceHasPortfolio = sourceSnapshot.artifacts.find((a) => a.artifact === "portfolio")?.provenance === "complete";
  const targetHasPortfolio = targetSnapshot.artifacts.find((a) => a.artifact === "portfolio")?.provenance === "complete";
  const includePortfolio = sourceHasPortfolio || targetHasPortfolio;
  const portfolioChanges: PortfolioChangeSet | undefined = includePortfolio
    ? diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourceArtifacts.portfolio, targetArtifact: targetArtifacts.portfolio })
    : undefined;

  const evidenceChanges = diffEvidence({ sourceSnapshot, targetSnapshot, architectureChanges, capabilityChanges, productChanges, portfolioChanges });

  const blastRadius = assessBlastRadius({
    sourceSnapshot,
    targetSnapshot,
    architectureChanges,
    capabilityChanges,
    productChanges,
    portfolioChanges,
    sourceArchitectureArtifact: sourceArtifacts.architecture,
    targetArchitectureArtifact: targetArtifacts.architecture,
    sourceCapabilityArtifact: sourceArtifacts.capability,
    targetCapabilityArtifact: targetArtifacts.capability,
    sourcePortfolioArtifact: sourceArtifacts.portfolio,
    targetPortfolioArtifact: targetArtifacts.portfolio,
  });

  // --- Policy load + evaluate -----------------------------------------------
  const policyPaths = (config?.policies ?? []).map((p) => resolve(repoRoot, p));
  const policies = loadPolicyFiles(policyPaths, generatedAt);

  const evaluations: GovernanceEvaluation[] = policies
    .map((policy) =>
      evaluatePolicy({
        policy,
        sourceSnapshotId: sourceSnapshot.id,
        targetSnapshotId: targetSnapshot.id,
        architectureChanges,
        capabilityChanges,
        productChanges,
        portfolioChanges,
        blastRadius,
        targetCompatibility: compatibility.status,
        generatedAt,
        now: generatedAt,
      }),
    )
    .sort((a, b) => (a.policy_id < b.policy_id ? -1 : a.policy_id > b.policy_id ? 1 : 0));

  const findings = mergeFindings(evaluations);

  // --- Assemble the report ---------------------------------------------------
  // No single builder function exists for ContinuousIntelligenceReport in
  // @rvs/governance-intelligence (unlike architecture/capability/product's
  // own artifacts) -- it is hand-assembled here from the pieces above, per
  // the milestone brief.
  const evidenceRefs = sortEvidenceRefsLocal(
    dedupeEvidenceRefsLocal([
      ...architectureChanges.evidence_refs,
      ...capabilityChanges.evidence_refs,
      ...productChanges.evidence_refs,
      ...(portfolioChanges?.evidence_refs ?? []),
      ...evidenceChanges.evidence_refs,
      ...blastRadius.evidence_refs,
      ...findings.flatMap((f) => f.evidence_refs),
    ]),
  );

  const report: ContinuousIntelligenceReport = {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildReportId(sourceSnapshot.id, targetSnapshot.id),
    source_snapshot_id: sourceSnapshot.id,
    target_snapshot_id: targetSnapshot.id,
    repository_id: targetSnapshot.repository_id ?? sourceSnapshot.repository_id,
    compatibility: compatibility.status,
    architecture_changes: architectureChanges,
    capability_changes: capabilityChanges,
    product_changes: productChanges,
    portfolio_changes: portfolioChanges,
    evidence_changes: evidenceChanges,
    blast_radius: blastRadius,
    evaluations,
    findings,
    evidence_refs: evidenceRefs,
    generation: { generated_at: generatedAt },
  };

  const narrative = buildGovernanceNarrative({ report, generatedAt });
  const plan = buildGovernancePlan({ report, narrative, generatedAt });

  writeGovernanceOutputs(repoRoot, {
    currentSnapshot: targetSnapshot,
    architectureChanges,
    capabilityChanges,
    productChanges,
    portfolioChanges,
    evidenceChanges,
    blastRadius,
    governanceFindings: findings,
    governanceReport: report,
    governanceNarrative: narrative,
    governancePlan: plan,
  });

  return { report, narrative, plan, config };
}

// ---------------------------------------------------------------------------
// Severity-level gating shared by `compare`'s console summary and `check`'s
// --ci exit-code decision. A finding counts as a "failure" here only when
// it actually represents a violation (`result === "fail"` or
// `"unverifiable"`, matching printFindingsSummary's own filter) and is not
// currently excepted -- a passing rule that merely carries a "blocking"
// severity must never trip --ci.
// ---------------------------------------------------------------------------

const DEFAULT_FAIL_ON: GovernanceSeverity[] = ["blocking"];
const DEFAULT_WARN_ON: GovernanceSeverity[] = ["review_required"];

function levelsFor(config: GovernanceConfig | undefined): { failOn: GovernanceSeverity[]; warnOn: GovernanceSeverity[] } {
  return {
    failOn: config?.comparison?.fail_on ?? DEFAULT_FAIL_ON,
    warnOn: config?.comparison?.warn_on ?? DEFAULT_WARN_ON,
  };
}

export function printFindingsSummary(result: GovernanceComparisonResult, logger: Logger, concise: boolean): { failCount: number } {
  const { failOn, warnOn } = levelsFor(result.config);
  let failCount = 0;
  for (const finding of result.report.findings) {
    if (finding.excepted) continue;
    if (finding.result !== "fail" && finding.result !== "unverifiable") continue;
    if (failOn.includes(finding.severity)) {
      logger.error(`[${finding.severity}] ${finding.statement}`);
      failCount += 1;
    } else if (warnOn.includes(finding.severity)) {
      logger.warn(`[${finding.severity}] ${finding.statement}`);
    } else if (!concise) {
      logger.info(`[${finding.severity}] ${finding.statement}`);
    }
  }
  return { failCount };
}

export async function runGovernanceCompare(repoRoot: string, opts: GovernanceCompareOptions, logger: Logger): Promise<void> {
  const result = await runGovernanceComparison(repoRoot, opts, logger);
  const { report } = result;

  const changeCount = (changes: { type: string }[]) => changes.filter((c) => c.type !== "unchanged").length;
  const portfolioCount = report.portfolio_changes ? changeCount(report.portfolio_changes.changes) : undefined;

  logger.info(`Compared "${report.source_snapshot_id}" -> "${report.target_snapshot_id}" (compatibility: "${report.compatibility}").`);
  logger.info(
    `Changes: ${changeCount(report.architecture_changes.changes)} architecture, ${changeCount(report.capability_changes.changes)} capability, ${changeCount(report.product_changes.changes)} product` +
      (portfolioCount !== undefined ? `, ${portfolioCount} portfolio` : "") +
      `.`,
  );

  const summary = summarizeFindings(report.findings);
  logger.info(
    `Findings: ${summary.total} total (${summary.by_severity.blocking} blocking, ${summary.by_severity.review_required} review-required, ${summary.by_severity.advisory} advisory, ${summary.by_severity.informational} informational).`,
  );

  const byLevel: Record<string, number> = {};
  for (const entry of report.blast_radius.entries) byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
  logger.info(`Blast radius: ${Object.entries(byLevel).map(([level, count]) => `${count} ${level}`).join(", ") || "none"}.`);

  printFindingsSummary(result, logger, false);

  logger.info("Cached governance outputs to .rvs/cache/governance/.");
}
