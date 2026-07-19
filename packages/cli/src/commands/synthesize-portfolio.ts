import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { PORTFOLIO_CONFIG_RELATIVE_PATH, buildPortfolioDecisions, loadPortfolioConfig, synthesizePortfolio, validatePortfolioModel } from "@rvs/portfolio-intelligence";
import { cacheDir } from "../cache.js";

const PORTFOLIO_MODEL_CACHE_FILE = "portfolio-model.json";
const PORTFOLIO_CLAIMS_CACHE_FILE = "portfolio-claims.json";
const PORTFOLIO_DECISIONS_CACHE_FILE = "portfolio-decisions.json";

export interface SynthesizePortfolioOptions {
  allowPartial?: boolean;
}

// Combines already-generated Milestone 3-5 artifacts from every product
// listed in .rvs/portfolio.yml into a single evidence-backed PortfolioModel
// (§1). Never re-scans a product repository and never calls an external
// model — pure over the artifact roots the config points at. Decisions are
// computed here (not deferred to `rvs create slides --profile portfolio`)
// since buildPortfolioDecisions() is a pure function of the model alone,
// mirroring how portfolio-claims are available right after synthesis too.
export async function runSynthesizePortfolio(repoRoot: string, opts: SynthesizePortfolioOptions, logger: Logger): Promise<void> {
  const config = loadPortfolioConfig(repoRoot);
  if (!config) {
    throw new Error(`No ${PORTFOLIO_CONFIG_RELATIVE_PATH} found. Create one listing each product's id and artifact_root before running \`rvs synthesize portfolio\`.`);
  }

  const { model, claims } = synthesizePortfolio({
    repoRoot,
    config,
    generatedAt: new Date().toISOString(),
    allowPartialPortfolio: opts.allowPartial ?? false,
  });
  const decisions = buildPortfolioDecisions(model);

  let errorCount = 0;
  let warningCount = 0;
  for (const warning of validatePortfolioModel(model)) {
    if (warning.severity === "error") {
      logger.error(`${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else {
      logger.warn(`${warning.code}: ${warning.message}`);
      warningCount += 1;
    }
  }

  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), PORTFOLIO_MODEL_CACHE_FILE), JSON.stringify(model, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), PORTFOLIO_CLAIMS_CACHE_FILE), JSON.stringify(claims, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), PORTFOLIO_DECISIONS_CACHE_FILE), JSON.stringify(decisions, null, 2));

  logger.info(
    `Synthesized portfolio "${model.displayName}": ${model.products.length} product(s), ${model.capabilities.length} normalized capability(ies), ${model.relationships.length} relationship(s), ${model.gaps.length} gap(s), ${decisions.length} decision(s), ${errorCount} error(s), ${warningCount} warning(s).`,
  );
  if (model.excludedProducts.length > 0) {
    logger.warn(`${model.excludedProducts.length} product(s) excluded as incompatible: ${model.excludedProducts.map((p) => p.configId).join(", ")}`);
  }
  logger.info(`Cached to .rvs/cache/${PORTFOLIO_MODEL_CACHE_FILE}, .rvs/cache/${PORTFOLIO_CLAIMS_CACHE_FILE}, and .rvs/cache/${PORTFOLIO_DECISIONS_CACHE_FILE}`);
}
