import type { Logger } from "@rvs/core";
import type { PortfolioClaim, PortfolioDecision } from "@rvs/portfolio-intelligence";
import { explainPortfolioClaim, explainPortfolioDecision } from "@rvs/portfolio-intelligence";
import { readCachedJsonOptional } from "../cache.js";

// A portfolio id may name either a claim or a decision — the two id spaces
// never collide (portfolioClaimId/portfolioDecisionId prefix on distinct
// type vocabularies), so trying claims first and falling back to decisions
// is unambiguous. Mirrors runShowcaseExplain's single-id-space lookup,
// widened to two caches since portfolio-intelligence exports both kinds of
// evidence-backed statement as top-level, independently exportable artifacts.
export async function runPortfolioExplain(repoRoot: string, id: string, logger: Logger): Promise<void> {
  const claims = readCachedJsonOptional<PortfolioClaim[]>(repoRoot, "portfolio-claims.json") ?? [];
  const claim = claims.find((c) => c.id === id);
  if (claim) {
    logger.info(explainPortfolioClaim(claim));
    return;
  }

  const decisions = readCachedJsonOptional<PortfolioDecision[]>(repoRoot, "portfolio-decisions.json") ?? [];
  const decision = decisions.find((d) => d.id === id);
  if (decision) {
    logger.info(explainPortfolioDecision(decision));
    return;
  }

  logger.error(`No claim or decision found matching "${id}". Run \`rvs synthesize portfolio\` first, then \`rvs export portfolio-claims\`/\`rvs export portfolio-decisions\` to see all known ids.`);
  process.exitCode = 1;
}
