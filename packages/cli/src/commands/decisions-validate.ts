import type { Logger } from "@rvs/core";
import { validateDecisionArtifacts } from "@rvs/decision-intelligence";
import { runDecisionAnalysis } from "./decisions-analyze.js";

export interface DecisionsValidateOptions {
  ci?: boolean;
}

/**
 * Runs the same analysis pipeline as `rvs decisions analyze` (via the
 * shared `runDecisionAnalysis` helper), then validates the resulting
 * snapshot/links/claims/narrative/plan and prints every finding. Only
 * `--ci` turns this into a gate: it sets `process.exitCode = 1` when any
 * finding's severity is "error", mirroring governance-check.ts's --ci
 * precedent.
 */
export async function runDecisionsValidate(repoRoot: string, opts: DecisionsValidateOptions, logger: Logger): Promise<void> {
  const result = await runDecisionAnalysis(repoRoot, logger);

  const issues = validateDecisionArtifacts({
    snapshot: result.snapshot,
    links: result.links,
    claims: result.claims,
    narrative: result.narrative,
    plan: result.plan,
  });

  let errorCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") {
      errorCount += 1;
      logger.error(`[${issue.code}] ${issue.message}`);
    } else {
      logger.warn(`[${issue.code}] ${issue.message}`);
    }
  }

  logger.info(`Validated decision artifacts: ${issues.length} finding(s) (${errorCount} error(s)).`);

  if (opts.ci && errorCount > 0) {
    logger.error(`Decision validation failed under --ci: ${errorCount} error-severity finding(s).`);
    process.exitCode = 1;
  }
}
