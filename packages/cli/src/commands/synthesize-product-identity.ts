import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { Logger } from "@rvs/core";
import { exportProductIdentityCandidatesJson, loadProductIdentityOverride, synthesizeProductIdentity, validateProductIdentityModel } from "@rvs/product-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import { cacheDir, readCachedJson } from "../cache.js";

const PRODUCT_IDENTITY_MODEL_CACHE_FILE = "product-identity-model.json";
const PRODUCT_IDENTITY_CANDIDATES_CACHE_FILE = "product-identity-candidates.json";

// Mirrors runSynthesizeCapabilities: a pure function over an already-accepted
// CapabilityModel plus its source ArchitectureIntelligence. `rvs synthesize
// capabilities` must run first — this command never re-scans the repo, never
// re-synthesizes capabilities, and never calls an external model. It hard-codes
// no repository-specific product identity; everything is derived from cached
// evidence plus the optional .rvs/product.yml override.
export async function runSynthesizeProductIdentity(repoRoot: string, logger: Logger): Promise<void> {
  const architecture = readCachedJson<ArchitectureIntelligence>(repoRoot, "architecture-intelligence.json");
  const capabilityModel = readCachedJson<CapabilityModel>(repoRoot, "capability-model.json");
  const repositoryModel = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const override = loadProductIdentityOverride(repoRoot);

  const identityModel = synthesizeProductIdentity({
    architecture,
    capabilityModel,
    override,
    gitCommit: repositoryModel.git.commit,
    generatedAt: repositoryModel.generated_at,
  });

  let errorCount = 0;
  let warningCount = 0;
  for (const warning of validateProductIdentityModel(identityModel, capabilityModel)) {
    if (warning.severity === "error") {
      logger.error(`${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else {
      logger.warn(`${warning.code}: ${warning.message}`);
      warningCount += 1;
    }
  }

  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), PRODUCT_IDENTITY_MODEL_CACHE_FILE), JSON.stringify(identityModel, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), PRODUCT_IDENTITY_CANDIDATES_CACHE_FILE), exportProductIdentityCandidatesJson(identityModel.candidates));

  logger.info(
    `Synthesized product identity for "${identityModel.identity.displayName}": archetype=${identityModel.identity.archetype} confidence=${identityModel.identity.confidence}, ${identityModel.identity.valuePillars.length} value pillar(s), ${identityModel.identity.differentiators.length} differentiator(s), ${identityModel.candidates.length} candidate(s), ${errorCount} error(s), ${warningCount} warning(s).`,
  );
  logger.info(`Cached to .rvs/cache/${PRODUCT_IDENTITY_MODEL_CACHE_FILE} and .rvs/cache/${PRODUCT_IDENTITY_CANDIDATES_CACHE_FILE}`);
}
