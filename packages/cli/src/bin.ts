#!/usr/bin/env node
import { createLogger } from "@rvs/core";
import { Command } from "commander";
import { runBrief } from "./commands/brief.js";
import { runCapabilitiesExplain } from "./commands/capabilities-explain.js";
import { runCreateSlides } from "./commands/create-slides.js";
import { runCreateTopology } from "./commands/create-topology.js";
import { runCreateWorkflow } from "./commands/create-workflow.js";
import { runDecisionsAnalyze } from "./commands/decisions-analyze.js";
import { runDecisionsCompare } from "./commands/decisions-compare.js";
import { runDecisionsExplain } from "./commands/decisions-explain.js";
import { runDecisionsValidate } from "./commands/decisions-validate.js";
import { runDoctor } from "./commands/doctor.js";
import { runExportCapabilities } from "./commands/export-capabilities.js";
import { runExportDecisionReport } from "./commands/export-decision-report.js";
import { runExportDecisionSummary } from "./commands/export-decision-summary.js";
import { runExportPdf } from "./commands/export-pdf.js";
import { runExportPortfolioClaims } from "./commands/export-portfolio-claims.js";
import { runExportPortfolioDecisions } from "./commands/export-portfolio-decisions.js";
import { runExportPortfolioModel } from "./commands/export-portfolio-model.js";
import { runExportProductIdentity } from "./commands/export-product-identity.js";
import { runExportGovernanceReport } from "./commands/export-governance-report.js";
import { runExportGovernanceSummary } from "./commands/export-governance-summary.js";
import { runExportShowcasePlan } from "./commands/export-showcase-plan.js";
import { runGovernanceBaselineSet, runGovernanceBaselineShow, runGovernanceBaselineValidate } from "./commands/governance-baseline.js";
import { runGovernanceCheck } from "./commands/governance-check.js";
import { runGovernanceCompare } from "./commands/governance-compare.js";
import { runGovernanceExplain } from "./commands/governance-explain.js";
import { runInit } from "./commands/init.js";
import { runInspect } from "./commands/inspect.js";
import { runPortfolioExplain } from "./commands/portfolio-explain.js";
import { runShowcaseExplain } from "./commands/showcase-explain.js";
import { runSkillPath } from "./commands/skill.js";
import { runSnapshotCreate } from "./commands/snapshot-create.js";
import { runSynthesizeArchitecture } from "./commands/synthesize-architecture.js";
import { runSynthesizeCapabilities } from "./commands/synthesize-capabilities.js";
import { runSynthesizePortfolio } from "./commands/synthesize-portfolio.js";
import { runSynthesizeProductIdentity } from "./commands/synthesize-product-identity.js";
import { runValidate } from "./commands/validate.js";
import { CLI_VERSION } from "./version.js";

const logger = createLogger();
const program = new Command();

program
  .name("rvs")
  .description("Repo Visual Studio — turn repository evidence into visual artifacts")
  .version(CLI_VERSION);

program
  .command("init")
  .description("Write a default .rvs/config.yml")
  .action(() => {
    runInit(process.cwd(), logger);
  });

program
  .command("inspect")
  .description("Scan the repository and build the evidence manifest")
  .action(async () => {
    await runInspect(process.cwd(), logger);
  });

program
  .command("brief")
  .description("Build a deterministic narrative brief from scanned evidence")
  .option("--audience <id>", "audience profile (executive|architecture-review)")
  .action(async (opts: { audience?: string }) => {
    await runBrief(process.cwd(), opts.audience, logger);
  });

const create = program.command("create").description("Create visual artifacts");
create
  .command("slides")
  .description("Render the narrative brief to a standalone HTML deck")
  .option("--design-system <id>", "design system id (executive-dark|editorial-light|technical-grid)")
  .option(
    "--profile <id>",
    "narrative profile (repository-inventory|executive-overview|architecture-review|engineering-onboarding|operating-review|repository-audit|showcase|portfolio|governance|decisions); default: repository-inventory",
  )
  .option(
    "--audience <id>",
    "showcase/portfolio audience (executive|product_leader|platform_leader|architect|engineering_leader|developer|operator|portfolio|conference); only used with --profile showcase|portfolio",
  )
  .option("--theme <id>", "showcase/portfolio theme id stamped into the plan; only used with --profile showcase|portfolio (default: the --design-system id)")
  .action(async (opts: { designSystem?: string; profile?: string; audience?: string; theme?: string }) => {
    await runCreateSlides(process.cwd(), opts.designSystem, logger, opts.profile, { audience: opts.audience, theme: opts.theme });
  });

