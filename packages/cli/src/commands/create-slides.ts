import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArchitectureIntelligence, NarrativeProfileId } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { EvidenceManifest, Logger } from "@rvs/core";
import { loadConfig } from "@rvs/core";
import { buildArchitectureVisualDoc, buildCapabilityIntelligenceScenes, buildVisualDoc, parseBrief } from "@rvs/narrative-planner";
import { loadDesignTokens, renderVisualDocToHtml } from "@rvs/renderer-html";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { runArchitectureIntelligenceChecks } from "@rvs/validator";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { cacheDir, readCachedJson, readCachedJsonOptional } from "../cache.js";
import { DESIGN_SYSTEMS_ROOT } from "../paths.js";

// "repository-inventory" is the default and preserves `rvs create slides`'s
// pre-Milestone-3 behavior byte-for-byte: buildVisualDoc() off the narrative
// brief, no architecture-intelligence synthesis required. Any other profile
// switches to buildArchitectureVisualDoc() off a cached ArchitectureIntelligence
// artifact (produced by `rvs synthesize architecture`).
const DEFAULT_PROFILE: NarrativeProfileId = "repository-inventory";

export async function runCreateSlides(
  repoRoot: string,
  designSystemId: string | undefined,
  logger: Logger,
  profileId: string = DEFAULT_PROFILE,
): Promise<void> {
  const config = loadConfig(repoRoot);
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const evidence = readCachedJson<EvidenceManifest>(repoRoot, "evidence-manifest.json");

  const themeId = designSystemId ?? config.defaults.design_system;
  const tokens = loadDesignTokens(DESIGN_SYSTEMS_ROOT, themeId);
  const workflowGraphs = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, "workflow-graphs.json") ?? [];
  const terraformTopologies = readCachedJsonOptional<TerraformTopology[]>(repoRoot, "terraform-topologies.json") ?? [];

  let doc;
  let architectureArtifacts: ArchitectureIntelligence[] = [];
  if (profileId === DEFAULT_PROFILE) {
    const briefPath = resolve(cacheDir(repoRoot), "narrative-brief.yml");
    if (!existsSync(briefPath)) {
      throw new Error("No narrative brief found. Run `rvs brief` first.");
    }
    const brief = parseBrief(readFileSync(briefPath, "utf8"));
    doc = buildVisualDoc(model, evidence, brief, themeId, workflowGraphs, terraformTopologies);
  } else {
    const artifact = readCachedJsonOptional<ArchitectureIntelligence>(repoRoot, "architecture-intelligence.json");
    if (!artifact) {
      throw new Error(`No cached architecture intelligence found. Run \`rvs synthesize architecture\` first, or omit --profile to use "${DEFAULT_PROFILE}".`);
    }
    architectureArtifacts = [artifact];
    doc = buildArchitectureVisualDoc(artifact, profileId, themeId, workflowGraphs, terraformTopologies);
  }

  // Capability intelligence (Milestone 4) is entirely additive/optional: a
  // repo that hasn't run `rvs synthesize capabilities` yet must still render
  // an identical deck to before this feature existed. When the cache is
  // present, append one capability-intelligence-overview scene and thread
  // the model through to the renderer the same way architectureArtifacts is.
  const capabilityModel = readCachedJsonOptional<CapabilityModel>(repoRoot, "capability-model.json");
  const capabilityModels: CapabilityModel[] = capabilityModel ? [capabilityModel] : [];
  if (capabilityModel) {
    doc.scenes.push(...buildCapabilityIntelligenceScenes(capabilityModel));
  }

  const html = renderVisualDocToHtml(
    doc,
    tokens,
    evidence,
    { gitCommit: model.git.commit },
    workflowGraphs,
    terraformTopologies,
    architectureArtifacts,
    capabilityModels,
  );

  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "deck.html"), html);
  writeFileSync(resolve(cacheDir(repoRoot), "visualdoc.json"), JSON.stringify(doc, null, 2));

  // Architecture-intelligence checks (label-integrity, word-budget, staleness)
  // only apply to the synthesized-narrative profiles; the legacy
  // repository-inventory path never emits architecture-intelligence scenes.
  for (const artifact of architectureArtifacts) {
    const checkWarnings = runArchitectureIntelligenceChecks({ doc, artifact, html, currentModel: model });
    for (const warning of checkWarnings) {
      if (warning.severity === "error") logger.error(`${warning.code}: ${warning.message}`);
      else logger.warn(`${warning.code}: ${warning.message}`);
    }
  }

  logger.info(
    `Rendered ${doc.scenes.length} scenes to ${config.defaults.output_dir}/deck.html using "${themeId}" (profile: "${profileId}")`,
  );
}
