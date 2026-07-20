import type { Logger } from "@rvs/core";
import { GOVERNANCE_OUTPUT_FILES, explainGovernanceId } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport, GovernancePlan } from "@rvs/governance-intelligence";
import { BASELINE_SNAPSHOT_FILE, type GovernanceBaselineFile, readGovernanceCachedJsonOptional } from "../governance-cache.js";

export async function runGovernanceExplain(repoRoot: string, id: string, logger: Logger): Promise<void> {
  const report = readGovernanceCachedJsonOptional<ContinuousIntelligenceReport>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceReport);
  const plan = readGovernanceCachedJsonOptional<GovernancePlan>(repoRoot, GOVERNANCE_OUTPUT_FILES.governancePlan);
  const baseline = readGovernanceCachedJsonOptional<GovernanceBaselineFile>(repoRoot, BASELINE_SNAPSHOT_FILE);

  try {
    const result = explainGovernanceId(id, { report, plan, baseline });
    logger.info(result.explanation);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
