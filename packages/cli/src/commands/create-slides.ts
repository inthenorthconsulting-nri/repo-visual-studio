import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArchitectureIntelligence, NarrativeProfileId } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { EvidenceManifest, Logger, RvsConfig } from "@rvs/core";
import { loadConfig } from "@rvs/core";
import { GOVERNANCE_OUTPUT_FILES } from "@rvs/governance-intelligence";
import type { GovernancePlan } from "@rvs/governance-intelligence";
import { buildArchitectureVisualDoc, buildCapabilityIntelligenceScenes, buildGovernanceVisualDoc, buildPortfolioVisualDoc, buildShowcaseVisualDoc, buildVisualDoc, parseBrief } from "@rvs/narrative-planner";
import type {
  AudienceType,
  ProductIdentityModel,
  ShowcasePlan,
} from "@rvs/product-intelligence";
import { loadProductIdentityOverride, synthesizeExecutiveNarrative, synthesizeShowcasePlan, validateShowcasePlan } from "@rvs/product-intelligence";
import type { PortfolioClaim, PortfolioModel, PortfolioPlan } from "@rvs/portfolio-intelligence";
import { synthesizePortfolioNarrative, synthesizePortfolioPlan, validatePortfolioPlan } from "@rvs/portfolio-intelligence";
import type { DesignTokens } from "@rvs/renderer-html";
import { loadDesignTokens, renderVisualDocToHtml } from "@rvs/renderer-html";
import type { RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { runArchitectureIntelligenceChecks } from "@rvs/validator";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { cacheDir, readCachedJson, readCachedJsonOptional } from "../cache.js";
import { readGovernanceCachedJsonOptional } from "../governance-cache.js";
import { DESIGN_SYSTEMS_ROOT } from "../paths.js";

// "repository-inventory" is the default and preserves `rvs create slides`'s
// pre-Milestone-3 behavior byte-for-byte: buildVisualDoc() off the narrative
// brief, no architecture-intelligence synthesis required. Any other profile
// switches to buildArchitectureVisualDoc() off a cached ArchitectureIntelligence
// artifact (produced by `rvs synthesize architecture`). "showcase" (Milestone 5)
// is a third, separate path: it never touches the narrative brief or
// ArchitectureIntelligence narrative profiles at all — it is built entirely
// from the cached ProductIdentityModel plus a freshly synthesized
// ExecutiveNarrative/ShowcasePlan for the requested audience/theme.
const DEFAULT_PROFILE: NarrativeProfileId = "repository-inventory";
const SHOWCASE_PROFILE = "showcase";
const DEFAULT_SHOWCASE_AUDIENCE: AudienceType = "executive";
// "portfolio" (Milestone 6) mirrors "showcase": narrative/claims/plan are
// audience-dependent, so they are synthesized fresh on every run rather than
// replayed from a single cached artifact. Unlike "showcase" it never
// re-derives the model+claims themselves (those are pure over the artifact
// roots listed in .rvs/portfolio.yml and are produced once by
// `rvs synthesize portfolio`) — only the narrative/plan step is redone here.
const PORTFOLIO_PROFILE = "portfolio";
const DEFAULT_PORTFOLIO_AUDIENCE: AudienceType = "portfolio";
// "governance" (Milestone 7) is the simplest of the three cached-artifact
// profiles: unlike showcase/portfolio it never synthesizes anything fresh
// here — a governance comparison is never audience-scoped (it is an
// inspection/comparison report, not a narrative tailored to a reader), so
// this profile just reads the already-cached GovernancePlan (produced by
// `rvs governance compare`/`rvs governance check`, the only commands that
// run the diff engines + policy evaluation) and renders it directly.
const GOVERNANCE_PROFILE = "governance";

export interface CreateSlidesOptions {
  audience?: string;
  theme?: string;
}

export async function runCreateSlides(
  repoRoot: string,
  designSystemId: string | undefined,
  logger: Logger,
  profileId: string = DEFAULT_PROFILE,
  options: CreateSlidesOptions = {},
): Promise<void> {
  const config = loadConfig(repoRoot);
  const model = readCachedJson<RepositoryModel>(repoRoot, "repository-model.json");
  const evidence = readCachedJson<EvidenceManifest>(repoRoot, "evidence-manifest.json");

  const themeId = designSystemId ?? config.defaults.design_system;
  const tokens = loadDesignTokens(DESIGN_SYSTEMS_ROOT, themeId);
  const workflowGraphs = readCachedJsonOptional<WorkflowGraph[]>(repoRoot, "workflow-graphs.json") ?? [];
  const terraformTopologies = readCachedJsonOptional<TerraformTopology[]>(repoRoot, "terraform-topologies.json") ?? [];

  if (profileId === SHOWCASE_PROFILE) {
    await runCreateShowcaseSlides(repoRoot, model, evidence, tokens, themeId, workflowGraphs, terraformTopologies, options, config, logger);
    return;
  }

  if (profileId === PORTFOLIO_PROFILE) {
    await runCreatePortfolioSlides(repoRoot, model, evidence, tokens, themeId, options, config, logger);
    return;
  }

  if (profileId === GOVERNANCE_PROFILE) {
    await runCreateGovernanceSlides(repoRoot, model, evidence, tokens, themeId, config, logger);
    return;
  }

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

const SHOWCASE_AUDIENCES: readonly AudienceType[] = [
  "executive",
  "product_leader",
  "platform_leader",
  "architect",
  "engineering_leader",
  "developer",
  "operator",
  "portfolio",
  "conference",
];

function resolveShowcaseAudience(raw: string | undefined): AudienceType {
  if (!raw) return DEFAULT_SHOWCASE_AUDIENCE;
  if (!(SHOWCASE_AUDIENCES as readonly string[]).includes(raw)) {
    throw new Error(`Invalid --audience "${raw}"; expected one of: ${SHOWCASE_AUDIENCES.join(", ")}.`);
  }
  return raw as AudienceType;
}

// The "showcase" profile (Milestone 5) is deliberately isolated from the
// repository-inventory/architecture-review branches above: it never reads
// the narrative brief or an ArchitectureIntelligence artifact, and it is the
// only profile that synthesizes fresh, audience-scoped content
// (ExecutiveNarrative + ShowcasePlan) on every run rather than replaying a
// single cached artifact — narrative/claims are audience-dependent, so they
// cannot be produced once by `rvs synthesize product-identity` the way the
// archetype-independent ProductIdentityModel is.
async function runCreateShowcaseSlides(
  repoRoot: string,
  model: RepositoryModel,
  evidence: EvidenceManifest,
  tokens: DesignTokens,
  designSystemId: string,
  workflowGraphs: WorkflowGraph[],
  terraformTopologies: TerraformTopology[],
  options: CreateSlidesOptions,
  config: RvsConfig,
  logger: Logger,
): Promise<void> {
  const identityModel = readCachedJsonOptional<ProductIdentityModel>(repoRoot, "product-identity-model.json");
  if (!identityModel) {
    throw new Error('No cached product identity found. Run `rvs synthesize product-identity` first.');
  }
  const capabilityModel = readCachedJson<CapabilityModel>(repoRoot, "capability-model.json");
  const override = loadProductIdentityOverride(repoRoot);

  const audience = resolveShowcaseAudience(options.audience);
  const theme = options.theme ?? designSystemId;

  const { narrative, claims } = synthesizeExecutiveNarrative({ identityModel, capabilityModel, override, audience });
  const plan: ShowcasePlan = synthesizeShowcasePlan({
    identityModel,
    narrative,
    claims,
    capabilityModel,
    audience,
    theme,
    gitCommit: model.git.commit,
    generatedAt: new Date().toISOString(),
  });

  for (const warning of validateShowcasePlan(plan, capabilityModel)) {
    if (warning.severity === "error") logger.error(`${warning.code}: ${warning.message}`);
    else logger.warn(`${warning.code}: ${warning.message}`);
  }

  const doc = buildShowcaseVisualDoc(plan);

  const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: model.git.commit }, workflowGraphs, terraformTopologies, [], [capabilityModel], [plan]);

  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "deck.html"), html);
  writeFileSync(resolve(cacheDir(repoRoot), "visualdoc.json"), JSON.stringify(doc, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), "showcase-plan.json"), JSON.stringify(plan, null, 2));

  logger.info(
    `Rendered ${doc.scenes.length} showcase scenes to ${config.defaults.output_dir}/deck.html using "${designSystemId}" (audience: "${audience}", theme: "${theme}")`,
  );
  logger.info(`Cached to .rvs/cache/showcase-plan.json`);
}

