import type { Logger } from "@rvs/core";
import { summarizeFindings } from "@rvs/governance-intelligence";
import { type GovernanceCompareOptions, printFindingsSummary, runGovernanceComparison } from "./governance-compare.js";

export interface GovernanceCheckOptions extends GovernanceCompareOptions {
  ci?: boolean;
}

/**
 * Same comparison pipeline as `rvs governance compare` (via the shared
 * `runGovernanceComparison` helper), with a more concise console summary.
 * Only `--ci` turns this into a gate: it sets `process.exitCode = 1` when
 * any un-excepted finding's severity is in the configured
 * `comparison.fail_on` list (default: ["blocking"]). Without --ci this
 * command never touches process.exitCode, same as `compare`.
 */
export async function runGovernanceCheck(repoRoot: string, opts: GovernanceCheckOptions, logger: Logger): Promise<void> {
  const result = await runGovernanceComparison(repoRoot, opts, logger);
  const { report } = result;

  const summary = summarizeFindings(report.findings);
  logger.info(
    `Governance check "${report.source_snapshot_id}" -> "${report.target_snapshot_id}": compatibility "${report.compatibility}", ${summary.total} finding(s) (${summary.by_severity.blocking} blocking, ${summary.by_severity.review_required} review-required).`,
  );

  const { failCount } = printFindingsSummary(result, logger, true);

  if (opts.ci && failCount > 0) {
    logger.error(`Governance check failed under --ci: ${failCount} un-excepted finding(s) at or above the configured fail_on severity.`);
    process.exitCode = 1;
  }
}
