import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { PortfolioClaim } from "@rvs/portfolio-intelligence";
import { exportPortfolioClaimsJson } from "@rvs/portfolio-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportPortfolioClaimsOptions {
  output?: string;
}

// Pure formatting over the already-synthesized portfolio-claims.json cache —
// `rvs synthesize portfolio` must run first. Rejected claims are included
// verbatim (never filtered out here), matching exporter.ts's header comment.
export async function runExportPortfolioClaims(repoRoot: string, opts: ExportPortfolioClaimsOptions, logger: Logger): Promise<void> {
  const claims = readCachedJson<PortfolioClaim[]>(repoRoot, "portfolio-claims.json");

  const outputPath = resolve(repoRoot, opts.output ?? "portfolio-claims.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, exportPortfolioClaimsJson(claims));

  const approved = claims.filter((c) => c.status === "approved" || c.status === "approved_with_qualification").length;
  logger.info(`Wrote ${outputPath} (${claims.length} claim(s), ${approved} approved).`);
}