create
  .command("workflow")
  .description("Parse GitHub Actions workflow(s) into a WorkflowGraph and render Mermaid/SVG diagrams")
  .option("--source <path>", "a single workflow file to parse, relative to the repo root")
  .option("--all", "discover and process every .github/workflows/*.yml|yaml file")
  .option("--renderer <kind>", "mermaid|svg|both (default: both)")
  .option("--output <dir>", "output directory (default: <output_dir>/workflows)")
  .option("--format <kind>", "additionally emit a scoped VisualDoc JSON per graph: visualdoc")
  .action(async (opts: { source?: string; all?: boolean; renderer?: string; output?: string; format?: string }) => {
    if (opts.renderer && !["mermaid", "svg", "both"].includes(opts.renderer)) {
      throw new Error(`Invalid --renderer "${opts.renderer}"; expected mermaid, svg, or both.`);
    }
    if (opts.format && opts.format !== "visualdoc") {
      throw new Error(`Invalid --format "${opts.format}"; expected visualdoc.`);
    }
    await runCreateWorkflow(
      process.cwd(),
      {
        source: opts.source,
        all: opts.all,
        renderer: opts.renderer as "mermaid" | "svg" | "both" | undefined,
        output: opts.output,
        format: opts.format as "visualdoc" | undefined,
      },
      logger,
    );
  });

create
  .command("topology")
  .description("Parse Terraform root module(s) into a TerraformTopology and render Mermaid/SVG diagrams")
  .option("--source <path>", "a single root module directory to parse, relative to the repo root")
  .option("--all", "discover and process every root Terraform module in the repository")
  .option("--renderer <kind>", "mermaid|svg|both (default: both)")
  .option("--output <dir>", "output directory (default: <output_dir>/topologies)")
  .option("--format <kind>", "additionally emit a scoped VisualDoc JSON per topology: visualdoc")
  .action(async (opts: { source?: string; all?: boolean; renderer?: string; output?: string; format?: string }) => {
    if (opts.renderer && !["mermaid", "svg", "both"].includes(opts.renderer)) {
      throw new Error(`Invalid --renderer "${opts.renderer}"; expected mermaid, svg, or both.`);
    }
    if (opts.format && opts.format !== "visualdoc") {
      throw new Error(`Invalid --format "${opts.format}"; expected visualdoc.`);
    }
    await runCreateTopology(
      process.cwd(),
      {
        source: opts.source,
        all: opts.all,
        renderer: opts.renderer as "mermaid" | "svg" | "both" | undefined,
        output: opts.output,
        format: opts.format as "visualdoc" | undefined,
      },
      logger,
    );
  });

const synthesize = program.command("synthesize").description("Synthesize higher-level artifacts from cached evidence");
synthesize
  .command("architecture")
  .description("Synthesize an ArchitectureIntelligence artifact from cached repository/workflow/Terraform evidence")
  .action(async () => {
    await runSynthesizeArchitecture(process.cwd(), logger);
  });

synthesize
  .command("capabilities")
  .description("Synthesize an evidence-gated CapabilityModel from the cached ArchitectureIntelligence artifact")
  .action(async () => {
    await runSynthesizeCapabilities(process.cwd(), logger);
  });

synthesize
  .command("product-identity")
  .description("Synthesize a ProductIdentityModel from the cached CapabilityModel and ArchitectureIntelligence artifact")
  .action(async () => {
    await runSynthesizeProductIdentity(process.cwd(), logger);
  });

synthesize
  .command("portfolio")
  .description("Combine each product listed in .rvs/portfolio.yml's already-generated artifacts into a single evidence-backed PortfolioModel")
  .option("--allow-partial", "continue with only the compatible products instead of failing when any product is incompatible")
  .action(async (opts: { allowPartial?: boolean }) => {
    await runSynthesizePortfolio(process.cwd(), { allowPartial: opts.allowPartial }, logger);
  });

program
  .command("validate")
  .description("Run deterministic visual-quality checks against the rendered deck")
  .option("--ci", "exit non-zero when a check fails the configured quality policy")
  .action(async (opts: { ci?: boolean }) => {
    await runValidate(process.cwd(), Boolean(opts.ci), logger);
  });

const snapshot = program.command("snapshot").description("Capture governance intelligence snapshots");
snapshot
  .command("create")
  .description("Build an IntelligenceSnapshot fingerprint from cached architecture/capability/product(/portfolio) artifacts")
  .option("--name <id>", "snapshot filename/id to write under .rvs/cache/governance/snapshots/ (default: the snapshot's own derived id)")
  .option("--output <path>", "additionally write a copy of the snapshot to this path")
  .option("--include-portfolio", "also fingerprint the cached portfolio-model.json")
  .option("--allow-partial", "proceed even when architecture/capability/product artifacts are missing")
  .action(async (opts: { name?: string; output?: string; includePortfolio?: boolean; allowPartial?: boolean }) => {
    await runSnapshotCreate(process.cwd(), opts, logger);
  });

