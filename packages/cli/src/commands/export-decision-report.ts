import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { DecisionIntelligenceReport } from "@rvs/decision-intelligence";
import { readDecisionCachedJson } from "../decision-cache.js";

export interface ExportDecisionReportOptions {
  output?: string;
}

export async function runExportDecisionReport(repoRoot: string, opts: ExportDecisionReportOptions, logger: Logger): Promise<void> {
  const report = readDecisionCachedJson<DecisionIntelligenceReport>(repoRoot, DECISION_OUTPUT_FILES.decisionReport);
  const outputPath = resolve(repoRoot, opts.output ?? "decision-report.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  logger.info(`Wrote ${outputPath} (${report.decision_count} decision(s), ${report.unresolved_count} unresolved).`);
}
