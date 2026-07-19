import type { Logger } from "@rvs/core";
import type { ProductClaim, ShowcasePlan } from "@rvs/product-intelligence";
import { explainClaim } from "@rvs/product-intelligence";
import { readCachedJson } from "../cache.js";

export async function runShowcaseExplain(repoRoot: string, claimId: string, logger: Logger): Promise<void> {
  const plan = readCachedJson<ShowcasePlan>(repoRoot, "showcase-plan.json");
  const all: ProductClaim[] = [...plan.narrative.approvedClaims, ...plan.narrative.rejectedClaims, ...plan.narrative.runtimeVerificationClaims];

  const found = all.find((c) => c.id === claimId);
  if (!found) {
    logger.error(`No claim found matching "${claimId}". Run \`rvs export showcase-plan\` to see all known claim ids.`);
    process.exitCode = 1;
    return;
  }
  logger.info(explainClaim(found));
}