const governance = program.command("governance").description("Compare governance intelligence snapshots and evaluate policy");

const governanceBaseline = governance.command("baseline").description("Manage the governance baseline snapshot");
governanceBaseline
  .command("show")
  .description("Print the currently configured governance baseline")
  .action(async () => {
    await runGovernanceBaselineShow(process.cwd(), logger);
  });
governanceBaseline
  .command("set")
  .description("Promote a snapshot to the new governance baseline")
  .argument("<snapshot>", "snapshot id/filename under .rvs/cache/governance/snapshots/, or a path")
  .option("--force", "proceed even when the new baseline is incompatible with the prior one")
  .action(async (snapshotRef: string, opts: { force?: boolean }) => {
    await runGovernanceBaselineSet(process.cwd(), snapshotRef, opts, logger);
  });
governanceBaseline
  .command("validate")
  .description("Validate the currently configured governance baseline's schema compatibility")
  .action(async () => {
    await runGovernanceBaselineValidate(process.cwd(), logger);
  });

governance
  .command("compare")
  .description("Diff the configured baseline (or --from) against the current repository state (or --to), evaluate policy, and cache a governance report")
  .option("--from <snapshot>", "source snapshot id/filename/path (default: the configured baseline)")
  .option("--to <snapshot>", "target snapshot id/filename/path (default: a freshly built snapshot of the current cached artifacts)")
  .action(async (opts: { from?: string; to?: string }) => {
    await runGovernanceCompare(process.cwd(), opts, logger);
  });

governance
  .command("check")
  .description("Same comparison as `governance compare`, with concise output; --ci fails the build on un-excepted findings at or above the configured fail_on severity")
  .option("--from <snapshot>", "source snapshot id/filename/path (default: the configured baseline)")
  .option("--to <snapshot>", "target snapshot id/filename/path (default: a freshly built snapshot of the current cached artifacts)")
  .option("--ci", "exit non-zero when an un-excepted finding's severity is in the configured fail_on list")
  .action(async (opts: { from?: string; to?: string; ci?: boolean }) => {
    await runGovernanceCheck(process.cwd(), opts, logger);
  });

governance
  .command("explain")
  .description("Print a human-readable explanation for a governance change/finding/evaluation/blast-radius/snapshot/baseline/narrative/plan/scene id")
  .argument("<id>", "id to explain")
  .action(async (id: string) => {
    await runGovernanceExplain(process.cwd(), id, logger);
  });

const decisions = program.command("decisions").description("Analyze architecture decision records and evaluate their links, supersession, conflicts, drift, and debt");

decisions
  .command("analyze")
  .description("Discover, classify, and link decision documents, then cache the full decision-intelligence artifact set")
  .action(async () => {
    await runDecisionsAnalyze(process.cwd(), {}, logger);
  });

decisions
  .command("validate")
  .description("Same analysis as `decisions analyze`, then run deterministic validation checks against the resulting artifacts")
  .option("--ci", "exit non-zero when any validation finding's severity is \"error\"")
  .action(async (opts: { ci?: boolean }) => {
    await runDecisionsValidate(process.cwd(), opts, logger);
  });

decisions
  .command("compare")
  .description("Diff a prior decision snapshot against another snapshot (or a freshly analyzed one) and cache the change set")
  .option("--from <path>", "path to a prior decision-snapshot.json (required)")
  .option("--to <path>", "path to another decision-snapshot.json (default: a fresh `rvs decisions analyze` run)")
  .action(async (opts: { from?: string; to?: string }) => {
    await runDecisionsCompare(process.cwd(), opts, logger);
  });

decisions
  .command("explain")
  .description("Print a human-readable explanation for a decision/assumption/consequence/link/conflict/drift/debt/coverage/implementation-state/change/supersession-chain id")
  .argument("<id>", "id to explain")
  .action(async (id: string) => {
    await runDecisionsExplain(process.cwd(), id, logger);
  });

const exportCmd = program.command("export").description("Export the deck to another format");
exportCmd
  .command("pdf")
  .description("Export the deck to a paginated PDF")
  .action(async () => {
    await runExportPdf(process.cwd(), logger);
  });

exportCmd
  .command("capabilities")
  .description("Render the synthesized, evidence-gated CapabilityModel to CAPABILITIES.md")
  .option("--output <path>", "output path (default: CAPABILITIES.md)")
  .option("--include-partial", "include the 'Available with limitations' section (default: on)")
  .option("--no-include-partial", "omit the 'Available with limitations' section")
  .option("--include-gaps", "include the 'Known capability gaps' section (default: on)")
  .option("--no-include-gaps", "omit the 'Known capability gaps' section")
  .option("--include-roadmap", "include an opt-in 'Roadmap' section (default: off)")
  .option("--include-excluded", "include an opt-in 'Excluded candidates' diagnostics section and capability-exclusions.json (default: off)")
  .action(async (opts: { output?: string; includePartial?: boolean; includeGaps?: boolean; includeRoadmap?: boolean; includeExcluded?: boolean }) => {
    await runExportCapabilities(process.cwd(), opts, logger);
  });

