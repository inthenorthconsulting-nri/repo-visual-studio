#!/usr/bin/env node
import { createLogger } from "@rvs/core";
import { Command } from "commander";
import { runBrief } from "./commands/brief.js";
import { runCreateSlides } from "./commands/create-slides.js";
import { runCreateTopology } from "./commands/create-topology.js";
import { runCreateWorkflow } from "./commands/create-workflow.js";
import { runDoctor } from "./commands/doctor.js";
import { runExportPdf } from "./commands/export-pdf.js";
import { runInit } from "./commands/init.js";
import { runInspect } from "./commands/inspect.js";
import { runSkillPath } from "./commands/skill.js";
import { runSynthesizeArchitecture } from "./commands/synthesize-architecture.js";
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
    "narrative profile (repository-inventory|executive-overview|architecture-review|engineering-onboarding|operating-review|repository-audit); default: repository-inventory",
  )
  .action(async (opts: { designSystem?: string; profile?: string }) => {
    await runCreateSlides(process.cwd(), opts.designSystem, logger, opts.profile);
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
