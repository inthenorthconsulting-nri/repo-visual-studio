// `rvs change explain <advisory-id>`: retrieves a previously cached
// ChangeAdvisory (written via `rvs change evaluate --cache`) and narrates
// only the evidence it already carries -- never manufactures a causal claim
// beyond what the advisory itself recorded (§22). Follows the same
// try/catch/logger.error/exitCode=1 convention as graph-explain.ts.
//
// Freshness disclosure (Milestone 11.2 closure): when the Knowledge Graph
// cache is present, the stored advisory's baseline is compared against it
// via the package's own assessChangeAdvisoryFreshness() -- reusing
// resolveChangeWorkbenchBaseline() exactly as `evaluate` does, never
// auto-building it. This never invalidates, regenerates, or re-evaluates
// the stored advisory; it only discloses whether its recorded baseline
// still matches. When the KG cache is absent, this command has no evidence
// to disclose freshness with and stays silent on it -- explain itself must
// not start requiring `rvs graph build` to run at all.

import type { Logger } from "@rvs/core";
import { assessChangeAdvisoryFreshness } from "@rvs/change-workbench";
import { findStoredChangeAdvisoryById } from "../change-workbench-cache.js";
import { overallCoverageLabel, sanitizeTerminalText } from "./change-presentation.js";
import { resolveChangeWorkbenchBaseline } from "./change-baseline.js";

export async function runChangeExplainCommand(repoRoot: string, advisoryId: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  try {
    const stored = findStoredChangeAdvisoryById(repoRoot, advisoryId);
    if (!stored) {
      throw new Error(`No cached advisory found for id "${advisoryId}". Advisories are only available after \`rvs change evaluate --cache\`.`);
    }
    const { advisory } = stored;

    logger.info(`Advisory ${advisory.id} for proposal ${advisory.proposal_id} (repository ${advisory.repository_id}).`);
    logger.info(`  Evaluated against base_snapshot_digest ${advisory.base_snapshot_digest}.`);

    let currentBaseSnapshotDigest: string | undefined;
    try {
      currentBaseSnapshotDigest = resolveChangeWorkbenchBaseline(repoRoot).baseSnapshotDigest;
    } catch {
      currentBaseSnapshotDigest = undefined;
    }
    if (currentBaseSnapshotDigest !== undefined) {
      const freshness = assessChangeAdvisoryFreshness(stored, currentBaseSnapshotDigest);
      logger.info(`  Advisory freshness: ${freshness}`);
      if (freshness === "stale_equivalent") {
        logger.info(`    Evaluated baseline: ${stored.base_snapshot_digest_at_store_time}`);
        logger.info(`    Current baseline: ${currentBaseSnapshotDigest}`);
      }
    }

    if (advisory.proposal_validation.status === "invalid") {
      logger.info("  INVALID PROPOSAL");
      for (const issue of advisory.proposal_validation.issues) {
        logger.info(`    [${issue.code}] ${sanitizeTerminalText(issue.detail)}`);
      }
    } else {
      logger.info(`  ${overallCoverageLabel(advisory)}`);
      for (const entry of advisory.domain_coverage) {
        logger.info(`    [${entry.domain}] ${entry.status}: ${sanitizeTerminalText(entry.detail)}`);
      }
      if (advisory.impact.status !== "not_evaluated") {
        logger.info(
          `  Impact: ${advisory.impact.blast_radius_level} blast radius -- ${advisory.impact.directly_affected_refs.length} direct, ${advisory.impact.transitively_affected_refs.length} transitive ref(s) affected.`,
        );
      }
    }

    if (advisory.governance.findings.length > 0) {
      logger.info("  PROPOSED GOVERNANCE CONCERN");
      for (const finding of advisory.governance.findings) {
        logger.info(`    ${sanitizeTerminalText(finding.statement)}`);
      }
    }

    if (advisory.decisions.findings.length > 0) {
      logger.info("  PROPOSED DECISION CONCERN");
      for (const finding of advisory.decisions.findings) {
        logger.info(`    ${sanitizeTerminalText(finding.statement)}`);
      }
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
