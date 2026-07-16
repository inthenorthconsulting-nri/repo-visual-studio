import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig, type Logger } from "@rvs/core";
import { buildEvidenceManifest, buildRepositoryModel } from "@rvs/repository-model";
import { cacheDir } from "../cache.js";

export async function runInspect(repoRoot: string, logger: Logger): Promise<void> {
  const config = loadConfig(repoRoot);
  const model = await buildRepositoryModel(repoRoot, config);
  const evidence = buildEvidenceManifest(model);

  const dir = cacheDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/repository-model.json`, JSON.stringify(model, null, 2));
  writeFileSync(`${dir}/evidence-manifest.json`, JSON.stringify(evidence, null, 2));

  logger.info(`Scanned ${model.files.total} files, extracted ${evidence.claims.length} evidence claims.`);
  logger.info("Wrote .rvs/cache/repository-model.json and .rvs/cache/evidence-manifest.json");
}
