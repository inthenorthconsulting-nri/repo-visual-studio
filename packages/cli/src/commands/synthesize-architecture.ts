import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { synthesizeArchitectureIntelligence, validateArchitectureIntelligenceStructure } from "@rvs/architecture-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { cacheDir, readCachedJson, readCachedJsonOptional } from "../cache.js";

const ARCHITECTURE_INTELLIGENCE_CACHE_FILE = "architecture-intelligence.json";

// Synthesis is a pure function over already-cached evidence (repository-model,
// workflow-graphs, terraform-topologies) — it never re-scans the repo and
// never calls a model. `rvs inspect` (and optionally `rvs create workflow`/
// `rvs create topology`) must run first; this command only combines what is
// already on disk in .rvs/cache/.
export async function runSynthesizeArchitecture(repoRoot: string, logger: Logger): Promise<void> {
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const workflowGraphs = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, "workflow-graphs.json") ?? [];
  const terraformTopologies = readCachedJsonOptional<TerraformTopology[]>(repoRoot, "terraform-topologies.json") ?? [];

  if (workflowGraphs.length === 0 && terraformTopologies.length === 0) {
    logger.warn("No cached workflow graphs or Terraform topologies found. Run `rvs create workflow --all` / `rvs create topology --all` first for a richer synthesis.");
  }

  const artifact = synthesizeArchitectureIntelligence({
    model,
    workflowGraphs,
    terraformTopologies,
    gitCommit: model.git.commit,
    generatedAt: model.generated_at,
  });

  let errorCount = 0;
  let warningCount = 0;
  for (const warning of validateArchitectureIntelligenceStructure(artifact)) {
    if (warning.severity === "error") {
      logger.error(`${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else {
      logger.warn(`${warning.code}: ${warning.message}`);
      warningCount += 1;
    }
  }

  mkdirSync(cacheDir(repoRoot), { recursive: true });
  writeFileSync(resolve(cacheDir(repoRoot), ARCHITECTURE_INTELLIGENCE_CACHE_FILE), JSON.stringify(artifact, null, 2));

  logger.info(
    `Synthesized architecture intelligence for "${artifact.identity.name.displayLabel}" (${artifact.components.length} components, ${artifact.flows.length} flows, ${errorCount} error(s), ${warningCount} warning(s)).`,
  );
  logger.info(`Cached to .rvs/cache/${ARCHITECTURE_INTELLIGENCE_CACHE_FILE}`);
}
