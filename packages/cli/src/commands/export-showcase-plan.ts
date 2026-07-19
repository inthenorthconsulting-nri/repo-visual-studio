import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ShowcasePlan } from "@rvs/product-intelligence";
import { exportShowcasePlanJson } from "@rvs/product-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportShowcasePlanOptions {
  output?: string;
}

// Pure formatting over the already-synthesized showcase-plan.json cache —
// `rvs create slides --profile showcase` must run first. The ShowcasePlan
// already nests its full ExecutiveNarrative (including approved/rejected/
// runtime-verification claims), so this single artifact is self-sufficient.
export async function runExportShowcasePlan(repoRoot: string, opts: ExportShowcasePlanOptions, logger: Logger): Promise<void> {
  const plan = readCachedJson<ShowcasePlan>(repoRoot, "showcase-plan.json");

  const outputPath = resolve(repoRoot, opts.output ?? "showcase-plan.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, exportShowcasePlanJson(plan));

  logger.info(`Wrote ${outputPath} (${plan.scenes.length} scene(s), ${plan.evidenceSummary.approvedClaimCount} approved claim(s), ${plan.evidenceSummary.rejectedClaimCount} rejected claim(s)).`);
}
