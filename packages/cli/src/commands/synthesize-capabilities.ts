import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { discoverCapabilityCandidates, synthesizeCapabilities, validateCapabilityModelStructure } from "@rvs/capability-intelligence";
import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { cacheDir, readCachedJson, readCachedJsonOptional } from "../cache.js";

const CAPABILITY_MODEL_CACHE_FILE = "capability-model.json";
const CAPABILITY_CANDIDATES_CACHE_FILE = "capability-candidates.json";

// Mirrors runSynthesizeArchitecture: a pure function over already-cached
// evidence. `rvs synthesize architecture` must run first — this command
// never re-scans the repo, never re-synthesizes architecture, and never
// calls an external model. It also never hard-codes a capability list for
// any specific repository; everything below is derived from the cached
// ArchitectureIntelligence/RepositoryModel/WorkflowGraph/TerraformTopology
// evidence for whatever repository `rvs inspect` was run against.
export async function runSynthesizeCapabilities(repoRoot: string, logger: Logger): Promise<void> {
  const architecture = readCachedJson<ArchitectureIntelligence>(repoRoot, "architecture-intelligence.json");
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const workflowGraphs = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, "workflow-graphs.json") ?? [];
  const terraformTopologies = readCachedJsonOptional<TerraformTopology[]>(repoRoot, "terraform-topologies.json") ?? [];

  const capabilityModel = synthesizeCapabilities({
    architecture,
    model,
    workflowGraphs,
    terraformTopologies,
    gitCommit: model.git.commit,
    generatedAt: model.generated_at,
  });

  // Candidates are re-discovered (not stored on the model) purely for the
  // machine-readable candidates.json diagnostic dump — discovery is a pure
  // function of the same cached inputs, so this is not a second synthesis.
  const candidates = discoverCapabilityCandidates({ architecture, model, workflowGraphs, terraformTopologies });

  let errorCount = 0;
  let warningCount = 0;
  for (const warning of validateCapabilityModelStructure(capabilityModel)) {
    if (warning.severity === "error") {
      logger.error(`${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else {
      logger.warn(`${warning.code}: ${warning.message}`);
      warningCount += 1;
    }
  }

  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), CAPABILITY_MODEL_CACHE_FILE), JSON.stringify(capabilityModel, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), CAPABILITY_CANDIDATES_CACHE_FILE), JSON.stringify(candidates, null, 2));

  logger.info(
    `Synthesized capability intelligence for "${capabilityModel.systemIdentity.displayName}": ${capabilityModel.evidenceSummary.includedCount} included, ${capabilityModel.evidenceSummary.qualifiedCount} qualified, ${capabilityModel.evidenceSummary.gapCount} gaps, ${capabilityModel.evidenceSummary.roadmapCount} roadmap-only, ${capabilityModel.evidenceSummary.excludedCount} excluded (of ${capabilityModel.evidenceSummary.totalCandidates} candidates), ${errorCount} error(s), ${warningCount} warning(s).`,
  );
  logger.info(`Cached to .rvs/cache/${CAPABILITY_MODEL_CACHE_FILE} and .rvs/cache/${CAPABILITY_CANDIDATES_CACHE_FILE}`);
}
