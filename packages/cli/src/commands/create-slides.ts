import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvidenceManifest, Logger } from "@rvs/core";
import { loadConfig } from "@rvs/core";
import { buildVisualDoc, parseBrief } from "@rvs/narrative-planner";
import { loadDesignTokens, renderVisualDocToHtml } from "@rvs/renderer-html";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { cacheDir, readCachedJson, readCachedJsonOptional } from "../cache.js";
import { DESIGN_SYSTEMS_ROOT } from "../paths.js";

export async function runCreateSlides(
  repoRoot: string,
  designSystemId: string | undefined,
  logger: Logger,
): Promise<void> {
  const config = loadConfig(repoRoot);
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const evidence = readCachedJson<EvidenceManifest>(repoRoot, "evidence-manifest.json");

  const briefPath = resolve(cacheDir(repoRoot), "narrative-brief.yml");
  if (!existsSync(briefPath)) {
    throw new Error("No narrative brief found. Run `rvs brief` first.");
  }
  const brief = parseBrief(readFileSync(briefPath, "utf8"));

  const themeId = designSystemId ?? config.defaults.design_system;
  const tokens = loadDesignTokens(DESIGN_SYSTEMS_ROOT, themeId);
  const workflowGraphs = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, "workflow-graphs.json") ?? [];
  const terraformTopologies = readCachedJsonOptional<TerraformTopology[]>(repoRoot, "terraform-topologies.json") ?? [];
  const doc = buildVisualDoc(model, evidence, brief, themeId, workflowGraphs, terraformTopologies);

  const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: model.git.commit }, workflowGraphs, terraformTopologies);

  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "deck.html"), html);
  writeFileSync(resolve(cacheDir(repoRoot), "visualdoc.json"), JSON.stringify(doc, null, 2));

  logger.info(
    `Rendered ${doc.scenes.length} scenes to ${config.defaults.output_dir}/deck.html using "${themeId}"`,
  );
}
