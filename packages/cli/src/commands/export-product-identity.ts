import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ProductIdentityModel } from "@rvs/product-intelligence";
import { exportProductIdentityJson } from "@rvs/product-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportProductIdentityOptions {
  output?: string;
}

// Pure formatting over the already-synthesized product-identity-model.json
// cache — `rvs synthesize product-identity` must run first.
export async function runExportProductIdentity(repoRoot: string, opts: ExportProductIdentityOptions, logger: Logger): Promise<void> {
  const model = readCachedJson<ProductIdentityModel>(repoRoot, "product-identity-model.json");

  const outputPath = resolve(repoRoot, opts.output ?? "product-identity.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, exportProductIdentityJson(model));

  logger.info(`Wrote ${outputPath} (archetype=${model.identity.archetype}, confidence=${model.identity.confidence}, ${model.candidates.length} candidate(s)).`);
}