// The "portfolio" profile (Milestone 6) reads the already-synthesized
// PortfolioModel/PortfolioClaims caches (produced by `rvs synthesize
// portfolio`, which is the only step that re-touches the artifact roots
// listed in .rvs/portfolio.yml) and, like showcase, builds a fresh
// audience-scoped PortfolioNarrative/PortfolioPlan on every run.
async function runCreatePortfolioSlides(
  repoRoot: string,
  model: RepositoryModel,
  evidence: EvidenceManifest,
  tokens: DesignTokens,
  designSystemId: string,
  options: CreateSlidesOptions,
  config: RvsConfig,
  logger: Logger,
): Promise<void> {
  const portfolioModel = readCachedJsonOptional<PortfolioModel>(repoRoot, "portfolio-model.json");
  if (!portfolioModel) {
    throw new Error("No cached portfolio model found. Run `rvs synthesize portfolio` first.");
  }
  const portfolioClaims = readCachedJson<PortfolioClaim[]>(repoRoot, "portfolio-claims.json");

  const audience = resolveShowcaseAudience(options.audience ?? DEFAULT_PORTFOLIO_AUDIENCE);
  const theme = options.theme ?? designSystemId;

  const narrative = synthesizePortfolioNarrative(portfolioModel, portfolioClaims);
  const plan: PortfolioPlan = synthesizePortfolioPlan({
    model: portfolioModel,
    narrative,
    claims: portfolioClaims,
    audience,
    theme,
    generatedAt: new Date().toISOString(),
  });

  for (const warning of validatePortfolioPlan(plan)) {
    if (warning.severity === "error") logger.error(`${warning.code}: ${warning.message}`);
    else logger.warn(`${warning.code}: ${warning.message}`);
  }

  const doc = buildPortfolioVisualDoc(plan);

  const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: model.git.commit }, [], [], [], [], [], [plan]);

  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "deck.html"), html);
  writeFileSync(resolve(cacheDir(repoRoot), "visualdoc.json"), JSON.stringify(doc, null, 2));
  writeFileSync(resolve(cacheDir(repoRoot), "portfolio-plan.json"), JSON.stringify(plan, null, 2));

  logger.info(
    `Rendered ${doc.scenes.length} portfolio scenes to ${config.defaults.output_dir}/deck.html using "${designSystemId}" (audience: "${audience}", theme: "${theme}")`,
  );
  logger.info(`Cached to .rvs/cache/portfolio-plan.json`);
}

