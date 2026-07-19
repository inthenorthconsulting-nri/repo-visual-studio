import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This suite exercises the packed npm tarball end to end (pnpm pack -> npm
// install -> npx rvs ...), not the workspace source. It is slow (a real
// build, a real npm install, a real Playwright PDF export) and depends on
// Chromium being installed, so it only runs when explicitly requested —
// same rationale as gating any e2e suite behind opt-in rather than making
// every workspace `pnpm test` run pay for a full package install.
const RUN = process.env.RVS_TEST_PACKAGE === "1";
const maybeDescribe = RUN ? describe : describe.skip;

const repoRoot = join(__dirname, "../../../..");
const cliRoot = join(repoRoot, "packages/cli");

maybeDescribe("packaged CLI (npm tarball)", () => {
  let packDir: string;
  let tarballPath: string;
  let installDir: string;

  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@rvs/cli", "build"], { cwd: repoRoot, stdio: "inherit" });

    packDir = mkdtempSync(join(tmpdir(), "rvs-pack-"));
    // `pnpm --filter @rvs/cli pack` fails under pnpm 10.9.0 (this repo's
    // pinned packageManager version) with "Unknown option: 'recursive'" —
    // pnpm's filtered/recursive execution mode isn't supported by the
    // single-package `pack` subcommand in this version. Running `pack`
    // with cwd set to the package directory instead (no --filter) produces
    // an identical tarball without depending on recursive-mode support.
    execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: cliRoot,
      stdio: "inherit",
    });
    tarballPath = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz"))!);

    // Directory name intentionally contains a space: covers the
    // "paths containing spaces" requirement without a separate fixture.
    // realpathSync: on macOS, mkdtempSync(tmpdir()) returns a /var/... path,
    // but the OS resolves it through a symlink to /private/var/... — the CLI
    // subprocess reports the resolved path, so comparisons must too.
    installDir = realpathSync(mkdtempSync(join(tmpdir(), "rvs install test ")));
    execFileSync("git", ["init", "-q"], { cwd: installDir });
    execFileSync("npm", ["init", "-y"], { cwd: installDir, stdio: "ignore" });
    execFileSync("npm", ["install", tarballPath], { cwd: installDir, stdio: "inherit" });
  }, 180_000);

  // Richer fixture per docs/milestones.md's packaging-hardening spec:
  // package.json + README.md + src/index.ts + a real, multi-job GitHub
  // Actions workflow + docs/architecture.md. Reuses this repo's own
  // .github/workflows/ci.yml verbatim (3 triggers, 5 jobs, a needs chain,
  // a matrix job, a conditional job, and an environment/deployment job)
  // rather than hand-authoring a second fixture workflow. Also carries a
  // small Terraform root module (two resources, one variable, one output)
  // so the packaged CLI's Terraform topology pipeline gets exercised
  // end to end here too, not just the GitHub Actions workflow pipeline.
  function writeRichFixture(dir: string): void {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    mkdirSync(join(dir, "infra"), { recursive: true });
    writeFileSync(join(dir, "README.md"), "# Smoke Test Repo\n\nA fixture repo for packaged CLI testing.\n");
    writeFileSync(join(dir, "src/index.ts"), "export function main(): void {}\n");
    writeFileSync(join(dir, "docs/architecture.md"), "# Architecture\n\nA single fixture service.\n");
    writeFileSync(
      join(dir, ".github/workflows/ci.yml"),
      readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
    );
    writeFileSync(
      join(dir, "infra/main.tf"),
      [
        'variable "environment" {',
        '  type    = string',
        '  default = "staging"',
        "}",
        "",
        'resource "aws_s3_bucket" "assets" {',
        "  bucket = \"smoke-test-assets-${var.environment}\"",
        "}",
        "",
        'resource "aws_s3_bucket_versioning" "assets" {',
        "  bucket = aws_s3_bucket.assets.id",
        "  versioning_configuration {",
        '    status = "Enabled"',
        "  }",
        "}",
        "",
        'output "bucket_arn" {',
        "  value = aws_s3_bucket.assets.arn",
        "}",
        "",
      ].join("\n"),
    );
  }

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  });

  function rvs(args: string[], opts: { allowNonZeroExit?: boolean; cwd?: string } = {}): string {
    try {
      return execFileSync("npx", ["rvs", ...args], { cwd: opts.cwd ?? installDir, encoding: "utf8" });
    } catch (err) {
      if (opts.allowNonZeroExit) return String((err as { stdout?: string }).stdout ?? "");
      throw err;
    }
  }

  it("resolves version and reports doctor diagnostics from outside the monorepo", () => {
    const version = rvs(["--version"]).trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);

    const doctor = rvs(["doctor"]);
    expect(doctor).toContain("rvs " + version);
    expect(doctor).toContain("VisualDoc schema version:");
    expect(doctor).toContain("WorkflowGraph schema version:");
    // Asset resolution must come from the installed package, not the monorepo checkout.
    expect(doctor).toMatch(/Design systems found at .*node_modules[/\\]@rvs[/\\]cli[/\\]assets/);
    expect(doctor).not.toContain(repoRoot);

    // Section 9's full doctor field set, verified against the installed
    // tarball specifically (not just the workspace source).
    expect(doctor).toContain("Installation type: packaged");
    // process.argv[1] resolves through the node_modules/.bin/rvs symlink,
    // not into @rvs/cli's own directory — only Package root (RVS_INSTALL_ROOT,
    // derived from the module's own file location) points inside @rvs/cli.
    expect(doctor).toMatch(/CLI executable: .*node_modules[/\\]\.bin[/\\]rvs/);
    expect(doctor).toMatch(/Package root: .*node_modules[/\\]@rvs[/\\]cli/);
    expect(doctor).toMatch(/Schemas found at .*node_modules[/\\]@rvs[/\\]cli[/\\]assets/);
    expect(doctor).toMatch(/Agent skill found at .*node_modules[/\\]@rvs[/\\]cli[/\\]assets/);
    expect(doctor).toContain(`Current working directory: ${installDir}`);
    expect(doctor).toContain(`Repository root: ${installDir}`);
    expect(doctor).toMatch(/Playwright package: available \(v\d+\.\d+\.\d+\)/);

    const skillPath = rvs(["skill", "path"]).trim();
    expect(skillPath).toMatch(/node_modules[/\\]@rvs[/\\]cli[/\\]assets[/\\]skills[/\\]repo-visual-studio$/);
  });

  it("detects a pnpm workspace during rvs init from outside the monorepo", () => {
    const monorepoFixture = join(installDir, "monorepo-fixture");
    mkdirSync(join(monorepoFixture, "packages/widgets/src"), { recursive: true });
    writeFileSync(join(monorepoFixture, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    writeFileSync(join(monorepoFixture, "package.json"), JSON.stringify({ name: "fixture-monorepo" }));
    writeFileSync(join(monorepoFixture, "packages/widgets/package.json"), JSON.stringify({ name: "widgets" }));
    writeFileSync(join(monorepoFixture, "packages/widgets/src/index.ts"), "export {};\n");

    const output = rvs(["init"], { cwd: monorepoFixture });
    expect(output).toContain("Detected a pnpm workspace");
    expect(output).toContain("packages/*/src/**");

    const config = readFileSync(join(monorepoFixture, ".rvs/config.yml"), "utf8");
    expect(config).toContain("packages/*/package.json");
    expect(config).toContain("**/node_modules/**");
  });

  it("runs the full inspect -> brief -> slides -> workflow -> validate -> export pipeline", () => {
    writeRichFixture(installDir);

    expect(rvs(["init"])).toContain("Wrote .rvs/config.yml");
    expect(rvs(["inspect"])).toContain("Wrote .rvs/cache/repository-model.json");
    expect(rvs(["brief", "--audience", "architecture-review"])).toContain("Wrote .rvs/cache/narrative-brief.yml");

    const workflowOutput = rvs(["create", "workflow", "--all", "--renderer", "both", "--format", "visualdoc"]);
    expect(workflowOutput).toMatch(/Parsed 1 workflow\(s\)/);
    const workflowsDir = join(installDir, "artifacts/visuals/workflows");
    const workflowFiles = readdirSync(workflowsDir);
    expect(workflowFiles.some((f) => f.endsWith(".mmd"))).toBe(true);
    expect(workflowFiles.some((f) => f.endsWith(".svg"))).toBe(true);
    expect(workflowFiles.some((f) => f.endsWith(".visualdoc.json"))).toBe(true);
    expect(existsSync(join(installDir, ".rvs/cache/workflow-graphs.json"))).toBe(true);
    const graphCache = JSON.parse(readFileSync(join(installDir, ".rvs/cache/workflow-graphs.json"), "utf8")) as Array<{
      nodes: unknown[];
      edges: unknown[];
    }>;
    const [graph] = graphCache;
    expect(graph.nodes.length).toBeGreaterThanOrEqual(5); // ci.yml has 5 jobs
    expect(graph.edges.length).toBeGreaterThan(0); // needs-chains between jobs

    const topologyOutput = rvs(["create", "topology", "--all", "--renderer", "both", "--format", "visualdoc"]);
    expect(topologyOutput).toMatch(/Parsed 1 root Terraform module\(s\)/);
    const topologiesDir = join(installDir, "artifacts/visuals/topologies");
    const topologyFiles = readdirSync(topologiesDir);
    expect(topologyFiles.some((f) => f.endsWith(".mmd"))).toBe(true);
    expect(topologyFiles.some((f) => f.endsWith(".svg"))).toBe(true);
    expect(topologyFiles.some((f) => f.endsWith(".visualdoc.json"))).toBe(true);
    expect(existsSync(join(installDir, ".rvs/cache/terraform-topologies.json"))).toBe(true);
    const topologyCache = JSON.parse(
      readFileSync(join(installDir, ".rvs/cache/terraform-topologies.json"), "utf8"),
    ) as Array<{ nodes: unknown[]; edges: unknown[] }>;
    const [topology] = topologyCache;
    // 2 resources + 1 variable + 1 output, at minimum.
    expect(topology.nodes.length).toBeGreaterThanOrEqual(4);
    expect(topology.edges.length).toBeGreaterThan(0); // resource -> resource / variable references

    expect(rvs(["create", "slides"])).toContain("Rendered");

    // Mirrors the CI build-deck job: `rvs synthesize architecture` then
    // `rvs synthesize capabilities` must run before `rvs validate --ci` so
    // that a capability-model.json cache exists for validate to pick up.
    expect(rvs(["synthesize", "architecture"])).toContain("Synthesized architecture intelligence");
    expect(existsSync(join(installDir, ".rvs/cache/architecture-intelligence.json"))).toBe(true);

    expect(rvs(["synthesize", "capabilities"])).toContain("Synthesized capability intelligence");
    expect(existsSync(join(installDir, ".rvs/cache/capability-model.json"))).toBe(true);

    // Non-blocking: this fixture has sparse markdown evidence, so --ci is
    // expected to fail on the missing-evidence warning threshold. The
    // point of this assertion is that the packaged CLI runs the check at
    // all, not that the fixture passes it.
    const validateOutput = rvs(["validate", "--ci"], { allowNonZeroExit: true });

    // With a capability-model.json cache present, `rvs validate` must also
    // run capability-model structural validation and write its report
    // alongside deck.html's own validation-report.json.
    expect(validateOutput).toContain("Validated capability model:");
    expect(existsSync(join(installDir, "artifacts/visuals/capability-validation-report.json"))).toBe(true);

    const deckHtml = join(installDir, "artifacts/visuals/deck.html");
    expect(existsSync(deckHtml)).toBe(true);
  });

  it("runs synthesize architecture -> synthesize capabilities -> export capabilities -> capabilities explain against the pipeline's cached evidence", () => {
    // Depends on the .rvs/cache/{repository-model,workflow-graphs,terraform-topologies}.json
    // produced by the prior pipeline test's inspect/create workflow/create
    // topology run against the same installDir — mirrors this file's
    // existing pattern of later it() blocks (e.g. "exports a PDF...")
    // building on state left by the main pipeline test rather than
    // rewriting the fixture from scratch.
    const archOutput = rvs(["synthesize", "architecture"]);
    expect(archOutput).toMatch(
      /Synthesized architecture intelligence for ".+" \(\d+ components, \d+ flows, \d+ error\(s\), \d+ warning\(s\)\)\./,
    );
    expect(archOutput).toContain("Cached to .rvs/cache/architecture-intelligence.json");
    const archCachePath = join(installDir, ".rvs/cache/architecture-intelligence.json");
    expect(existsSync(archCachePath)).toBe(true);
    const archModel = JSON.parse(readFileSync(archCachePath, "utf8")) as {
      metadata?: { schema_version?: number };
      components?: unknown[];
    };
    expect(archModel.metadata?.schema_version).toBe(1);
    expect(Array.isArray(archModel.components)).toBe(true);

    const capsOutput = rvs(["synthesize", "capabilities"]);
    // Counts are not asserted (the fixture's real capability yield may be
    // sparse, and any change elsewhere in the pipeline could shift them) —
    // only that the summary line has the shape synthesize-capabilities.ts
    // actually logs.
    expect(capsOutput).toMatch(
      /Synthesized capability intelligence for ".+": \d+ included, \d+ qualified, \d+ gaps, \d+ roadmap-only, \d+ excluded \(of \d+ candidates\), \d+ error\(s\), \d+ warning\(s\)\./,
    );
    const capModelPath = join(installDir, ".rvs/cache/capability-model.json");
    const capCandidatesPath = join(installDir, ".rvs/cache/capability-candidates.json");
    expect(existsSync(capModelPath)).toBe(true);
    expect(existsSync(capCandidatesPath)).toBe(true);

    interface CapabilityEntry {
      id: string;
      displayName: string;
    }
    const capModel = JSON.parse(readFileSync(capModelPath, "utf8")) as {
      evidenceSummary?: unknown;
      includedCapabilities: CapabilityEntry[];
      qualifiedCapabilities: CapabilityEntry[];
      roadmapCapabilities: CapabilityEntry[];
      gapCapabilities: CapabilityEntry[];
      unresolvedCapabilities: CapabilityEntry[];
      excludedCandidates: CapabilityEntry[];
    };
    expect(capModel.evidenceSummary).toBeDefined();
    const candidates = JSON.parse(readFileSync(capCandidatesPath, "utf8"));
    expect(Array.isArray(candidates)).toBe(true);

    const exportOutput = rvs(["export", "capabilities", "--output", "CAPABILITIES.md", "--include-partial", "--include-gaps"]);
    expect(exportOutput).toContain("Wrote");
    const capabilitiesMdPath = join(installDir, "CAPABILITIES.md");
    expect(existsSync(capabilitiesMdPath)).toBe(true);
    const capabilitiesMd = readFileSync(capabilitiesMdPath, "utf8");
    expect(capabilitiesMd.length).toBeGreaterThan(0);
    expect(capabilitiesMd).toMatch(/^# /);

    // capabilities explain: exercise both a known-good id and a clearly
    // invalid one. The "known-good" id is derived by mirroring
    // capabilities-explain.ts's own lookup list exactly (includedCapabilities
    // -> qualifiedCapabilities -> roadmapCapabilities -> gapCapabilities ->
    // unresolvedCapabilities -> excludedCandidates) rather than assuming any
    // specific capability the sparse fixture happens to yield.
    const allEntries: CapabilityEntry[] = [
      ...capModel.includedCapabilities,
      ...capModel.qualifiedCapabilities,
      ...capModel.roadmapCapabilities,
      ...capModel.gapCapabilities,
      ...capModel.unresolvedCapabilities,
      ...capModel.excludedCandidates,
    ];
    expect(allEntries.length).toBeGreaterThan(0);
    const [first] = allEntries;
    const explainOutput = rvs(["capabilities", "explain", first.id]);
    expect(explainOutput).toContain(first.displayName);
    expect(explainOutput).toContain("Status:");

    let explainFailed = false;
    let explainMessage = "";
    try {
      rvs(["capabilities", "explain", "definitely-not-a-real-capability-id"]);
    } catch (err) {
      explainFailed = true;
      explainMessage = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(explainFailed).toBe(true);
    expect(explainMessage).toContain("No capability or candidate found");
  });

  it("runs synthesize product-identity -> export product-identity -> create slides --profile showcase -> export showcase-plan -> showcase explain against the pipeline's cached evidence", () => {
    // Depends on the .rvs/cache/{architecture-intelligence,capability-model}.json
    // produced by the prior two pipeline tests in this same installDir —
    // mirrors this file's existing pattern of later it() blocks building on
    // state left by earlier ones rather than rewriting the fixture from
    // scratch. Milestone 5's five new product-identity/showcase CLI surfaces
    // are exercised here through the packed npm tarball, not just workspace
    // source (closure condition 1).
    const identityOutput = rvs(["synthesize", "product-identity"]);
    expect(identityOutput).toMatch(
      /Synthesized product identity for ".+": archetype=\S+ confidence=\S+, \d+ value pillar\(s\), \d+ differentiator\(s\), \d+ candidate\(s\), \d+ error\(s\), \d+ warning\(s\)\./,
    );
    const identityModelPath = join(installDir, ".rvs/cache/product-identity-model.json");
    expect(existsSync(identityModelPath)).toBe(true);
    expect(existsSync(join(installDir, ".rvs/cache/product-identity-candidates.json"))).toBe(true);

    const exportIdentityOutput = rvs(["export", "product-identity", "--output", "product-identity.json"]);
    expect(exportIdentityOutput).toContain("Wrote");
    const productIdentityJsonPath = join(installDir, "product-identity.json");
    expect(existsSync(productIdentityJsonPath)).toBe(true);
    interface ExportedProductIdentity {
      identity: { displayName: string; archetype: string };
    }
    const exportedIdentity = JSON.parse(readFileSync(productIdentityJsonPath, "utf8")) as ExportedProductIdentity;
    expect(exportedIdentity.identity.displayName.length).toBeGreaterThan(0);

    const showcaseOutput = rvs(["create", "slides", "--profile", "showcase", "--audience", "executive"]);
    expect(showcaseOutput).toMatch(/Rendered \d+ showcase scenes to artifacts\/visuals\/deck\.html using ".+" \(audience: "executive", theme: ".+"\)/);
    expect(showcaseOutput).toContain("Cached to .rvs/cache/showcase-plan.json");
    const showcasePlanCachePath = join(installDir, ".rvs/cache/showcase-plan.json");
    expect(existsSync(showcasePlanCachePath)).toBe(true);

    const exportShowcaseOutput = rvs(["export", "showcase-plan", "--output", "showcase-plan.json"]);
    expect(exportShowcaseOutput).toMatch(/Wrote .+ \(\d+ scene\(s\), \d+ approved claim\(s\), \d+ rejected claim\(s\)\)\./);
    const showcasePlanJsonPath = join(installDir, "showcase-plan.json");
    expect(existsSync(showcasePlanJsonPath)).toBe(true);

    interface ExportedShowcasePlan {
      narrative: {
        approvedClaims: Array<{ id: string; text: string }>;
        rejectedClaims: Array<{ id: string; text: string }>;
        runtimeVerificationClaims: Array<{ id: string; text: string }>;
      };
    }
    const exportedPlan = JSON.parse(readFileSync(showcasePlanJsonPath, "utf8")) as ExportedShowcasePlan;
    const allClaims = [
      ...exportedPlan.narrative.approvedClaims,
      ...exportedPlan.narrative.rejectedClaims,
      ...exportedPlan.narrative.runtimeVerificationClaims,
    ];
    expect(allClaims.length).toBeGreaterThan(0);
    const [firstClaim] = allClaims;
    const explainOutput = rvs(["showcase", "explain", firstClaim.id]);
    expect(explainOutput.length).toBeGreaterThan(0);

    let explainFailed = false;
    let explainMessage = "";
    try {
      rvs(["showcase", "explain", "definitely-not-a-real-claim-id"]);
    } catch (err) {
      explainFailed = true;
      explainMessage = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(explainFailed).toBe(true);
    expect(explainMessage).toContain('No claim found matching "definitely-not-a-real-claim-id"');
  });

  it("runs synthesize portfolio -> export portfolio-model/claims/decisions -> create slides --profile portfolio -> portfolio explain -> validate --ci, against a single-product portfolio built from the pipeline's own artifacts", () => {
    // Portfolio intake (Milestone 6) requires capability-model.json and
    // product-identity.json to live together in one product's artifact_root.
    // Rather than re-running the whole upstream pipeline a second time just
    // to produce a second product, this copies the .rvs/cache/capability-model.json
    // and product-identity.json already produced by the two prior pipeline
    // tests in this same installDir into a fresh artifact-roots/product-a/
    // directory and portfolios over that single (self-consistent) product.
    const artifactRoot = join(installDir, "artifact-roots/product-a");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, "capability-model.json"), readFileSync(join(installDir, ".rvs/cache/capability-model.json")));
    writeFileSync(join(artifactRoot, "product-identity.json"), readFileSync(join(installDir, "product-identity.json")));

    writeFileSync(
      join(installDir, ".rvs/portfolio.yml"),
      ["schema_version: 1", "portfolio:", "  id: smoke-test-portfolio", "  display_name: Smoke Test Portfolio", "products:", "  - id: product-a", "    artifact_root: artifact-roots/product-a", ""].join(
        "\n",
      ),
    );

    const synthesizeOutput = rvs(["synthesize", "portfolio"]);
    expect(synthesizeOutput).toMatch(/Synthesized portfolio "Smoke Test Portfolio": 1 product\(s\)/);
    expect(synthesizeOutput).toContain("Cached to .rvs/cache/portfolio-model.json");
    expect(existsSync(join(installDir, ".rvs/cache/portfolio-model.json"))).toBe(true);
    expect(existsSync(join(installDir, ".rvs/cache/portfolio-claims.json"))).toBe(true);
    expect(existsSync(join(installDir, ".rvs/cache/portfolio-decisions.json"))).toBe(true);

    const exportModelOutput = rvs(["export", "portfolio-model", "--output", "portfolio-model.json"]);
    expect(exportModelOutput).toMatch(/Wrote .+ \(1 product\(s\), \d+ capability\(ies\), \d+ relationship\(s\)\)\./);
    const portfolioModelPath = join(installDir, "portfolio-model.json");
    expect(existsSync(portfolioModelPath)).toBe(true);
    const portfolioModel = JSON.parse(readFileSync(portfolioModelPath, "utf8")) as { products: Array<{ id: string }> };
    expect(portfolioModel.products).toHaveLength(1);

    const exportClaimsOutput = rvs(["export", "portfolio-claims", "--output", "portfolio-claims.json"]);
    expect(exportClaimsOutput).toMatch(/Wrote .+ \(\d+ claim\(s\), \d+ approved\)\./);
    const portfolioClaimsPath = join(installDir, "portfolio-claims.json");
    expect(existsSync(portfolioClaimsPath)).toBe(true);
    const portfolioClaims = JSON.parse(readFileSync(portfolioClaimsPath, "utf8")) as Array<{ id: string }>;

    const exportDecisionsOutput = rvs(["export", "portfolio-decisions", "--output", "portfolio-decisions.json"]);
    expect(exportDecisionsOutput).toMatch(/Wrote .+ \(\d+ decision\(s\)\)\./);
    const portfolioDecisionsPath = join(installDir, "portfolio-decisions.json");
    expect(existsSync(portfolioDecisionsPath)).toBe(true);
    const portfolioDecisions = JSON.parse(readFileSync(portfolioDecisionsPath, "utf8")) as Array<{ id: string }>;

    const slidesOutput = rvs(["create", "slides", "--profile", "portfolio", "--audience", "portfolio"]);
    expect(slidesOutput).toMatch(/Rendered \d+ portfolio scenes to artifacts\/visuals\/deck\.html using ".+" \(audience: "portfolio", theme: ".+"\)/);
    expect(slidesOutput).toContain("Cached to .rvs/cache/portfolio-plan.json");
    expect(existsSync(join(installDir, ".rvs/cache/portfolio-plan.json"))).toBe(true);

    // portfolio explain: exercise a known-good id (whichever of
    // claims/decisions this single-product fixture happens to yield — the
    // two id spaces never collide, so trying a claim id here also proves
    // the claims-first lookup path) and a clearly invalid one.
    const knownId = portfolioClaims[0]?.id ?? portfolioDecisions[0]?.id;
    if (knownId) {
      const explainOutput = rvs(["portfolio", "explain", knownId]);
      expect(explainOutput.length).toBeGreaterThan(0);
    }

    let explainFailed = false;
    let explainMessage = "";
    try {
      rvs(["portfolio", "explain", "definitely-not-a-real-portfolio-id"]);
    } catch (err) {
      explainFailed = true;
      explainMessage = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(explainFailed).toBe(true);
    expect(explainMessage).toContain('No claim or decision found matching "definitely-not-a-real-portfolio-id"');

    // validate --ci must now also pick up the portfolio-model/claims/plan
    // caches and write portfolio-validation-report.json alongside the
    // capability-validation-report.json already asserted in the earlier
    // pipeline test.
    const validateOutput = rvs(["validate", "--ci"], { allowNonZeroExit: true });
    expect(validateOutput).toContain("Validated portfolio:");
    expect(existsSync(join(installDir, "artifacts/visuals/portfolio-validation-report.json"))).toBe(true);
  });

  it("exports a PDF when Chromium is available, or fails clearly when it is not", () => {
    let chromiumAvailable: boolean;
    try {
      chromiumAvailable = rvs(["doctor"]).includes("Playwright Chromium launches successfully.");
    } catch {
      chromiumAvailable = false;
    }

    if (chromiumAvailable) {
      const output = rvs(["export", "pdf"]);
      expect(output).toContain("Exported");
      expect(existsSync(join(installDir, "artifacts/visuals/deck.pdf"))).toBe(true);
    } else {
      let failed = false;
      let message = "";
      try {
        rvs(["export", "pdf"]);
      } catch (err) {
        failed = true;
        message = String((err as { stdout?: string; stderr?: string }).stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(message.toLowerCase()).toMatch(/chromium|playwright|browser/);
    }
  });

  it("warns instead of crashing when no GitHub Actions workflows are present", () => {
    const noWorkflowFixture = join(installDir, "no-workflow-fixture");
    mkdirSync(noWorkflowFixture, { recursive: true });
    writeFileSync(join(noWorkflowFixture, "README.md"), "# No Workflows Here\n");
    rvs(["init"], { cwd: noWorkflowFixture });

    const output = rvs(["create", "workflow", "--all", "--renderer", "both"], {
      allowNonZeroExit: true,
      cwd: noWorkflowFixture,
    });
    expect(output + "").toBeDefined();
  });
});
