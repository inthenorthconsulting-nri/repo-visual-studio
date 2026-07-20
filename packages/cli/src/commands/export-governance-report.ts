import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { GOVERNANCE_OUTPUT_FILES } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport } from "@rvs/governance-intelligence";
import { readGovernanceCachedJson } from "../governance-cache.js";

export interface ExportGovernanceReportOptions {
  output?: string;
}

// Pure formatting over the already-cached continuous intelligence report —
// `rvs governance compare`/`rvs governance check` must run first.
export async function runExportGovernanceReport(repoRoot: string, opts: ExportGovernanceReportOptions, logger: Logger): Promise<void> {
  const report = readGovernanceCachedJson<ContinuousIntelligenceReport>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceReport);

  const outputPath = resolve(repoRoot, opts.output ?? "governance-report.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  logger.info(`Wrote ${outputPath} (${report.findings.length} finding(s), compatibility "${report.compatibility}").`);
}
