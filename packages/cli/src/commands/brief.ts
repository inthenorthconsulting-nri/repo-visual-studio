import { mkdirSync, writeFileSync } from "node:fs";
import type { EvidenceManifest, Logger } from "@rvs/core";
import { loadConfig } from "@rvs/core";
import { buildNarrativeBrief, serializeBrief } from "@rvs/narrative-planner";
import type { RepositoryModel } from "@rvs/repository-model";
import { cacheDir, readCachedJson } from "../cache.js";

export async function runBrief(repoRoot: string, audience: string | undefined, logger: Logger): Promise<void> {
  const config = loadConfig(repoRoot);
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const evidence = readCachedJson<EvidenceManifest>(repoRoot, "evidence-manifest.json");

  const brief = buildNarrativeBrief(model, evidence, audience ?? config.defaults.audience);

  const dir = cacheDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/narrative-brief.yml`, serializeBrief(brief));

  logger.info(`Wrote .rvs/cache/narrative-brief.yml for audience "${brief.audience}"`);
}