// The "governance" profile (Milestone 7) reads the already-computed
// GovernancePlan cache directly rather than synthesizing anything fresh —
// unlike showcase/portfolio's audience-scoped narrative/plan step, a
// governance comparison is a single deterministic artifact of the two
// snapshots being compared, not something re-derived per reader. This
// profile intentionally skips --audience entirely (buildGovernanceVisualDoc
// hardcodes audience: "governance", theme: "technical-grid" -- see
// governance-visualdoc-builder.ts's doc comment) and only honors
// --design-system/--theme for the overall deck's visual theme.
async function runCreateGovernanceSlides(
  repoRoot: string,
  model: RepositoryModel,
  evidence: EvidenceManifest,
  tokens: DesignTokens,
  designSystemId: string,
  config: RvsConfig,
  logger: Logger,
): Promise<void> {
  const plan = readGovernanceCachedJsonOptional<GovernancePlan>(repoRoot, GOVERNANCE_OUTPUT_FILES.governancePlan);
  if (!plan) {
    throw new Error("No cached governance plan found. Run `rvs governance compare` first.");
  }

  const doc = buildGovernanceVisualDoc(plan);

  const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: model.git.commit }, [], [], [], [], [], [], [plan]);

  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "deck.html"), html);
  writeFileSync(resolve(cacheDir(repoRoot), "visualdoc.json"), JSON.stringify(doc, null, 2));

  logger.info(`Rendered ${doc.scenes.length} governance scenes to ${config.defaults.output_dir}/deck.html using "${designSystemId}"`);
}
