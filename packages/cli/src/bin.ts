#!/usr/bin/env node
import { createLogger } from "@rvs/core";
import { Command } from "commander";
import { runBrief } from "./commands/brief.js";
import { runCapabilitiesExplain } from "./commands/capabilities-explain.js";
import { runCreateSlides } from "./commands/create-slides.js";
import { runCreateTopology } from "./commands/create-topology.js";
import { runCreateWorkflow } from "./commands/create-workflow.js";
import { runDoctor } from "./commands/doctor.js";
import { runExportCapabilities } from "./commands/export-capabilities.js";
import { runExportPdf } from "./commands/export-pdf.js";
import { runExportProductIdentity } from "./commands/export-product-identity.js";
import { runExportShowcasePlan } from "./commands/export-showcase-plan.js";
import { runInit } from "./commands/init.js";
import { runInspect } from "./commands/inspect.js";
import { runShowcaseExplain } from "./commands/showcase-explain.js";
import { runSkillPath } from "./commands/skill.js";
import { runSynthesizeArchitecture } from "./commands/synthesize-architecture.js";
import { runSynthesizeCapabilities } from "./commands/synthesize-capabilities.js";
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
    "narrative profile (repository-inventory|executive-overview|architecture-review|engineering-onboarding|operating-review|repository-audit|showcase); default: repository-inventory",
  )
  .option("--audience <id>", "showcase audience (executive|product_leader|platform_leader|architect|engineering_leader|developer|operator|portfolio|conference); only used with --profile showcase")
  .option("--theme <id>", "showcase theme id stamped into the ShowcasePlan; only used with --profile showcase (default: the --design-system id)")
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

program
  .command("validate")
  .description("Run deterministic visual-quality checks against the rendered deck")
  .option("--ci", "exit non-zero when a check fails the configured quality policy")
  .action(async (opts: { ci?: boolean }) => {
    await runValidate(process.cwd(), Boolean(opts.ci), logger);
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