exportCmd
  .command("product-identity")
  .description("Write the synthesized ProductIdentityModel to product-identity.json")
  .option("--output <path>", "output path (default: product-identity.json)")
  .action(async (opts: { output?: string }) => {
    await runExportProductIdentity(process.cwd(), opts, logger);
  });

exportCmd
  .command("showcase-plan")
  .description("Write the synthesized ShowcasePlan (including its ExecutiveNarrative and claims) to showcase-plan.json")
  .option("--output <path>", "output path (default: showcase-plan.json)")
  .action(async (opts: { output?: string }) => {
    await runExportShowcasePlan(process.cwd(), opts, logger);
  });

exportCmd
  .command("portfolio-model")
  .description("Write the synthesized PortfolioModel to portfolio-model.json")
  .option("--output <path>", "output path (default: portfolio-model.json)")
  .action(async (opts: { output?: string }) => {
    await runExportPortfolioModel(process.cwd(), opts, logger);
  });

exportCmd
  .command("portfolio-claims")
  .description("Write the synthesized portfolio claims (approved, qualified, and rejected) to portfolio-claims.json")
  .option("--output <path>", "output path (default: portfolio-claims.json)")
  .action(async (opts: { output?: string }) => {
    await runExportPortfolioClaims(process.cwd(), opts, logger);
  });

exportCmd
  .command("portfolio-decisions")
  .description("Write the synthesized portfolio decisions to portfolio-decisions.json")
  .option("--output <path>", "output path (default: portfolio-decisions.json)")
  .action(async (opts: { output?: string }) => {
    await runExportPortfolioDecisions(process.cwd(), opts, logger);
  });

exportCmd
  .command("governance-report")
  .description("Write the cached continuous intelligence report to governance-report.json")
  .option("--output <path>", "output path (default: governance-report.json)")
  .action(async (opts: { output?: string }) => {
    await runExportGovernanceReport(process.cwd(), opts, logger);
  });

exportCmd
  .command("governance-summary")
  .description("Write a PR-paste-ready Markdown governance summary to governance-summary.md")
  .option("--output <path>", "output path (default: governance-summary.md)")
  .action(async (opts: { output?: string }) => {
    await runExportGovernanceSummary(process.cwd(), opts, logger);
  });

exportCmd
  .command("decision-report")
  .description("Write the cached decision intelligence report to decision-report.json")
  .option("--output <path>", "output path (default: decision-report.json)")
  .action(async (opts: { output?: string }) => {
    await runExportDecisionReport(process.cwd(), opts, logger);
  });

exportCmd
  .command("decision-summary")
  .description("Write a PR-paste-ready Markdown decision summary to decision-summary.md")
  .option("--output <path>", "output path (default: decision-summary.md)")
  .action(async (opts: { output?: string }) => {
    await runExportDecisionSummary(process.cwd(), opts, logger);
  });

const capabilities = program.command("capabilities").description("Inspect the synthesized capability model");
capabilities
  .command("explain")
  .description("Print full evidence, readiness, and inclusion detail for a single capability or excluded candidate")
  .argument("<capability-id>", "capability id or display name")
  .action(async (capabilityId: string) => {
    await runCapabilitiesExplain(process.cwd(), capabilityId, logger);
  });

const showcase = program.command("showcase").description("Inspect the synthesized showcase plan");
showcase
  .command("explain")
  .description("Print the text, status, qualifiers, rejection reasons, and evidence for a single showcase claim")
  .argument("<claim-id>", "claim id")
  .action(async (claimId: string) => {
    await runShowcaseExplain(process.cwd(), claimId, logger);
  });

const portfolio = program.command("portfolio").description("Inspect the synthesized portfolio model");
portfolio
  .command("explain")
  .description("Print full evidence, qualifiers, rejection reasons, and rationale for a single portfolio claim or decision")
  .argument("<id>", "claim id or decision id")
  .action(async (id: string) => {
    await runPortfolioExplain(process.cwd(), id, logger);
  });

program
  .command("doctor")
  .description("Check local environment prerequisites (Node, config, Playwright browsers)")
  .action(async () => {
    await runDoctor(process.cwd(), logger);
  });

const skill = program.command("skill").description("Inspect the packaged agent skill");
skill
  .command("path")
  .description("Print the filesystem path of the packaged repo-visual-studio agent skill")
  .action(() => {
    runSkillPath(logger);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
