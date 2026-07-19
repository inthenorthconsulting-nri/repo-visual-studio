import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { PortfolioModel } from "@rvs/portfolio-intelligence";
import { exportPortfolioModelJson } from "@rvs/portfolio-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportPortfolioModelOptions {
  output?: string;
}

// Pure formatting over the already-synthesized portfolio-model.json cache —
// `rvs synthesize portfolio` must run first.
export async function runExportPortfolioModel(repoRoot: string, opts: ExportPortfolioModelOptions, logger: Logger): Promise<void> {
  const model = readCachedJson<PortfolioModel>(repoRoot, "portfolio-model.json");

  const outputPath = resolve(repoRoot, opts.output ?? "portfolio-model.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, exportPortfolioModelJson(model));

  logger.info(`Wrote ${outputPath} (${model.products.length} product(s), ${model.capabilities.length} capability(ies), ${model.relationships.length} relationship(s)).`);
}
