import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { PortfolioDecision } from "@rvs/portfolio-intelligence";
import { exportPortfolioDecisionsJson } from "@rvs/portfolio-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportPortfolioDecisionsOptions {
  output?: string;
}

// Pure formatting over the already-synthesized portfolio-decisions.json
// cache — `rvs synthesize portfolio` must run first.
export async function runExportPortfolioDecisions(repoRoot: string, opts: ExportPortfolioDecisionsOptions, logger: Logger): Promise<void> {
  const decisions = readCachedJson<PortfolioDecision[]>(repoRoot, "portfolio-decisions.json");

  const outputPath = resolve(repoRoot, opts.output ?? "portfolio-decisions.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, exportPortfolioDecisionsJson(decisions));

  logger.info(`Wrote ${outputPath} (${decisions.length} decision(s)).`);
}
