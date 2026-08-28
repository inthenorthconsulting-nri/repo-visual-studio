import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  readdirSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { chromium, type Browser, type Page } from "playwright";
import { validateHtmlFile, type ValidationReport } from "@rvs/validator";

// Confirms the packaged CLI (npm tarball) and the workspace source CLI (tsx)
// produce structurally identical output for the same repo content — not
// just that each independently "works" (that's package-smoke.test.ts).
// This guards against packaging-specific divergence a build-time transform,
// a stale bundled dependency, or an asset resolved from the wrong path could
// introduce into deterministic output (claim/graph IDs, content_spec_hash)
// without either suite alone noticing, since neither compares one run
// against the other.
//
// Portfolio coverage below spans small (single-product), large (3-product),
// reordered, and partially-incompatible (--allow-partial) inputs, each
// verified through both source and the packaged tarball. It deliberately
// does not re-derive adversarial-input coverage (e.g. capability records
// crafted to bait/evade the merge algorithm) here: that's synthesis-logic
// correctness, already proven in capability-normalization.test.ts and
// portfolio-intelligence/src/__tests__/index.test.ts, and packaging cannot
// introduce a per-input logic divergence — only a build/bundling one, which
// the structural comparisons in this file already catch regardless of which
// portfolio input produced the bytes being compared.
const RUN = process.env.RVS_TEST_PACKAGE === "1";
const maybeDescribe = RUN ? describe : describe.skip;

const repoRoot = join(__dirname, "../../../..");
const cliRoot = join(repoRoot, "packages/cli");
const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
const cliEntry = join(repoRoot, "packages/cli/src/bin.ts");

function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "rvs-equiv-fixture-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "docs/decisions"), { recursive: true });
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  mkdirSync(join(dir, "infra"), { recursive: true });

  // Fixed project name (not derived from the temp-dir basename, which
  // differs between the two install roots) so `rvs init` writes an
  // identical project.name into both copies' .rvs/config.yml.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "rvs-equivalence-fixture", version: "1.0.0" }, null, 2),
  );
  writeFileSync(join(dir, "README.md"), "# Equivalence Fixture\n\nA fixture repo for source-vs-package output comparison.\n");
  writeFileSync(join(dir, "src/index.ts"), "export function main(): void {}\n");
  writeFileSync(join(dir, "docs/architecture.md"), "# Architecture\n\nA single fixture service.\n");
  // A real ADR-shaped decision document (Milestone 8) -- committed into the
  // fixture like docs/architecture.md above, and later discovered by `rvs
  // decisions analyze` once `.rvs/decisions.yml` (written per-run below,
  // after `rvs init` has created `.rvs/`) points at this directory with
  // `type: adr`. Frontmatter `id`/`status` plus a `## Alternatives` list
  // exercise the same identity-resolution and alternatives-fold-in paths
  // decisions-cli.test.ts's in-process fixture does, just through the real
  // packaged/source CLI binaries this file compares.
  writeFileSync(
    join(dir, "docs/decisions/0001-use-example-database.md"),
    [
      "---",
      "id: ADR-0001",
      "status: accepted",
      "---",
      "",
      "# Use PostgreSQL as the primary database",
      "",
      "## Context",
      "",
      "The fixture service needs a relational database for transactional data.",
      "",
      "## Decision",
      "",
      "We will use PostgreSQL as the primary datastore.",
      "",
      "## Alternatives",
      "",
      "- [rejected] Use MySQL: weaker JSON support and extension ecosystem for our needs.",
      "- [considered] Use a managed NoSQL store: does not fit our relational data model.",
      "",
    ].join("\n"),
  );
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
      "  bucket = \"equiv-test-assets-${var.environment}\"",
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

  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "RVS Test"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "Initial fixture commit"], { cwd: dir });
  return dir;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractAttr(html: string, attr: string): string {
  const match = html.match(new RegExp(`data-${attr}="([^"]*)"`));
  if (!match) throw new Error(`Attribute data-${attr} not found in HTML`);
  return match[1];
}

maybeDescribe("source vs packaged CLI structural equivalence", () => {
  let packDir: string;
  let tarballPath: string;
  let sourceDir: string;
  let packagedDir: string;

  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@rvs/cli", "build"], { cwd: repoRoot, stdio: "inherit" });
    packDir = mkdtempSync(join(tmpdir(), "rvs-equiv-pack-"));
    // See package-smoke.test.ts: `pnpm --filter @rvs/cli pack` fails under
    // pnpm 10.9.0 (this repo's pinned packageManager version) with "Unknown
    // option: 'recursive'". Run `pack` with cwd set to the package
    // directory instead — same tarball, no --filter/recursive-mode
    // dependency.
    execFileSync("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: cliRoot,
      stdio: "inherit",
    });
    tarballPath = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz"))!);

    // One canonical fixture, git-initialized and committed once, then
    // byte-for-byte copied (including .git) into two install roots — both
    // runs scan identical content and produce an identical git_commit
    // stamp, isolating any divergence to the CLI's own build output.
    const fixture = buildFixture();

    sourceDir = mkdtempSync(join(tmpdir(), "rvs-equiv-source-"));
    cpSync(fixture, sourceDir, { recursive: true });

    packagedDir = mkdtempSync(join(tmpdir(), "rvs-equiv-packaged-"));
    cpSync(fixture, packagedDir, { recursive: true });
    // --no-save: this install exists only to produce a runnable `rvs` binary
    // to compare against the source checkout. Without it, npm writes
    // "@rvs/cli" into packagedDir's package.json (but never sourceDir's),
    // which — since the root-level-manifest CLI-detection fix (§6 above)
    // makes `rvs inspect` treat every root package.json's own dependency
    // list as WorkspacePackage evidence — made repository-model.json's
    // workspace_packages[0].dependencyNames genuinely diverge between the
    // two runs for reasons entirely unrelated to the CLI's own behavior.
    execFileSync("npm", ["install", "--no-save", tarballPath], { cwd: packagedDir, stdio: "inherit" });

    rmSync(fixture, { recursive: true, force: true });
  }, 240_000);

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(packagedDir, { recursive: true, force: true });
  });

  function runSource(args: string[]): string {
    return execFileSync(tsxBin, [cliEntry, ...args], { cwd: sourceDir, encoding: "utf8" });
  }

  function runPackaged(args: string[]): string {
    return execFileSync("npx", ["rvs", ...args], { cwd: packagedDir, encoding: "utf8" });
  }

  const portfolioYaml = (order: readonly string[]) =>
    [
      "schema_version: 1",
      "portfolio:",
      "  id: equivalence-test-portfolio",
      "  display_name: Equivalence Test Portfolio",
      "products:",
      ...order.map((id) => `  - id: ${id}\n    artifact_root: artifact-roots/${id}`),
      "",
    ].join("\n");

  // portfolio-model.json: generationMetadata.generated_at is run-specific (a
  // direct `new Date().toISOString()` call), and each product's own
  // source.sourceProductIdentityGeneratedAt/sourceCapabilityModelGeneratedAt
  // chain from the copied artifact files' own run-specific timestamps —
  // strip all three and deep-compare everything else, including every
  // normalized capability, relationship, gap, and evidence citation.
  // excludedProducts[].artifacts embeds the *raw* parsed capability-model.json
  // / product-identity.json for the excluded product, each carrying its own
  // run-specific generationMetadata timestamps (same wall-clock chain as the
  // standalone capability-model.json/product-identity.json comparisons
  // elsewhere in this test) — strip those the same way before comparing.
  const stripGenerationMetadataTimestamps = (obj: unknown, ...timestampKeys: string[]) => {
    if (obj === undefined || obj === null || typeof obj !== "object") return obj;
    const { generationMetadata, ...rest } = obj as { generationMetadata?: Record<string, unknown> } & Record<string, unknown>;
    if (!generationMetadata) return obj;
    const strippedMetadata = { ...generationMetadata };
    for (const key of timestampKeys) delete strippedMetadata[key];
    return { ...rest, generationMetadata: strippedMetadata };
  };

  const stripPortfolioModel = (m: Record<string, unknown>) => {
    const { generationMetadata, products, excludedProducts, ...rest } = m as {
      generationMetadata: Record<string, unknown>;
      products: Array<Record<string, unknown>>;
      excludedProducts: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const { generated_at, ...metadataRest } = generationMetadata;
    const strippedProducts = products.map((p) => {
      const { source, ...productRest } = p as { source: Record<string, unknown> } & Record<string, unknown>;
      const { sourceProductIdentityGeneratedAt, sourceCapabilityModelGeneratedAt, ...sourceRest } = source;
      return { ...productRest, source: sourceRest };
    });
    const strippedExcludedProducts = (excludedProducts ?? []).map((p) => {
      const { artifacts, ...productRest } = p as { artifacts: Record<string, unknown> } & Record<string, unknown>;
      return {
        ...productRest,
        artifacts: {
          ...artifacts,
          capabilityModel: stripGenerationMetadataTimestamps(artifacts.capabilityModel, "generated_at", "source_architecture_intelligence_generated_at"),
          productIdentity: stripGenerationMetadataTimestamps(artifacts.productIdentity, "generated_at", "source_capability_model_generated_at"),
        },
      };
    });
    return { ...rest, products: strippedProducts, excludedProducts: strippedExcludedProducts, generationMetadata: metadataRest };
  };

  it("produces structurally identical cache, workflow, and deck output from source and from the tarball", () => {
    const runs: Array<[(args: string[]) => string, string]> = [
      [runSource, sourceDir],
      [runPackaged, packagedDir],
    ];
    for (const [run, dir] of runs) {
      run(["init"]);
      run(["inspect"]);
      run(["brief", "--audience", "architecture-review"]);
      run(["create", "workflow", "--all", "--renderer", "both", "--format", "visualdoc"]);
      run(["create", "topology", "--all", "--renderer", "both", "--format", "visualdoc"]);
      run(["create", "slides"]);
      // synthesize architecture reads repository-model.json plus the
      // workflow-graphs.json/terraform-topologies.json caches just written
      // above by create workflow/create topology; synthesize capabilities
      // in turn requires architecture-intelligence.json — both must run in
      // this order, after inspect and after the graph/topology caches
      // exist, exactly like the packaged-CLI smoke suite's pipeline.
      run(["synthesize", "architecture"]);
      run(["synthesize", "capabilities"]);
      run(["export", "capabilities", "--output", "CAPABILITIES.md"]);
      run(["synthesize", "product-identity"]);
      run(["export", "product-identity", "--output", "product-identity.json"]);
      run(["create", "slides", "--profile", "showcase", "--audience", "executive"]);
      run(["export", "showcase-plan", "--output", "showcase-plan.json"]);

      // Portfolio intake (Milestone 6) requires capability-model.json and
      // product-identity.json to live together in one product's
      // artifact_root — copy this run's own already-generated files (each
      // run's copy stays internally self-consistent; the two runs' bytes
      // differ only in the same run-specific generated_at fields already
      // stripped from the underlying caches elsewhere in this test) into
      // artifact-roots/product-a/. product-b is a byte-identical clone of
      // product-a's own artifacts under a distinct product id, so
      // normalizePortfolioCapabilities has a genuine second participant to
      // merge product-a's capability into (a "large"-r, non-trivial
      // multi-product case, not just a single-product portfolio) — see
      // capability-normalization.test.ts for the merge-logic unit coverage
      // this exercises end-to-end through the packaged binary. product-c
      // carries a bumped capabilityModel.schemaVersion (2, unsupported) so
      // compatibility.ts excludes it as incompatible, giving a "partially
      // incompatible" portfolio that requires --allow-partial to succeed.
      const capabilityModelJson = readFileSync(join(dir, ".rvs/cache/capability-model.json"), "utf8");
      const productIdentityJson = readFileSync(join(dir, "product-identity.json"), "utf8");
      const incompatibleCapabilityModelJson = JSON.stringify({ ...JSON.parse(capabilityModelJson), schemaVersion: 2 });

      for (const [productId, capModel] of [
        ["product-a", capabilityModelJson],
        ["product-b", capabilityModelJson],
        ["product-c", incompatibleCapabilityModelJson],
      ] as const) {
        const artifactRoot = join(dir, "artifact-roots", productId);
        mkdirSync(artifactRoot, { recursive: true });
        writeFileSync(join(artifactRoot, "capability-model.json"), capModel);
        writeFileSync(join(artifactRoot, "product-identity.json"), productIdentityJson);
      }

      writeFileSync(join(dir, ".rvs/portfolio.yml"), portfolioYaml(["product-a", "product-b", "product-c"]));
      run(["synthesize", "portfolio", "--allow-partial"]);
      run(["export", "portfolio-model", "--output", "portfolio-model.json"]);
      run(["export", "portfolio-claims", "--output", "portfolio-claims.json"]);
      run(["export", "portfolio-decisions", "--output", "portfolio-decisions.json"]);
      // Last `create slides` call in the pipeline — deck.html/visualdoc.json
      // below therefore reflect the portfolio deck, not the showcase one
      // (see the note at the bottom of this test).
      run(["create", "slides", "--profile", "portfolio", "--audience", "portfolio"]);
    }

    // .rvs/config.yml: identical project name (from the shared package.json)
    // and identical workspace-detection result (both fixtures are plain,
    // non-workspace repos) should produce byte-identical config text.
    expect(readFileSync(join(sourceDir, ".rvs/config.yml"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/config.yml"), "utf8"),
    );

    // repository-model.json: strip the two fields that are legitimately
    // run-specific (generated_at timestamp, repo_root absolute path) and
    // deep-compare everything else.
    const stripModel = (m: Record<string, unknown>) => {
      const { generated_at, repo_root, ...rest } = m;
      return rest;
    };
    expect(stripModel(readJson(join(sourceDir, ".rvs/cache/repository-model.json")) as Record<string, unknown>)).toEqual(
      stripModel(readJson(join(packagedDir, ".rvs/cache/repository-model.json")) as Record<string, unknown>),
    );

    // evidence-manifest.json: strip generated_at only.
    const stripEvidence = (m: Record<string, unknown>) => {
      const { generated_at, ...rest } = m;
      return rest;
    };
    expect(
      stripEvidence(readJson(join(sourceDir, ".rvs/cache/evidence-manifest.json")) as Record<string, unknown>),
    ).toEqual(stripEvidence(readJson(join(packagedDir, ".rvs/cache/evidence-manifest.json")) as Record<string, unknown>));

    // narrative-brief.yml is a pure deterministic template fill with no
    // timestamps — byte-identical.
    expect(readFileSync(join(sourceDir, ".rvs/cache/narrative-brief.yml"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/narrative-brief.yml"), "utf8"),
    );

    // workflow-graphs.json cache carries only deterministic content
    // (node/edge IDs, no timestamps) — byte-identical.
    expect(readFileSync(join(sourceDir, ".rvs/cache/workflow-graphs.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/workflow-graphs.json"), "utf8"),
    );

    // Rendered workflow artifacts (Mermaid text, SVG, VisualDoc scene JSON)
    // — byte-identical.
    for (const file of ["ci.mmd", "ci.svg", "ci.visualdoc.json"]) {
      expect(readFileSync(join(sourceDir, "artifacts/visuals/workflows", file), "utf8")).toEqual(
        readFileSync(join(packagedDir, "artifacts/visuals/workflows", file), "utf8"),
      );
    }

    // terraform-topologies.json cache carries only deterministic content
    // (node/edge IDs, no timestamps) — byte-identical. This is the one
    // artifact whose parsing runs through @cdktf/hcl2json, the package
    // build's esbuild `external` (see build.mjs) rather than a bundled
    // dependency — a divergence here would specifically indicate the
    // packaged CLI resolved a different WASM binary or bridge script than
    // the source checkout.
    expect(readFileSync(join(sourceDir, ".rvs/cache/terraform-topologies.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/terraform-topologies.json"), "utf8"),
    );

    // Rendered Terraform topology artifacts — byte-identical.
    for (const file of ["infra.mmd", "infra.svg", "infra.visualdoc.json"]) {
      expect(readFileSync(join(sourceDir, "artifacts/visuals/topologies", file), "utf8")).toEqual(
        readFileSync(join(packagedDir, "artifacts/visuals/topologies", file), "utf8"),
      );
    }

    // The cached VisualDoc that deck.html's content_spec_hash is computed
    // from — byte-identical (no timestamps anywhere in the doc).
    expect(readJson(join(sourceDir, ".rvs/cache/visualdoc.json"))).toEqual(
      readJson(join(packagedDir, ".rvs/cache/visualdoc.json")),
    );

    // deck.html itself embeds a generated_at timestamp so it can never be
    // byte-identical, but everything derived purely from repo content must
    // match: the content_spec_hash (sha256 of the VisualDoc JSON), the
    // git_commit stamp, and the full ordered list of rendered scene IDs.
    const sourceHtml = readFileSync(join(sourceDir, "artifacts/visuals/deck.html"), "utf8");
    const packagedHtml = readFileSync(join(packagedDir, "artifacts/visuals/deck.html"), "utf8");
    expect(extractAttr(sourceHtml, "content-spec-hash")).toEqual(extractAttr(packagedHtml, "content-spec-hash"));
    expect(extractAttr(sourceHtml, "git-commit")).toEqual(extractAttr(packagedHtml, "git-commit"));
    const sceneIds = (html: string) => [...html.matchAll(/data-scene-id="([^"]*)"/g)].map((m) => m[1]);
    expect(sceneIds(sourceHtml)).toEqual(sceneIds(packagedHtml));
    expect(sceneIds(sourceHtml).length).toBeGreaterThan(0);

    // architecture-intelligence.json: both runs scan the identical
    // committed fixture, so metadata.git_commit is legitimately identical
    // (same rationale as deck.html's git-commit attribute above) and is
    // compared, but metadata.generated_at and
    // metadata.source_repository_model_generated_at are each stamped from
    // that run's own repository-model.json inspect pass and are the only
    // genuinely run-specific (wall-clock) fields — strip only those two.
    const stripArchIntel = (a: Record<string, unknown>) => {
      const { metadata, ...rest } = a as { metadata: Record<string, unknown> } & Record<string, unknown>;
      const { generated_at, source_repository_model_generated_at, ...metadataRest } = metadata;
      return { ...rest, metadata: metadataRest };
    };
    expect(
      stripArchIntel(readJson(join(sourceDir, ".rvs/cache/architecture-intelligence.json")) as Record<string, unknown>),
    ).toEqual(
      stripArchIntel(readJson(join(packagedDir, ".rvs/cache/architecture-intelligence.json")) as Record<string, unknown>),
    );

    // capability-model.json: same rationale — generationMetadata.git_commit
    // is identical, generationMetadata.generated_at and
    // generationMetadata.source_architecture_intelligence_generated_at are
    // the only run-specific (wall-clock) fields.
    const stripCapabilityModel = (c: Record<string, unknown>) => {
      const { generationMetadata, ...rest } = c as { generationMetadata: Record<string, unknown> } & Record<string, unknown>;
      const { generated_at, source_architecture_intelligence_generated_at, ...metadataRest } = generationMetadata;
      return { ...rest, generationMetadata: metadataRest };
    };
    expect(
      stripCapabilityModel(readJson(join(sourceDir, ".rvs/cache/capability-model.json")) as Record<string, unknown>),
    ).toEqual(
      stripCapabilityModel(readJson(join(packagedDir, ".rvs/cache/capability-model.json")) as Record<string, unknown>),
    );

    // CAPABILITIES.md: deterministic markdown derived purely from
    // capability-model.json, except two lines that embed
    // generationMetadata.generated_at / source_architecture_intelligence_generated_at
    // (see packages/capability-intelligence/src/exporter.ts) — strip only
    // those lines (mirrors this file's deck.html generated_at handling)
    // and byte-compare everything else, including the git-commit line.
    const stripTimestampLines = (md: string) =>
      md
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith("> Generated by Repo Visual Studio's Capability Intelligence engine at ") &&
            !line.startsWith("- Generated at:") &&
            !line.startsWith("- Source Architecture Intelligence generated at:"),
        )
        .join("\n");
    expect(
      stripTimestampLines(readFileSync(join(sourceDir, "CAPABILITIES.md"), "utf8")),
    ).toEqual(stripTimestampLines(readFileSync(join(packagedDir, "CAPABILITIES.md"), "utf8")));

    // product-identity-model.json: same rationale as architecture-intelligence.json
    // and capability-model.json above — generationMetadata.generated_at and
    // .source_capability_model_generated_at are the only run-specific
    // (wall-clock, chained from repository-model.json's own inspect-time
    // stamp) fields; git_commit is legitimately identical.
    const stripProductIdentityModel = (p: Record<string, unknown>) => {
      const { generationMetadata, ...rest } = p as { generationMetadata: Record<string, unknown> } & Record<string, unknown>;
      const { generated_at, source_capability_model_generated_at, ...metadataRest } = generationMetadata;
      return { ...rest, generationMetadata: metadataRest };
    };
    expect(
      stripProductIdentityModel(readJson(join(sourceDir, ".rvs/cache/product-identity-model.json")) as Record<string, unknown>),
    ).toEqual(
      stripProductIdentityModel(readJson(join(packagedDir, ".rvs/cache/product-identity-model.json")) as Record<string, unknown>),
    );
    expect(
      stripProductIdentityModel(readJson(join(sourceDir, "product-identity.json")) as Record<string, unknown>),
    ).toEqual(
      stripProductIdentityModel(readJson(join(packagedDir, "product-identity.json")) as Record<string, unknown>),
    );

    // product-identity-candidates.json: a diagnostic dump with no timestamps
    // of its own — byte-identical.
    expect(readFileSync(join(sourceDir, ".rvs/cache/product-identity-candidates.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/product-identity-candidates.json"), "utf8"),
    );

    // showcase-plan.json: `rvs create slides --profile showcase` stamps
    // generationMetadata.generated_at from a direct `new Date().toISOString()`
    // call (not chained from any cached, inspect-time timestamp the way the
    // artifacts above are), and .source_product_identity_generated_at chains
    // from product-identity-model.json's own generated_at — both are the
    // only run-specific fields; strip both and deep-compare the rest,
    // including every scene, claim, and evidence citation.
    const stripShowcasePlan = (p: Record<string, unknown>) => {
      const { generationMetadata, ...rest } = p as { generationMetadata: Record<string, unknown> } & Record<string, unknown>;
      const { generated_at, source_product_identity_generated_at, ...metadataRest } = generationMetadata;
      return { ...rest, generationMetadata: metadataRest };
    };
    expect(
      stripShowcasePlan(readJson(join(sourceDir, ".rvs/cache/showcase-plan.json")) as Record<string, unknown>),
    ).toEqual(
      stripShowcasePlan(readJson(join(packagedDir, ".rvs/cache/showcase-plan.json")) as Record<string, unknown>),
    );
    expect(
      stripShowcasePlan(readJson(join(sourceDir, "showcase-plan.json")) as Record<string, unknown>),
    ).toEqual(
      stripShowcasePlan(readJson(join(packagedDir, "showcase-plan.json")) as Record<string, unknown>),
    );

    // The showcase deck.html / visualdoc.json overwrite the earlier
    // repository-inventory deck, and the portfolio deck.html / visualdoc.json
    // in turn overwrite the showcase one (both runs execute `create slides`,
    // then `--profile showcase`, then `--profile portfolio`, in the same
    // order above — portfolio is last), so the deck.html/visualdoc.json
    // assertions further up this test already re-verify the *portfolio*
    // deck's content-spec-hash, git-commit stamp, and scene-id ordering are
    // identical between source and packaged — no separate portfolio-specific
    // deck assertion is needed here.

    // portfolio-model.json: generationMetadata.generated_at is run-specific
    // (a direct `new Date().toISOString()` call), and each product's own
    // source.sourceProductIdentityGeneratedAt/sourceCapabilityModelGeneratedAt
    // chain from the copied artifact files' own run-specific timestamps —
    // strip all three (via the hoisted stripPortfolioModel above) and
    // deep-compare everything else, including every normalized capability,
    // relationship, gap, and evidence citation.
    expect(
      stripPortfolioModel(readJson(join(sourceDir, ".rvs/cache/portfolio-model.json")) as Record<string, unknown>),
    ).toEqual(stripPortfolioModel(readJson(join(packagedDir, ".rvs/cache/portfolio-model.json")) as Record<string, unknown>));
    expect(
      stripPortfolioModel(readJson(join(sourceDir, "portfolio-model.json")) as Record<string, unknown>),
    ).toEqual(stripPortfolioModel(readJson(join(packagedDir, "portfolio-model.json")) as Record<string, unknown>));

    // portfolio-claims.json / portfolio-decisions.json: neither PortfolioClaim
    // nor PortfolioDecision carries a timestamp field — byte-identical.
    expect(readFileSync(join(sourceDir, ".rvs/cache/portfolio-claims.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/portfolio-claims.json"), "utf8"),
    );
    expect(readFileSync(join(sourceDir, "portfolio-claims.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, "portfolio-claims.json"), "utf8"),
    );
    expect(readFileSync(join(sourceDir, ".rvs/cache/portfolio-decisions.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, ".rvs/cache/portfolio-decisions.json"), "utf8"),
    );
    expect(readFileSync(join(sourceDir, "portfolio-decisions.json"), "utf8")).toEqual(
      readFileSync(join(packagedDir, "portfolio-decisions.json"), "utf8"),
    );

    // portfolio-plan.json: same generationMetadata.generated_at plus the
    // full embedded PortfolioModel's own run-specific fields — reuse
    // stripPortfolioModel for the nested model and strip the plan's own
    // generated_at alongside it.
    const stripPortfolioPlan = (p: Record<string, unknown>) => {
      const { generationMetadata, model, ...rest } = p as {
        generationMetadata: Record<string, unknown>;
        model: Record<string, unknown>;
      } & Record<string, unknown>;
      const { generated_at, ...metadataRest } = generationMetadata;
      return { ...rest, model: stripPortfolioModel(model), generationMetadata: metadataRest };
    };
    expect(
      stripPortfolioPlan(readJson(join(sourceDir, ".rvs/cache/portfolio-plan.json")) as Record<string, unknown>),
    ).toEqual(stripPortfolioPlan(readJson(join(packagedDir, ".rvs/cache/portfolio-plan.json")) as Record<string, unknown>));

    // Reordered-input proof, run through the packaged binary as well as
    // source (not just in-process — synthesizePortfolio's own
    // order-independence proofs in portfolio-intelligence/src/__tests__/
    // index.test.ts never touch the packaged tarball). Reuses the
    // artifact-roots/{product-a,product-b,product-c} directories each dir
    // already has on disk from the pipeline above, so this needs no
    // additional pack/install cost. Runs and asserts last, after every
    // other assertion in this test that reads .rvs/cache/portfolio-model.json
    // or the exported portfolio-model.json, since re-running `synthesize
    // portfolio` here overwrites both with the reversed-order result.
    for (const [run, dir] of runs) {
      writeFileSync(join(dir, ".rvs/portfolio.yml"), portfolioYaml(["product-c", "product-b", "product-a"]));
      run(["synthesize", "portfolio", "--allow-partial"]);
      run(["export", "portfolio-model", "--output", "portfolio-model-reordered.json"]);
    }
    const forwardVsReversed = (dir: string) =>
      expect(stripPortfolioModel(readJson(join(dir, "portfolio-model-reordered.json")) as Record<string, unknown>)).toEqual(
        stripPortfolioModel(readJson(join(dir, "portfolio-model.json")) as Record<string, unknown>),
      );
    forwardVsReversed(sourceDir);
    forwardVsReversed(packagedDir);
    expect(stripPortfolioModel(readJson(join(sourceDir, "portfolio-model-reordered.json")) as Record<string, unknown>)).toEqual(
      stripPortfolioModel(readJson(join(packagedDir, "portfolio-model-reordered.json")) as Record<string, unknown>),
    );

    // Small-portfolio proof: the multi-product scenario above (used for the
    // "large"/reordered/partially-incompatible dimensions) fully replaced
    // this test's original single-product scenario, so re-add it here as a
    // minimal, cheap check reusing the same already-installed tarball (no
    // additional pack/install cost) — confirms source and packaged stay
    // equivalent for the smallest possible portfolio input too.
    for (const [run, dir] of runs) {
      writeFileSync(join(dir, ".rvs/portfolio.yml"), portfolioYaml(["product-a"]));
      run(["synthesize", "portfolio"]);
      run(["export", "portfolio-model", "--output", "portfolio-model-small.json"]);
    }
    expect(stripPortfolioModel(readJson(join(sourceDir, "portfolio-model-small.json")) as Record<string, unknown>)).toEqual(
      stripPortfolioModel(readJson(join(packagedDir, "portfolio-model-small.json")) as Record<string, unknown>),
    );

    // -----------------------------------------------------------------------
    // Architecture Governance (Milestone 7), through both source and packaged
    // CLI. Reuses the same sourceDir/packagedDir/runs from the pipeline above
    // -- including their already-cached architecture-intelligence.json/
    // capability-model.json/product-identity-model.json/portfolio-model.json
    // -- rather than a second pack/install. Deliberately NOT the last thing
    // this test does (Architecture Decision Intelligence, below, is): the
    // final `create slides --profile governance` step below overwrites
    // deck.html/visualdoc.json with the governance deck, which would
    // invalidate the portfolio deck.html/git-commit/scene-id assertions
    // earlier in this test (see the note above the reordered-input proof) if
    // it ran any sooner, and is itself overwritten again by the decisions
    // deck further down.
    //
    // Every governance-intelligence contract carries the same uniform
    // `generation: { generated_at }` wall-clock field (see contracts.ts's
    // determinism note at the top of that file), and the *only* other
    // timestamp field names that package's contracts define anywhere are
    // IntelligenceSnapshot artifact digests' `source_generated_at` and
    // GovernanceBaseline's own `established_at` -- a small, closed set. The
    // snapshot/baseline files below additionally embed the *raw* upstream
    // architecture/capability/product/portfolio JSON as `rawArtifacts` (see
    // governance-cache.ts's top-of-file comment on the { snapshot,
    // rawArtifacts } envelope), each carrying its own already-established
    // run-specific field names from elsewhere in this file (generated_at,
    // generationMetadata.generated_at/source_*_generated_at,
    // source*GeneratedAt), arbitrarily deep (portfolio-model.json's
    // excludedProducts chain in particular). Strip every field ending in
    // "generated_at"/"GeneratedAt" (case as each family already spells it)
    // or named exactly "established_at", recursively, wherever it appears --
    // the exact same field names this file already treats as legitimately
    // run-specific everywhere else, just applied generically instead of
    // per-artifact-type.
    //
    // That alone is NOT sufficient here, unlike every non-governance artifact
    // above: snapshot.ts's digestOf() hashes each upstream artifact's raw,
    // *unstripped* JSON (see snapshot.ts's digestOf/canonicalize), so a
    // GovernanceArtifactDigest's own `digest` -- and therefore the
    // snapshot's `id` (a pure function of its four artifact digests, see
    // ids.ts's buildSnapshotId), and in turn every `id`/`source_snapshot_id`/
    // `target_snapshot_id` on every change-set/evaluation/report/narrative/
    // plan/baseline built FROM that snapshot id (ids.ts's buildChangeSetId/
    // buildEvaluationId/buildReportId/buildNarrativeId/buildPlanId/
    // buildBaselineId) -- are themselves wall-clock-contaminated, one level
    // removed.
    //
    // Worse, this cascades past structured id fields into human-readable
    // prose: GovernanceNarrative's claims embed the *concatenation* of both
    // report ids inside `claims[].id` (e.g.
    // "governance:claim:policy_compliance:governance-report-<snapshot-id>-
    // <snapshot-id>"), and free-text fields like `claims[].text` and the
    // top-level `summary` interpolate the same snapshot id verbatim inside a
    // sentence ("Comparing snapshot \"<snapshot-id>\" to \"<snapshot-id>\"
    // ..."). No fixed set of field names can catch every place a
    // digest-derived id can surface once it flows into narrative prose. This
    // was confirmed empirically in three stages: (1) a version stripping
    // only known timestamp field names still failed on
    // snapshot.artifacts[].digest and snapshot.id; (2) a version additionally
    // stripping `digest` and `id`/`source_snapshot_id`/`target_snapshot_id`
    // on objects with a `generation` sibling still failed on
    // GovernanceBaseline's own `id` (it has no `generation` wrapper, only
    // `established_at`); (3) even after covering both `generation`- and
    // `established_at`-marked objects, it still failed on
    // governance-narrative.json's `claims[].id`/`claims[].text` and
    // governance-report.json's `summary`, none of which are bare id fields.
    //
    // Rather than keep chasing individual field names/shapes, scrub every
    // sha256 hex digest substring (digestOf() always produces exactly 64
    // lowercase hex characters, see snapshot.ts) out of every string value,
    // recursively, regardless of field name or nesting depth. This
    // canonicalizes any digest-derived id or any id embedded in prose to the
    // same placeholder on both sides, while a raw `digest` field (itself
    // just one such 64-hex-char string) is caught by the same substitution.
    // This deliberately does NOT touch entity-level ids that live inside a
    // `changes`/`entries` array (GovernanceChangeEntry.id, BlastRadiusEntry.
    // id, GovernanceFinding.id, etc.) -- those are pure functions of stable
    // entity ids, not snapshot digests (ids.ts's buildChangeId/
    // buildBlastRadiusEntryId/buildFindingId), contain no digest substring,
    // and are exactly the kind of determinism this test exists to prove.
    const isGovernanceTimestampKey = (key: string) => key === "established_at" || key.endsWith("generated_at") || key.endsWith("GeneratedAt");
    const SHA256_HEX_PATTERN = /[0-9a-f]{64}/g;
    const stripGovernanceTimestamps = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripGovernanceTimestamps);
      if (typeof value === "string") return value.replace(SHA256_HEX_PATTERN, "<digest>");
      if (value === null || typeof value !== "object") return value;
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (isGovernanceTimestampKey(key)) continue;
        out[key] = stripGovernanceTimestamps(val);
      }
      return out;
    };

    for (const [run, dir] of runs) {
      // architecture-intelligence.json/capability-model.json/
      // product-identity-model.json/portfolio-model.json are all still
      // cached in .rvs/cache/ from the pipeline above (portfolio-model.json
      // reflects the small, single-product synthesis re-run immediately
      // above -- still a valid, complete portfolio artifact) -- `snapshot
      // create --include-portfolio` fingerprints all four.
      run(["snapshot", "create", "--name", "baseline-snapshot", "--include-portfolio"]);

      // Minimal valid .rvs/governance.yml: schema_version 1 plus a baseline
      // pointing at the file `governance baseline set` below writes (per
      // governance-baseline.ts's own hint log: baseline.snapshot
      // ".rvs/cache/governance/baseline-snapshot.json") -- byte-identical
      // between the two dirs, no run-specific content.
      writeFileSync(
        join(dir, ".rvs/governance.yml"),
        ["schema_version: 1", "baseline:", "  snapshot: .rvs/cache/governance/baseline-snapshot.json", ""].join("\n"),
      );

      run(["governance", "baseline", "set", "baseline-snapshot"]);

      // Second snapshot off the *same*, unchanged cache -- the minimum-bar
      // zero-change case: baseline-snapshot and current-snapshot fingerprint
      // identical artifact bytes, so the compare below reports full
      // compatibility with zero changes/findings for both runs alike.
      run(["snapshot", "create", "--name", "current-snapshot", "--include-portfolio"]);

      run(["governance", "compare", "--from", "baseline-snapshot", "--to", "current-snapshot"]);
      // No `policies:` key is configured above, so there is nothing for
      // --ci to fail on -- safe to pass --ci here and still expect a zero
      // exit code for both runs (execFileSync throws on a non-zero exit,
      // which would fail this test outright if that assumption were wrong).
      run(["governance", "check", "--from", "baseline-snapshot", "--to", "current-snapshot", "--ci"]);

      run(["export", "governance-report", "--output", "governance-report.json"]);
      run(["export", "governance-summary", "--output", "governance-summary.md"]);

      run(["create", "slides", "--profile", "governance"]);
    }

    // baseline-snapshot.json / current-snapshot.json under .rvs/cache/
    // governance/snapshots/: both saved as this CLI's own { snapshot,
    // rawArtifacts } envelope -- strip the timestamp fields and deep-compare
    // everything else, including every embedded raw artifact.
    for (const filename of ["baseline-snapshot.json", "current-snapshot.json"]) {
      expect(stripGovernanceTimestamps(readJson(join(sourceDir, ".rvs/cache/governance/snapshots", filename)))).toEqual(
        stripGovernanceTimestamps(readJson(join(packagedDir, ".rvs/cache/governance/snapshots", filename))),
      );
    }

    // .rvs/cache/governance/baseline-snapshot.json: the promoted
    // GovernanceBaselineFile (GovernanceBaseline + embedded rawArtifacts) --
    // distinct from the same-named file under snapshots/ above.
    expect(stripGovernanceTimestamps(readJson(join(sourceDir, ".rvs/cache/governance/baseline-snapshot.json")))).toEqual(
      stripGovernanceTimestamps(readJson(join(packagedDir, ".rvs/cache/governance/baseline-snapshot.json"))),
    );

    // Every GOVERNANCE_OUTPUT_FILES artifact `governance compare` cached to
    // .rvs/cache/governance/ (see writeGovernanceOutputs's call site in
    // governance-compare.ts): current-snapshot's own re-saved fingerprint,
    // each of the four domain change sets, the evidence diff, the blast
    // radius assessment, the merged findings list, and the assembled report,
    // narrative, and plan.
    for (const filename of [
      "current-snapshot.json",
      "architecture-changes.json",
      "capability-changes.json",
      "product-changes.json",
      "portfolio-changes.json",
      "evidence-changes.json",
      "blast-radius.json",
      "governance-findings.json",
      "governance-report.json",
      "governance-narrative.json",
      "governance-plan.json",
    ]) {
      expect(stripGovernanceTimestamps(readJson(join(sourceDir, ".rvs/cache/governance", filename)))).toEqual(
        stripGovernanceTimestamps(readJson(join(packagedDir, ".rvs/cache/governance", filename))),
      );
    }

    // rvs export governance-report's written copy of governance-report.json.
    expect(stripGovernanceTimestamps(readJson(join(sourceDir, "governance-report.json")))).toEqual(
      stripGovernanceTimestamps(readJson(join(packagedDir, "governance-report.json"))),
    );
    // governance-summary.md embeds no timestamp of its own, but it does
    // quote the same digest-derived snapshot id (and the narrative prose
    // built from it) that governance-report.json/governance-narrative.json
    // above needed stripGovernanceTimestamps for -- reuse the same digest
    // scrub (it also handles plain strings, not just JSON values) rather
    // than compare byte-identical.
    expect(stripGovernanceTimestamps(readFileSync(join(sourceDir, "governance-summary.md"), "utf8"))).toEqual(
      stripGovernanceTimestamps(readFileSync(join(packagedDir, "governance-summary.md"), "utf8")),
    );

    // The final `create slides --profile governance` step above overwrote
    // deck.html/visualdoc.json with the governance deck -- re-verify the
    // same run-content-derived properties the portfolio deck's assertions
    // above already established a pattern for (the cached VisualDoc itself,
    // content-spec-hash, git-commit, and the full ordered scene-id list), now
    // for the governance deck. Unlike the portfolio deck, the governance
    // deck's `governance create-slides` profile interpolates the same
    // digest-derived snapshot id into the document title, scene headlines,
    // and every scene/plan id (see governance-compare.ts's narrative/plan
    // assembly) -- so visualdoc.json and the scene ids extracted from
    // deck.html need the same stripGovernanceTimestamps digest scrub as the
    // governance-report.json/governance-summary.md assertions above, not a
    // raw toEqual.
    expect(stripGovernanceTimestamps(readJson(join(sourceDir, ".rvs/cache/visualdoc.json")))).toEqual(
      stripGovernanceTimestamps(readJson(join(packagedDir, ".rvs/cache/visualdoc.json"))),
    );
    const sourceGovernanceHtml = readFileSync(join(sourceDir, "artifacts/visuals/deck.html"), "utf8");
    const packagedGovernanceHtml = readFileSync(join(packagedDir, "artifacts/visuals/deck.html"), "utf8");
    expect(extractAttr(sourceGovernanceHtml, "git-commit")).toEqual(extractAttr(packagedGovernanceHtml, "git-commit"));
    const governanceSceneIds = (html: string) =>
      [...html.matchAll(/data-scene-id="([^"]*)"/g)].map((m) => stripGovernanceTimestamps(m[1]));
    expect(governanceSceneIds(sourceGovernanceHtml)).toEqual(governanceSceneIds(packagedGovernanceHtml));
    expect(governanceSceneIds(sourceGovernanceHtml).length).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // Architecture Decision Intelligence (Milestone 8), through both source
    // and packaged CLI. Reuses the same sourceDir/packagedDir/runs -- no
    // second pack/install needed. Ordered right after the governance block:
    // the final `create slides --profile decisions` step below overwrites
    // deck.html/visualdoc.json with the decisions deck, which would
    // invalidate the governance deck.html/git-commit/scene-id assertions
    // just above if it ran any sooner. (The knowledge-graph block further
    // below now runs after this one and overwrites deck.html/visualdoc.json
    // once more with the knowledge-graph deck -- see its own comment for why
    // that ordering is safe for these decisions-deck assertions too.)
    //
    // Unlike governance-intelligence, decision-intelligence's ids/digests
    // (ids.ts's buildDecisionId/buildSnapshotId/buildChangeSetId/
    // buildNarrativeId/buildPlanId/buildReportId, all confirmed pure content-
    // hash/concatenation functions with no timestamp input) never fold the
    // wall-clock `generated_at` into any id or digest, and per contracts.ts's
    // own determinism note, `generated_at` is the ONLY wall-clock field this
    // package's contracts define anywhere -- confirmed against narrative.ts
    // and decision-plan.ts, which both thread `generatedAt` through to
    // nothing but their own top-level `generated_at` field, never into scene/
    // section prose. So stripping every key literally named `generated_at`
    // covers every *wall-clock* source of divergence.
    //
    // A second, unrelated source of divergence remains, though: snapshot.ts's
    // buildDecisionSnapshot builds `repository_id` from
    // `basename(repoRoot)` (decisions-analyze.ts's own comment flags this as
    // a deliberate judgment call -- "No repository-model artifact is read
    // anywhere in this pipeline, so the repository root's own basename is
    // the simplest stable, dependency-free repository id available"). Since
    // sourceDir and packagedDir are two distinct mkdtempSync() directories
    // (different basenames), `repository_id` -- and therefore
    // buildSnapshotId's `id`, and every id/source_snapshot_id/
    // target_snapshot_id built from it downstream (changeSet, narrative,
    // plan, report; see ids.ts's buildChangeSetId/buildNarrativeId/
    // buildPlanId/buildReportId) -- legitimately differs between the two
    // runs even though the underlying decision content is byte-identical.
    // This is the same *shape* of problem stripGovernanceTimestamps' sha256
    // scrub solves for governance's digest-derived ids, just via a literal
    // directory-basename substring instead of a hex digest, so it needs the
    // analogous fix: scrub both runs' own basenames out of every string
    // value before comparing.
    const sourceRepoId = basename(sourceDir);
    const packagedRepoId = basename(packagedDir);
    const scrubRepoId = (text: string): string => text.split(sourceRepoId).join("<repo-id>").split(packagedRepoId).join("<repo-id>");
    const stripDecisionTimestamps = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripDecisionTimestamps);
      if (typeof value === "string") return scrubRepoId(value);
      if (value === null || typeof value !== "object") return value;
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (key === "generated_at") continue;
        out[key] = stripDecisionTimestamps(val);
      }
      return out;
    };

    for (const [run, dir] of runs) {
      // `.rvs/decisions.yml` is written per-run (not baked into the
      // git-committed fixture) because `.rvs/` itself is only created once
      // `rvs init` has run -- exactly mirroring `.rvs/governance.yml`'s
      // per-run write above. `type: adr` forces classifyDecisionSource's
      // configured-path branch (classification_basis "configured_path"), so
      // docs/decisions/0001-use-example-database.md is picked up
      // deterministically.
      writeFileSync(join(dir, ".rvs/decisions.yml"), ["schema_version: 1", "sources:", "  - path: docs/decisions", "    type: adr", ""].join("\n"));

      run(["decisions", "analyze"]);
      // Re-runs the same full analysis (decisions-validate.ts calls
      // runDecisionAnalysis itself) plus validation -- no --ci here, this
      // suite proves structural equivalence, not severity-gating behavior
      // (already covered in-process by decisions-cli.test.ts), so a
      // non-zero exit here would only ever indicate an unrelated regression.
      run(["decisions", "validate"]);
      // --from points at the decision-snapshot.json the `analyze` call above
      // just cached; --to is omitted, so runDecisionsCompare runs a second,
      // fresh `runDecisionAnalysis` internally as the target (decisions-
      // compare.ts) -- against the same unchanged fixture content, so every
      // decision-cache file this second internal analysis re-writes stays
      // byte-for-byte content-equal to the first (only `generated_at`
      // differs), and the diff itself reports full compatibility with the
      // single fixture decision "unchanged".
      run(["decisions", "compare", "--from", ".rvs/cache/decisions/decision-snapshot.json"]);
      run(["export", "decision-report", "--output", "decision-report.json"]);
      run(["export", "decision-summary", "--output", "decision-summary.md"]);
      run(["create", "slides", "--profile", "decisions"]);
    }

    // Every DECISION_OUTPUT_FILES artifact `decisions analyze`/`validate`/
    // `compare` cached to .rvs/cache/decisions/ (decision-changes.json is
    // compare-only; every other file is (re)written by the second, internal
    // analysis `compare` triggers). stripDecisionTimestamps is a safe no-op
    // on the twelve of these seventeen files that carry no `generated_at`
    // field at all (contracts.ts) -- applied uniformly rather than
    // special-cased per file, for the same reason stripGovernanceTimestamps
    // is applied uniformly to governance's own output set above.
    for (const filename of [
      "decision-snapshot.json",
      "decisions.json",
      "decision-links.json",
      "assumptions.json",
      "consequences.json",
      "dependencies.json",
      "supersession.json",
      "conflicts.json",
      "implementation-state.json",
      "coverage.json",
      "drift.json",
      "decision-debt.json",
      "decision-changes.json",
      "decision-claims.json",
      "decision-narrative.json",
      "decision-plan.json",
      "decision-report.json",
    ]) {
      expect(stripDecisionTimestamps(readJson(join(sourceDir, ".rvs/cache/decisions", filename)))).toEqual(
        stripDecisionTimestamps(readJson(join(packagedDir, ".rvs/cache/decisions", filename))),
      );
    }

    // rvs export decision-report's written copy of decision-report.json.
    expect(stripDecisionTimestamps(readJson(join(sourceDir, "decision-report.json")))).toEqual(
      stripDecisionTimestamps(readJson(join(packagedDir, "decision-report.json"))),
    );
    // decision-summary.md quotes narrative.source_snapshot_id and plan scene
    // titles -- both repository_id-tainted per the note above -- so it needs
    // the same scrubRepoId pass as the JSON artifacts (it also handles plain
    // strings, not just JSON values), mirroring governance-summary.md's own
    // stripGovernanceTimestamps reuse just above.
    expect(scrubRepoId(readFileSync(join(sourceDir, "decision-summary.md"), "utf8"))).toEqual(
      scrubRepoId(readFileSync(join(packagedDir, "decision-summary.md"), "utf8")),
    );

    // The final `create slides --profile decisions` step above overwrote
    // deck.html/visualdoc.json with the decisions deck. decision-
    // visualdoc-builder.ts's buildDecisionVisualDoc interpolates
    // plan.source_snapshot_id into `document.title`, and buildSceneId
    // (ids.ts) interpolates the same repository_id-tainted planId into every
    // scene id -- so, exactly like the governance deck above, this needs
    // stripDecisionTimestamps on visualdoc.json and content-spec-hash
    // (a hash of that same repository_id-tainted document) is not
    // meaningfully comparable and is deliberately not asserted here, mirroring
    // the governance deck assertions' own precedent just above (git-commit
    // and the stripped scene-id list only).
    expect(stripDecisionTimestamps(readJson(join(sourceDir, ".rvs/cache/visualdoc.json")))).toEqual(
      stripDecisionTimestamps(readJson(join(packagedDir, ".rvs/cache/visualdoc.json"))),
    );
    const sourceDecisionsHtml = readFileSync(join(sourceDir, "artifacts/visuals/deck.html"), "utf8");
    const packagedDecisionsHtml = readFileSync(join(packagedDir, "artifacts/visuals/deck.html"), "utf8");
    expect(extractAttr(sourceDecisionsHtml, "git-commit")).toEqual(extractAttr(packagedDecisionsHtml, "git-commit"));
    const decisionSceneIds = (html: string) => [...html.matchAll(/data-scene-id="([^"]*)"/g)].map((m) => scrubRepoId(m[1]));
    expect(decisionSceneIds(sourceDecisionsHtml)).toEqual(decisionSceneIds(packagedDecisionsHtml));
    expect(decisionSceneIds(sourceDecisionsHtml).length).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // Architecture Knowledge Graph & Impact Analysis (Milestone 9), through
    // both source and packaged CLI. Reuses the same sourceDir/packagedDir/
    // runs -- no second pack/install needed, and no additional fixture
    // writing either: `rvs graph build` reads the six upstream intelligence
    // caches this test has already populated above (architecture/
    // capability/product/portfolio from the synthesize pipeline near the
    // top of this test, governance from the governance block, decision from
    // the decisions block immediately above). Deliberately the LAST thing
    // this test does: the final `create slides --profile knowledge-graph`
    // step below overwrites deck.html/visualdoc.json with the knowledge
    // graph deck, which would invalidate the decisions deck.html/git-commit/
    // scene-id assertions just above if it ran any sooner.
    //
    // Unlike decision-intelligence's repository_id (basename(repoRoot)
    // -derived -- see stripDecisionTimestamps/scrubRepoId above) and
    // governance-intelligence's sha256-digest-derived ids (see
    // stripGovernanceTimestamps above), every knowledge-graph id is a pure
    // function of (a) the *resolved* repository_id -- graph-builder.ts's
    // resolveRepositoryId prefers architecture.identity.id first, which is
    // itself deterministic from the fixed package.json project name (see
    // buildFixture's own comment), never decision's basename-tainted one --
    // and (b) which of the six upstream domains are present. graph-build.ts
    // never populates KnowledgeGraphBuildInput's optional `artifactMeta`, so
    // buildUpstreamArtifactDigest's `snapshotId` is always undefined and
    // every upstream-artifact digest token collapses to a plain
    // "<domain>:<provenance>" string (snapshot.ts) -- never a wall-clock or
    // content-hash value. And although this fixture's architecture-based
    // repository_id genuinely disagrees with decision's basename-tainted
    // one (tripping compatibility.ts's stage-2 "repository identity
    // mismatch" check -- confirmed by reading compatibility.ts directly),
    // the resulting reason text (which does embed the raw, basename-tainted
    // decision repository_id) is never persisted into any
    // KNOWLEDGE_GRAPH_OUTPUT_FILES cache: narrative.ts/graph-plan.ts's
    // scene builders only ever consume `validationFindings`/
    // `snapshot.upstream_artifacts` (counts and a `provenance` enum, not
    // the reasons array), and `compatibility.reasons` itself is neither
    // cached nor logged anywhere but `rvs graph validate`'s own stdout,
    // which -- like every other command in this test -- is never asserted
    // on here. So every knowledge-graph id/artifact below is directly
    // source-vs-packaged comparable with nothing but a literal
    // `generated_at` key strip (confirmed against contracts.ts, which
    // defines `generated_at` only on GraphReport/KnowledgeGraphNarrative/
    // KnowledgeGraphPlan, never folded into any id or embedded in prose).
    const stripGraphTimestamps = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripGraphTimestamps);
      if (value === null || typeof value !== "object") return value;
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (key === "generated_at") continue;
        out[key] = stripGraphTimestamps(val);
      }
      return out;
    };

    for (const [run, dir] of runs) {
      run(["graph", "build"]);
      // No `--ci` here, mirroring `decisions validate`'s own precedent just
      // above: this fixture's real architecture-vs-decision repository_id
      // mismatch (see the comment above) legitimately produces a blocking
      // GRAPH_COMPATIBILITY_INCOMPATIBLE_SET finding, and `--ci` would turn
      // that into a non-zero exit code that execFileSync would throw on --
      // an unrelated regression here would surface as a build-output diff
      // below regardless, and the CI-gating behavior itself is already
      // covered in-process by graph-cli.test.ts's `graph validate --ci`
      // tests.
      run(["graph", "validate"]);
    }

    // nodes.json is fully deterministic given identical upstream artifact
    // content (see above), so a real node id read back from the source
    // run's own cache is valid against the packaged run too -- mirroring
    // graph-cli.test.ts's `graph explain`/`graph inspect` happy-path
    // precedent of resolving a real id rather than guessing buildNodeId's
    // sanitize() output. The repository node (present whenever
    // architecture.identity is, which it is here) `contains` every
    // component node (edge-builder.ts's buildArchitectureContainmentEdges),
    // giving a guaranteed length-1 path between the two for `graph path`.
    const sourceGraphNodes = JSON.parse(readFileSync(join(sourceDir, ".rvs/cache/knowledge-graph/nodes.json"), "utf8")) as Array<{
      id: string;
      node_type: string;
    }>;
    const repositoryNode = sourceGraphNodes.find((n) => n.node_type === "repository");
    const componentNode = sourceGraphNodes.find((n) => n.node_type === "component");
    expect(repositoryNode).toBeDefined();
    expect(componentNode).toBeDefined();
    const graphEntityId = componentNode!.id;

    for (const [run, dir] of runs) {
      run(["graph", "inspect", graphEntityId]);
      run(["graph", "impact", graphEntityId]);
      run(["graph", "path", repositoryNode!.id, graphEntityId]);
      run(["graph", "roots"]);
      run(["graph", "plan-change", "--remove", graphEntityId]);
      run(["graph", "explain", graphEntityId]);
      run(["export", "graph-report", "--output", "graph-report.json"]);
      run(["export", "impact-summary", "--output", "impact-summary.md"]);
      run(["create", "slides", "--profile", "knowledge-graph"]);
    }

    // Every KNOWLEDGE_GRAPH_OUTPUT_FILES artifact `graph build`/`graph
    // impact`/`graph roots`/`graph plan-change` cached to
    // .rvs/cache/knowledge-graph/ (graph-changes.json is compare-only and
    // this block never runs `graph compare`, so it is deliberately excluded
    // from this list).
    for (const filename of [
      "graph-snapshot.json",
      "nodes.json",
      "edges.json",
      "unresolved-links.json",
      "impact-results.json",
      "root-cause-groups.json",
      "decision-impact.json",
      "change-plan.json",
      "graph-narrative.json",
      "graph-plan.json",
      "graph-report.json",
    ]) {
      expect(stripGraphTimestamps(readJson(join(sourceDir, ".rvs/cache/knowledge-graph", filename)))).toEqual(
        stripGraphTimestamps(readJson(join(packagedDir, ".rvs/cache/knowledge-graph", filename))),
      );
    }

    // rvs export graph-report's written copy of graph-report.json.
    expect(stripGraphTimestamps(readJson(join(sourceDir, "graph-report.json")))).toEqual(
      stripGraphTimestamps(readJson(join(packagedDir, "graph-report.json"))),
    );
    // impact-summary.md (export-impact-summary.ts's buildImpactSummaryMarkdown)
    // quotes only the impact query's entity node id, direction, and various
    // counts -- all content-derived, none repository_id- or timestamp-tainted
    // (unlike governance-summary.md/decision-summary.md above) -- so a plain
    // byte-for-byte comparison is valid here with no stripping needed.
    expect(readFileSync(join(sourceDir, "impact-summary.md"), "utf8")).toEqual(
      readFileSync(join(packagedDir, "impact-summary.md"), "utf8"),
    );

    // The final `create slides --profile knowledge-graph` step above
    // overwrote deck.html/visualdoc.json with the knowledge graph deck.
    // graph-plan.ts's buildSceneId interpolates planId (itself derived from
    // snapshot.id, which -- per the comment above -- is not repository_id-
    // or digest-tainted here) into every scene id, so stripGraphTimestamps
    // alone (rather than a scrubRepoId-style substring scrub) is enough for
    // visualdoc.json and the scene ids extracted from deck.html, mirroring
    // the governance/decisions deck assertions' own precedent just above.
    expect(stripGraphTimestamps(readJson(join(sourceDir, ".rvs/cache/visualdoc.json")))).toEqual(
      stripGraphTimestamps(readJson(join(packagedDir, ".rvs/cache/visualdoc.json"))),
    );
    const sourceGraphHtml = readFileSync(join(sourceDir, "artifacts/visuals/deck.html"), "utf8");
    const packagedGraphHtml = readFileSync(join(packagedDir, "artifacts/visuals/deck.html"), "utf8");
    expect(extractAttr(sourceGraphHtml, "git-commit")).toEqual(extractAttr(packagedGraphHtml, "git-commit"));
    const graphSceneIds = (html: string) => [...html.matchAll(/data-scene-id="([^"]*)"/g)].map((m) => m[1]);
    expect(graphSceneIds(sourceGraphHtml)).toEqual(graphSceneIds(packagedGraphHtml));
    expect(graphSceneIds(sourceGraphHtml).length).toBeGreaterThan(0);

    // --- `rvs graph review` (Milestone 10.4) -------------------------------
    //
    // The change review is the one artifact a reviewer reads *instead of* the
    // caches behind it, so a packaging divergence in it would be invisible
    // everywhere else in this file. Both engines archive the graph they just
    // built, add one component, rebuild, and review the pair -- so the input
    // to the review is itself produced by the engine under test rather than
    // handed to both.
    //
    // The comparison is byte-for-byte with nothing stripped. Every id in the
    // document is content-derived (see the knowledge-graph comment above),
    // the artifact embeds no wall-clock value, and the review is written from
    // the same two snapshot directories in both roots -- so an ordering
    // defect, a differently-bundled asset, or a stale dependency would show
    // up here as a diff rather than being normalised away.
    const archiveSnapshot = (dir: string, name: string): void => {
      mkdirSync(join(dir, name), { recursive: true });
      for (const file of ["graph-snapshot.json", "nodes.json", "edges.json"]) {
        cpSync(join(dir, ".rvs/cache/knowledge-graph", file), join(dir, name, file));
      }
    };

    const reviewOutput = new Map<string, string>();
    for (const [run, dir] of runs) {
      archiveSnapshot(dir, "snapshot-before");

      // One added component: a real, minimal architectural difference, added
      // to the cached architecture artifact rather than to the fixture
      // source, so that neither engine re-scans and the two runs differ in
      // nothing but the code path under test.
      const archPath = join(dir, ".rvs/cache/architecture-intelligence.json");
      const architecture = JSON.parse(readFileSync(archPath, "utf8")) as { components: unknown[] };
      architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
      writeFileSync(archPath, JSON.stringify(architecture));
      run(["graph", "build"]);
      archiveSnapshot(dir, "snapshot-after");

      reviewOutput.set(
        dir,
        run(["graph", "review", "--from", "snapshot-before", "--to", "snapshot-after", "--output", "change-review.html"]),
      );
    }

    const sourceReview = readFileSync(join(sourceDir, "change-review.html"), "utf8");
    const packagedReview = readFileSync(join(packagedDir, "change-review.html"), "utf8");
    expect(sourceReview).toEqual(packagedReview);
    // Not vacuous: the review really did draw the added component.
    expect(sourceReview).toContain("Reporting Service");
    // And both engines reported the same digest, change count and coverage.
    expect(reviewOutput.get(sourceDir)).toEqual(reviewOutput.get(packagedDir));
  });

  // -------------------------------------------------------------------------
  // Milestone 8.1 item 8: source/package equivalence coverage for the two
  // named governance-integration workflows (item 7's own end-to-end tests,
  // decisions-governance-e2e.test.ts, prove the workflows' *behavior*
  // in-process; this proves packaging introduces no divergence in that same
  // behavior). Runs in two fresh, minimal, non-git temp dirs (reusing the
  // already-built tarball from beforeAll rather than re-packing) rather than
  // reusing sourceDir/packagedDir above, since those two workflows need their
  // own purpose-built .rvs/decisions.yml + .rvs/governance.yml + injected
  // architecture-intelligence.json content, and running after the giant test
  // above would otherwise mix this fixture's content with that one's
  // already-committed ADR-0001/docs/decisions fixture.
  //
  // Workflow A (architecture-change-missing-decision -> governance check
  // exit code): a `missing_decision_rules` entry targets
  // "component:api-gateway"; a "before" snapshot has no such component, an
  // "after" snapshot adds it, and no decision links to it -- so
  // `require_decision_for_change` must fail and --ci must exit 1.
  //
  // Workflow B (accepted-decision-with-contradicted-assumption -> drift ->
  // governance finding -> CI result): an accepted decision declares a
  // "[contradicted]" assumption -- so `forbid_contradicted_assumption` must
  // fail and --ci must exit 1, independent of any architecture change.
  //
  // Both workflows run through one combined governance.yml/decisions.yml so
  // a single `governance check --ci` call proves both at once, instead of
  // paying for a second `npm install --no-save` per workflow.
  it("produces equivalent missing-decision and contradicted-assumption governance results from source and from the tarball", () => {
    const wfSourceDir = mkdtempSync(join(tmpdir(), "rvs-equiv-decgov-source-"));
    const wfPackagedDir = mkdtempSync(join(tmpdir(), "rvs-equiv-decgov-packaged-"));
    try {
      writeFileSync(join(wfPackagedDir, "package.json"), JSON.stringify({ name: "rvs-decgov-equivalence-fixture", version: "1.0.0" }, null, 2));
      execFileSync("npm", ["install", "--no-save", tarballPath], { cwd: wfPackagedDir, stdio: "inherit" });

      function execCapture(bin: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
        try {
          const stdout = execFileSync(bin, args, { cwd, encoding: "utf8" });
          return { status: 0, stdout, stderr: "" };
        } catch (err) {
          const e = err as { status: number | null; stdout?: string; stderr?: string };
          return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
        }
      }

      const engines: Array<{ label: string; dir: string; run: (args: string[]) => string; capture: (args: string[]) => { status: number; stdout: string; stderr: string } }> = [
        { label: "source", dir: wfSourceDir, run: (args) => execFileSync(tsxBin, [cliEntry, ...args], { cwd: wfSourceDir, encoding: "utf8" }), capture: (args) => execCapture(tsxBin, [cliEntry, ...args], wfSourceDir) },
        { label: "packaged", dir: wfPackagedDir, run: (args) => execFileSync("npx", ["rvs", ...args], { cwd: wfPackagedDir, encoding: "utf8" }), capture: (args) => execCapture("npx", ["rvs", ...args], wfPackagedDir) },
      ];

      const decisionsYaml = [
        "schema_version: 1",
        "sources:",
        "  - path: docs/decisions",
        "    type: adr",
        "missing_decision_rules:",
        "  - rule_kind: runtime_entrypoint_change_without_decision",
        "    affected_entity_ids:",
        "      - component:api-gateway",
        "",
      ].join("\n");

      const adrFixture = [
        "---",
        "id: ADR-0001",
        "status: accepted",
        "assumptions:",
        '  - "[contradicted] The vendor API remains stable."',
        "---",
        "",
        "# Depend on the vendor payments API",
        "",
        "## Decision",
        "",
        "We will depend on the vendor payments API for settlement.",
        "",
      ].join("\n");

      const governanceYaml = ["schema_version: 1", "policies:", "  - .rvs/policies/decision-governance.yml", ""].join("\n");

      const policyYaml = [
        "schema_version: 1",
        "name: Decision Governance Policy",
        "rules:",
        "  - id: require-decision-for-change",
        "    title: Require decision for change",
        "    description: Every changed component must be linked to a decision.",
        "    kind: require_decision_for_change",
        "    condition:",
        "      kind: require_decision_for_change",
        "    severity: blocking",
        "    enabled: true",
        "  - id: forbid-contradicted-assumption",
        "    title: Forbid contradicted assumptions",
        "    description: No accepted decision may carry a contradicted assumption.",
        "    kind: forbid_contradicted_assumption",
        "    condition:",
        "      kind: forbid_contradicted_assumption",
        "    severity: blocking",
        "    enabled: true",
        "",
      ].join("\n");

      for (const { dir, run } of engines) {
        mkdirSync(join(dir, ".rvs/cache"), { recursive: true });
        mkdirSync(join(dir, ".rvs/policies"), { recursive: true });
        mkdirSync(join(dir, "docs/decisions"), { recursive: true });

        writeFileSync(join(dir, ".rvs/decisions.yml"), decisionsYaml);
        writeFileSync(join(dir, "docs/decisions/0001-vendor-api.md"), adrFixture);
        writeFileSync(join(dir, ".rvs/governance.yml"), governanceYaml);
        writeFileSync(join(dir, ".rvs/policies/decision-governance.yml"), policyYaml);

        // `snapshot create` refuses a partial snapshot unless every domain
        // (architecture/capability/product) is cached -- capability/product
        // content is irrelevant to either workflow.
        writeFileSync(join(dir, ".rvs/cache/capability-model.json"), JSON.stringify({}));
        writeFileSync(join(dir, ".rvs/cache/product-identity-model.json"), JSON.stringify({}));

        // "before": no component:api-gateway.
        writeFileSync(join(dir, ".rvs/cache/architecture-intelligence.json"), JSON.stringify({ components: [] }));
        run(["snapshot", "create", "--name", "before"]);

        // "after": component:api-gateway added, with no decision linking to it.
        writeFileSync(
          join(dir, ".rvs/cache/architecture-intelligence.json"),
          JSON.stringify({ components: [{ id: "component:api-gateway", kind: "service", label: "API Gateway" }] }),
        );
        run(["snapshot", "create", "--name", "after"]);

        run(["decisions", "analyze"]);
      }

      // Both workflows funnel into one `governance check --ci` call per
      // engine -- assert the --ci exit-code gate itself is equivalent first
      // (the most direct proof of "workflow -> governance check exit code"
      // surviving packaging unchanged).
      const checks = engines.map(({ label, capture }) => ({ label, result: capture(["governance", "check", "--from", "before", "--to", "after", "--ci"]) }));
      for (const { label, result } of checks) {
        expect(result.status, `${label} engine's governance check --ci should exit 1`).toBe(1);
      }

      // decision-governance-context.json's arrays are built from plain,
      // content-derived entity/decision ids (component:api-gateway from the
      // architecture fixture; decision:ADR-0001 from frontmatter `id`, via
      // ids.ts's buildDecisionId) -- neither is digest- or
      // repository-basename-derived (unlike decision-snapshot.json's own
      // `id`/`repository_id`, see the giant test above), so this file is
      // expected to be genuinely byte-identical between engines with no
      // scrubbing needed.
      const sourceContext = JSON.parse(readFileSync(join(wfSourceDir, ".rvs/cache/decisions/decision-governance-context.json"), "utf8"));
      const packagedContext = JSON.parse(readFileSync(join(wfPackagedDir, ".rvs/cache/decisions/decision-governance-context.json"), "utf8"));
      expect(sourceContext).toEqual(packagedContext);
      expect(sourceContext.changes_missing_decision).toEqual(["component:api-gateway"]);
      expect(sourceContext.decisions_with_contradicted_assumptions).toEqual(["decision:ADR-0001"]);

      // governance-findings.json findings carry a digest-derived `id` (see
      // ids.ts's buildFindingId) plus `evidence_refs`/`blast_radius`, neither
      // of which this equivalence check needs -- compare the fields that
      // actually express each workflow's verdict (which rule, what result,
      // at what severity, referencing which entity/decision, in what
      // words), sorted by rule_id for a stable comparison order.
      type FindingSlice = { rule_id: string; result: string; severity: string; statement: string; affected_entity_ids: string[]; human_review_required: boolean; excepted: boolean };
      const findingSlice = (dir: string): FindingSlice[] => {
        const raw = JSON.parse(readFileSync(join(dir, ".rvs/cache/governance/governance-findings.json"), "utf8")) as FindingSlice[];
        return [...raw]
          .map(({ rule_id, result, severity, statement, affected_entity_ids, human_review_required, excepted }) => ({ rule_id, result, severity, statement, affected_entity_ids, human_review_required, excepted }))
          .sort((a, b) => (a.rule_id === b.rule_id ? a.statement.localeCompare(b.statement) : a.rule_id.localeCompare(b.rule_id)));
      };
      const sourceFindings = findingSlice(wfSourceDir);
      const packagedFindings = findingSlice(wfPackagedDir);
      expect(sourceFindings).toEqual(packagedFindings);

      // rule_id is `governance:rule:<policyId>:<rule's own yaml "id">`
      // (ids.ts's buildRuleId), never the bare yaml "id" by itself -- match
      // on the suffix, which sanitize() leaves untouched since these rule
      // ids only use already-safe characters.
      const blockingFailures = sourceFindings.filter((f) => f.severity === "blocking" && f.result === "fail" && !f.excepted);
      expect(blockingFailures.some((f) => f.rule_id.endsWith(":require-decision-for-change") && f.statement.includes("component:api-gateway"))).toBe(true);
      expect(blockingFailures.some((f) => f.rule_id.endsWith(":forbid-contradicted-assumption") && f.statement.includes("decision:ADR-0001"))).toBe(true);
    } finally {
      rmSync(wfSourceDir, { recursive: true, force: true });
      rmSync(wfPackagedDir, { recursive: true, force: true });
    }
  }, 120_000);


  // ===================================================================
  // Milestone 10.5 §63 -- installed-tarball visual equivalence.
  //
  // Everything above proves the packaged CLI and the source CLI agree on
  // cache, workflow and deck output. This block proves the same thing for
  // the Milestone 10 visual stack, which is where packaging can go wrong in
  // ways CLI registration never notices: a design asset that did not make it
  // into the tarball falls back to a different palette, a browser runtime
  // authored as text gets mangled by the bundler, an internal visual package
  // left as a runtime `workspace:*` dependency installs as a broken link.
  //
  // The claim under test is narrow and total: an artifact generated from the
  // installed npm tarball carries the same semantic intent, grammar, design
  // tokens, architecture entities, fidelity accounting, accessibility
  // metadata, motion plan, interaction behaviour, geometry and rendered
  // structure as the same artifact generated from the source workspace --
  // without the monorepo and without the network.
  //
  // Four scenarios, one canonical fixture each, run through both CLIs:
  //   1. the interactive architecture explorer   (`rvs graph open`)
  //   2. before/delta/after change review        (`rvs graph review`)
  //   3. the dependency-graph grammar            (`rvs graph open`, a
  //      capability/decision-only fixture in which no structural node kind
  //      and no boundary exists, so grammar selection reaches
  //      `dependency_graph` rather than `architecture`)
  //   4. root-cause grouping                     (`rvs graph roots`)
  //
  // Scenario 4 is deliberately not a rendered fishbone. `fishbone` is only
  // compatible with the `causality` and `root_cause` intents, and the only
  // intents any command produces today are `architecture` (explorer) and
  // `change` (review) -- so no CLI surface renders that grammar, and adding
  // one would be new product scope. What is proven instead is the layer that
  // does exist: identical root-cause groups (cause grouping, classification,
  // candidate roots, evidence refs) from both CLIs, plus evidence that the
  // fishbone rule and layout survived bundling into dist/bin.cjs. The gap is
  // recorded here rather than papered over.
  //
  // §38 -- volatile normalization. The two interactive artifacts embed no
  // timestamp, no absolute path and no run-specific value of any kind, so
  // every HTML and SVG comparison below is byte-for-byte with nothing
  // stripped and nothing sorted. Five things are normalized anywhere in this
  // block, none of them belonging to a visual artifact, and each is named
  // where it is applied:
  //     ValidationReport.generated_at  -- wall clock
  //     ValidationReport.source_file   -- the run's own temporary path
  //     the run root inside an expected-error message, which quotes the path
  //       it looked in, and which the two engines deliberately differ on
  //     `rvs doctor`'s own path lines and its Playwright version, since the
  //       isolated install resolves the `^1.48.0` range for itself; the
  //       paths are asserted directly instead, which is the actual claim
  //     `npm warn`/`npm notice` lines on the packaged side, which `npx`
  //       prints about the ambient npm configuration before `rvs` starts
  // Nothing else is normalized: not ids, not data attributes, not ARIA, not
  // token values, not geometry, not motion metadata, not stdout, not counts.
  describe("installed-tarball visual equivalence", () => {
    // One install, outside the monorepo, under a path containing spaces
    // (§4/§29). realpathSync for the same reason package-smoke.test.ts uses
    // it: on macOS mkdtempSync returns /var/..., which is a symlink to
    // /private/var, and the CLI reports the resolved path.
    let visualRoot: string;
    let installedCliRoot: string;
    let installedBinJs: string;
    // NODE_OPTIONS has no quoting story we can rely on across shells, so the
    // offline preload lives on a space-free path of its own.
    let guardDir: string;
    let offlineGuard: string;

    const SNAPSHOT_FILES = ["graph-snapshot.json", "nodes.json", "edges.json"] as const;

    type RunResult = { status: number; stdout: string; stderr: string };
    interface Engine {
      label: "source" | "packaged";
      run: (args: string[], cwd: string, env?: NodeJS.ProcessEnv) => string;
      capture: (args: string[], cwd: string, env?: NodeJS.ProcessEnv) => RunResult;
    }

    // The source engine runs the workspace TypeScript. The packaged engine
    // runs `npx rvs` from inside the external install root, which resolves
    // through node_modules/.bin/rvs into the installed tarball -- never the
    // checkout, never a workspace bin fallback.
    const sourceEngine: Engine = {
      label: "source",
      run: (args, cwd, env) => execFileSync(tsxBin, [cliEntry, ...args], { cwd, encoding: "utf8", env: env ?? process.env }),
      capture: (args, cwd, env) => captureRun(tsxBin, [cliEntry, ...args], cwd, env),
    };
    const packagedEngine: Engine = {
      label: "packaged",
      run: (args, cwd, env) => execFileSync("npx", ["rvs", ...args], { cwd, encoding: "utf8", env: env ?? process.env }),
      capture: (args, cwd, env) => captureRun("npx", ["rvs", ...args], cwd, env),
    };

    function captureRun(bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): RunResult {
      try {
        const stdout = execFileSync(bin, args, { cwd, encoding: "utf8", env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
        return { status: 0, stdout, stderr: "" };
      } catch (err) {
        const e = err as { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
        return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
      }
    }

    // ---------------------------------------------------------------
    // §8 -- one canonical fixture per scenario, written identically into
    // every run root. `reversed` reverses every input array (components,
    // flows, capabilities, findings, decisions, links) for §37's
    // shuffled-input parity; it is a deterministic reversal rather than a
    // random shuffle so a failure is reproducible.
    // ---------------------------------------------------------------
    const evidence = (path: string, lines: string, source_artifact: string) => ({ path, lines, source_artifact });
    const ordered = <T>(list: readonly T[], reversed: boolean): T[] => (reversed ? [...list].reverse() : [...list]);

    function writeCache(root: string, rel: string, value: unknown): void {
      const path = join(root, ".rvs/cache", rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(value, null, 2));
    }

    /**
     * The rich fixture behind scenarios 1, 2 and 4.
     *
     * It is shaped to exercise the parts of the visual stack that packaging
     * could break silently: a focal component with both upstream and
     * downstream reach, a dangling relation that becomes an
     * `unresolved_reference` node, governance findings at three severities
     * (so severity overlays and the governance lens carry something),
     * decisions in the real `{ "decisions": [...] }` cache shape -- one of
     * them `draft`, a status with no visual equivalent, which is the path
     * that must degrade to "unknown" rather than be mapped onto a
     * neighbouring status -- decision links, and an assumption.
     *
     * `after: true` adds one component and one flow. That single addition is
     * scenario 2's change: an add-only delta keeps both snapshots mutually
     * comparable, where a removal makes the review report an after-entity it
     * cannot find.
     */
    function writeRichFixture(root: string, opts: { reversed?: boolean; after?: boolean } = {}): void {
      const reversed = opts.reversed === true;
      const components = [
        { id: "component:checkout-api", label: { displayLabel: "Checkout API" }, evidence: [{ path: "src/checkout-api.ts", lines: "1-40" }], implementation: { entryPoints: ["src/checkout-api.ts"] } },
        { id: "component:orders-service", label: { displayLabel: "Orders Service" }, evidence: [{ path: "src/orders-service.ts", lines: "1-60" }] },
        { id: "component:billing-service", label: { displayLabel: "Billing Service" }, evidence: [{ path: "src/billing-service.ts", lines: "1-55" }] },
        { id: "component:ledger-store", label: { displayLabel: "Ledger Store" }, evidence: [{ path: "src/ledger-store.ts", lines: "1-30" }] },
        { id: "component:notification-worker", label: { displayLabel: "Notification Worker" }, evidence: [{ path: "src/notification-worker.ts", lines: "1-25" }] },
      ] as Array<Record<string, unknown>>;
      const flows = [
        { id: "flow:api-orders", label: "Checkout API invokes Orders Service", fromId: "component:checkout-api", toId: "component:orders-service", evidence: [{ path: "src/checkout-api.ts", lines: "12-18" }] },
        { id: "flow:orders-billing", label: "Orders Service invokes Billing Service", fromId: "component:orders-service", toId: "component:billing-service", evidence: [{ path: "src/orders-service.ts", lines: "20-28" }] },
        { id: "flow:billing-ledger", label: "Billing Service invokes Ledger Store", fromId: "component:billing-service", toId: "component:ledger-store", evidence: [{ path: "src/billing-service.ts", lines: "31-39" }] },
        { id: "flow:orders-notify", label: "Orders Service invokes Notification Worker", fromId: "component:orders-service", toId: "component:notification-worker", evidence: [{ path: "src/orders-service.ts", lines: "44-49" }] },
        // Deliberately dangling: component:legacy-mailer exists nowhere, so
        // the graph builder promotes it to an unresolved_reference node and
        // downgrades this edge's resolution_status. §21's "at least one
        // unresolved relation", and the stand-in path in the explorer.
        { id: "flow:notify-legacy", label: "Notification Worker invokes an unresolved legacy mailer", fromId: "component:notification-worker", toId: "component:legacy-mailer", evidence: [{ path: "src/notification-worker.ts", lines: "18-22" }] },
      ] as Array<Record<string, unknown>>;
      if (opts.after === true) {
        components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" }, evidence: [{ path: "src/reporting-service.ts", lines: "1-30" }] });
        flows.push({ id: "flow:orders-reporting", label: "Orders Service invokes Reporting Service", fromId: "component:orders-service", toId: "component:reporting-service", evidence: [{ path: "src/orders-service.ts", lines: "52-58" }] });
      }

      writeCache(root, "architecture-intelligence.json", {
        // An explicit identity id, so the repository id is a fact of the
        // fixture rather than of the directory it happens to sit in. Without
        // it graph-build falls back to basename(repoRoot) and the two run
        // roots -- which must have different names -- would produce
        // different entity ids for reasons that are not the CLI's.
        identity: {
          id: "rvs-visual-equivalence-fixture",
          name: { displayLabel: "Equivalence Fixture", sourceLabel: "rvs-visual-equivalence-fixture" },
          evidence: [{ path: "README.md", lines: "1-4" }],
        },
        components: ordered(components, reversed),
        workflowFamilies: [{ id: "workflow:checkout", label: { displayLabel: "Checkout" } }],
        flows: ordered(flows, reversed),
      });

      const capabilities = [
        { id: "capability:accept-payment", displayName: "Accept payment", domainId: "domain:commerce", logicalComponents: ["component:billing-service", "component:ledger-store"], workflows: ["workflow:checkout"], evidence: [{ id: "cap-ev-1", sourcePath: "docs/architecture.md", description: "Payment capability" }] },
        { id: "capability:place-order", displayName: "Place order", domainId: "domain:commerce", logicalComponents: ["component:checkout-api", "component:orders-service"], workflows: ["workflow:checkout"], evidence: [{ id: "cap-ev-2", sourcePath: "docs/architecture.md", description: "Ordering capability" }] },
      ];
      writeCache(root, "capability-model.json", {
        domains: [{ id: "domain:commerce", displayName: "Commerce" }],
        includedCapabilities: ordered(capabilities, reversed),
        qualifiedCapabilities: [], roadmapCapabilities: [], gapCapabilities: [], unresolvedCapabilities: [],
      });

      const findings = [
        { id: "gf-ledger-blocking", policy_id: "policy:data-retention", rule_id: "rule:retention-documented", result: "violation", severity: "blocking", statement: "Ledger Store persists financial records with no documented retention rule.", affected_entity_ids: ["component:ledger-store"], human_review_required: true, excepted: false, evidence_refs: [evidence("src/ledger-store.ts", "1-30", "architecture")] },
        { id: "gf-notify-review", policy_id: "policy:external-egress", rule_id: "rule:egress-declared", result: "violation", severity: "review_required", statement: "Notification Worker reaches an unresolved external mailer.", affected_entity_ids: ["component:notification-worker"], human_review_required: true, excepted: false, evidence_refs: [evidence("src/notification-worker.ts", "18-22", "architecture")] },
        { id: "gf-checkout-advisory", policy_id: "policy:api-contract", rule_id: "rule:contract-published", result: "violation", severity: "advisory", statement: "Checkout API publishes no contract document.", affected_entity_ids: ["component:checkout-api"], human_review_required: false, excepted: false, evidence_refs: [evidence("src/checkout-api.ts", "1-40", "architecture")] },
      ];
      writeCache(root, "governance/governance-findings.json", ordered(findings, reversed));
      writeCache(root, "governance/governance-report.json", {
        schema_version: 1,
        id: "governance-report:fixture",
        source_snapshot_id: "snapshot:fixture-base",
        target_snapshot_id: "snapshot:fixture-head",
        repository_id: "rvs-visual-equivalence-fixture",
        findings: ordered(findings, reversed),
      });

      // §18 -- the real decision cache shape. `decisions.json` is an object
      // with a `decisions` array in it, and `rvs graph open` alone once read
      // it as a bare array and threw "decisions.map is not a function" in
      // every repository that had actually run decision intelligence. Both
      // CLIs must read this file, so the regression cannot come back through
      // packaging either.
      const decisions = [
        { schema_version: 1, id: "decision:0001-single-ledger", source: { path: "docs/decisions/0001-single-ledger.md", format: "adr" }, title: "Keep one ledger store", decision_status: "accepted", implementation_status: "implemented", scope: "component", authors: ["fixture"], supersedes: [], superseded_by: [], evidence_refs: [evidence("docs/decisions/0001-single-ledger.md", "1-20", "decision")] },
        { schema_version: 1, id: "decision:0002-async-notifications", source: { path: "docs/decisions/0002-async-notifications.md", format: "adr" }, title: "Send notifications asynchronously", decision_status: "draft", implementation_status: "partial", scope: "component", authors: ["fixture"], supersedes: [], superseded_by: [], evidence_refs: [evidence("docs/decisions/0002-async-notifications.md", "1-14", "decision")] },
      ];
      writeCache(root, "decisions/decisions.json", { decisions: ordered(decisions, reversed) });
      writeCache(root, "decisions/decision-snapshot.json", { schema_version: 1, id: "decision-snapshot:fixture", repository_id: "rvs-visual-equivalence-fixture" });
      writeCache(root, "decisions/decision-links.json", ordered([
        { id: "dl-1", decision_id: "decision:0001-single-ledger", target_id: "component:ledger-store", link_type: "implements", resolution: "resolved", detail: "The ledger decision names this component.", evidence_refs: [evidence("docs/decisions/0001-single-ledger.md", "8-12", "decision")] },
        { id: "dl-2", decision_id: "decision:0002-async-notifications", target_id: "component:notification-worker", link_type: "implements", resolution: "resolved", detail: "The notification decision names this component.", evidence_refs: [evidence("docs/decisions/0002-async-notifications.md", "6-9", "decision")] },
      ], reversed));
      writeCache(root, "decisions/assumptions.json", [
        { id: "assume-1", decision_id: "decision:0001-single-ledger", statement: "One ledger is enough for the volume we handle.", state: "supported", evidence_refs: [evidence("docs/decisions/0001-single-ledger.md", "14-18", "decision")] },
      ]);
    }

    /**
     * Scenario 3's fixture: directed relations, a focal entity, unresolved
     * relations, and -- crucially -- no architecture artifact at all.
     *
     * Grammar selection reaches `dependency_graph` (weight 60, "directed
     * relationships") only when the 65-weight component-topology rule stays
     * off, which requires that no drawn node kind is structural
     * (component/package/repository/runtime_entrypoint/product) and no
     * boundary exists. Capabilities whose logicalComponents name components
     * that were never declared give exactly that: capability and decision
     * nodes, unresolved_reference stand-ins, and directed edges between
     * them.
     */
    function writeDependencyFixture(root: string, opts: { reversed?: boolean } = {}): void {
      const reversed = opts.reversed === true;
      const capabilities = [
        { id: "capability:accept-payment", displayName: "Accept payment", logicalComponents: ["component:billing-service"], workflows: [], evidence: [] },
        { id: "capability:place-order", displayName: "Place order", logicalComponents: ["component:orders-service"], workflows: [], evidence: [] },
        { id: "capability:notify-customer", displayName: "Notify customer", logicalComponents: ["component:notification-worker"], workflows: [], evidence: [] },
      ];
      writeCache(root, "capability-model.json", {
        domains: [],
        includedCapabilities: ordered(capabilities, reversed),
        qualifiedCapabilities: [], roadmapCapabilities: [], gapCapabilities: [], unresolvedCapabilities: [],
      });
      writeCache(root, "decisions/decision-snapshot.json", { schema_version: 1, id: "decision-snapshot:dep", repository_id: "rvs-dependency-grammar-fixture" });
      writeCache(root, "decisions/decisions.json", {
        decisions: ordered([
          { schema_version: 1, id: "decision:0001", source: { path: "docs/decisions/0001.md", format: "adr" }, title: "One ledger", decision_status: "accepted", implementation_status: "implemented", scope: "capability", authors: ["fixture"], supersedes: [], superseded_by: [], evidence_refs: [evidence("docs/decisions/0001.md", "1-10", "decision")] },
          { schema_version: 1, id: "decision:0002", source: { path: "docs/decisions/0002.md", format: "adr" }, title: "Async notify", decision_status: "proposed", implementation_status: "partial", scope: "capability", authors: ["fixture"], supersedes: ["decision:0001"], superseded_by: [], evidence_refs: [evidence("docs/decisions/0002.md", "1-8", "decision")] },
        ], reversed),
      });
      writeCache(root, "decisions/decision-links.json", ordered([
        { id: "dl-1", decision_id: "decision:0001", target_id: "capability:accept-payment", link_type: "implements", resolution: "resolved", detail: "names it", evidence_refs: [evidence("docs/decisions/0001.md", "4-6", "decision")] },
        { id: "dl-2", decision_id: "decision:0002", target_id: "capability:notify-customer", link_type: "implements", resolution: "resolved", detail: "names it", evidence_refs: [evidence("docs/decisions/0002.md", "3-5", "decision")] },
        { id: "dl-3", decision_id: "decision:0002", target_id: "capability:place-order", link_type: "constrains", resolution: "resolved", detail: "names it", evidence_refs: [evidence("docs/decisions/0002.md", "6-7", "decision")] },
        { id: "dl-4", decision_id: "decision:0001", target_id: "capability:place-order", link_type: "constrains", resolution: "resolved", detail: "names it", evidence_refs: [evidence("docs/decisions/0001.md", "8-9", "decision")] },
      ], reversed));
    }

    // ---------------------------------------------------------------
    // The pipelines. Identical command sequences, identical arguments,
    // identical fixture content -- the only variable is which CLI runs them.
    // ---------------------------------------------------------------

    /** Scenarios 1, 2 and 4, in one root. Returns the command transcript. */
    function runRichPipeline(engine: Engine, dir: string, opts: { reversed?: boolean } = {}): string[] {
      const reversed = opts.reversed === true;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "rvs-visual-equivalence-fixture", version: "1.0.0" }, null, 2));
      writeFileSync(join(dir, "README.md"), "# Equivalence Fixture\n\nA fixture repository for installed-tarball visual equivalence.\n");

      const transcript: string[] = [];
      const step = (args: string[]) => { transcript.push(`$ rvs ${args.join(" ")}\n${engine.run(args, dir)}`); };

      step(["init"]);
      writeRichFixture(dir, { reversed });
      step(["graph", "build"]);
      archiveSnapshot(dir, "snapshot before");
      writeRichFixture(dir, { reversed, after: true });
      step(["graph", "build"]);
      archiveSnapshot(dir, "snapshot after");
      // --direction both gives the change review capability effects,
      // decision impacts, governance findings and causal routes in one go;
      // the second call adds routes out of the focal component the explorer
      // opens on.
      step(["graph", "impact", "component:ledger-store", "--direction", "both"]);
      step(["graph", "impact", "component:orders-service"]);
      step(["graph", "roots"]);
      step(["graph", "open", "--focus", "component:orders-service"]);
      step(["graph", "open", "--output", ".rvs/out/explorer-executive.html", "--audience", "executive", "--detail", "simplified"]);
      step(["graph", "review", "--from", "snapshot before", "--to", "snapshot after"]);
      step(["graph", "review", "--from", "snapshot before", "--to", "snapshot after", "--motion", "none", "--output", "artifacts/visuals/change-review-static.html"]);
      step(["graph", "review", "--from", "snapshot before", "--to", "snapshot after", "--lens", "governance", "--output", "artifacts/visuals/change-review-governance.html"]);
      return transcript;
    }

    /** Scenario 3, in a root of its own. */
    function runDependencyPipeline(engine: Engine, dir: string, opts: { reversed?: boolean } = {}): string[] {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "rvs-dependency-grammar-fixture", version: "1.0.0" }, null, 2));
      const transcript: string[] = [];
      const step = (args: string[]) => { transcript.push(`$ rvs ${args.join(" ")}\n${engine.run(args, dir)}`); };
      step(["init"]);
      writeDependencyFixture(dir, { reversed: opts.reversed === true });
      step(["graph", "build"]);
      step(["graph", "open", "--focus", "capability:place-order"]);
      return transcript;
    }

    function archiveSnapshot(dir: string, name: string): void {
      const target = join(dir, name);
      mkdirSync(target, { recursive: true });
      for (const file of SNAPSHOT_FILES) {
        cpSync(join(dir, ".rvs/cache/knowledge-graph", file), join(target, file));
      }
    }

    // Artifact locations, relative to a run root.
    const EXPLORER = ".rvs/out/architecture-explorer.html";
    const EXPLORER_EXECUTIVE = ".rvs/out/explorer-executive.html";
    const REVIEW = "artifacts/visuals/change-review.html";
    const REVIEW_STATIC = "artifacts/visuals/change-review-static.html";
    const REVIEW_GOVERNANCE = "artifacts/visuals/change-review-governance.html";
    const VISUAL_ARTIFACTS = [EXPLORER, EXPLORER_EXECUTIVE, REVIEW, REVIEW_STATIC, REVIEW_GOVERNANCE] as const;

    const readArtifact = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8");

    // ---------------------------------------------------------------
    // §39 -- targeted diagnostics.
    //
    // "Expected objects to be equal" over a 5,000-line artifact says
    // nothing. These produce a list of the specific paths that disagree, in
    // the form the spec asks for, and the assertion is that the list is
    // empty -- so a failure prints the differences rather than the
    // documents. Not a general diff framework: two functions, one for
    // structured data and one for text, capped so a wholesale divergence
    // does not bury the first real difference.
    // ---------------------------------------------------------------
    const DIFF_LIMIT = 25;

    function brief(value: unknown): string {
      if (value === undefined) return "(absent)";
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (text === undefined) return "(absent)";
      return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    }

    function structuralDiff(source: unknown, packaged: unknown, prefix: string, out: string[] = []): string[] {
      if (out.length >= DIFF_LIMIT) return out;
      const bothArrays = Array.isArray(source) && Array.isArray(packaged);
      const bothObjects = !bothArrays
        && typeof source === "object" && source !== null
        && typeof packaged === "object" && packaged !== null;
      if (bothArrays) {
        const a = source as unknown[];
        const b = packaged as unknown[];
        if (a.length !== b.length) out.push(`${prefix}.length / source: ${a.length} / package: ${b.length}`);
        for (let i = 0; i < Math.max(a.length, b.length) && out.length < DIFF_LIMIT; i++) {
          structuralDiff(a[i], b[i], `${prefix}[${i}]`, out);
        }
        return out;
      }
      if (bothObjects) {
        const keys = [...new Set([...Object.keys(source as object), ...Object.keys(packaged as object)])].sort();
        for (const key of keys) {
          if (out.length >= DIFF_LIMIT) break;
          structuralDiff(
            (source as Record<string, unknown>)[key],
            (packaged as Record<string, unknown>)[key],
            prefix === "" ? key : `${prefix}.${key}`,
            out,
          );
        }
        return out;
      }
      if (JSON.stringify(source) !== JSON.stringify(packaged)) {
        out.push(`${prefix} / source: ${brief(source)} / package: ${brief(packaged)}`);
      }
      return out;
    }

    function textDiff(label: string, source: string, packaged: string): string[] {
      if (source === packaged) return [];
      const a = source.split("\n");
      const b = packaged.split("\n");
      const out: string[] = [];
      if (a.length !== b.length) out.push(`${label}.lines / source: ${a.length} / package: ${b.length}`);
      for (let i = 0; i < Math.max(a.length, b.length) && out.length < DIFF_LIMIT; i++) {
        if (a[i] !== b[i]) out.push(`${label}:${i + 1} / source: ${brief(a[i])} / package: ${brief(b[i])}`);
      }
      return out;
    }

    // ---------------------------------------------------------------
    // Extractors. Each pulls one comparison layer out of a rendered
    // artifact; none of them normalizes anything.
    // ---------------------------------------------------------------

    /** §11 -- the deterministic primitive/state model the page actually runs on. */
    function jsonIsland(html: string, id: string): unknown {
      const match = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
      if (!match) throw new Error(`No JSON island #${id} in the artifact`);
      return JSON.parse(match[1]) as unknown;
    }

    /** §9 -- the VisualCommunicationSpec fields the document carries on its root svg. */
    function specAttributes(html: string): Record<string, string> {
      const svg = html.match(/<svg\b[^>]*>/);
      if (!svg) throw new Error("No <svg> element in the artifact");
      const attrs: Record<string, string> = {};
      for (const [, name, value] of svg[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[name] = value;
      return attrs;
    }

    /** §24 -- the whole SVG, geometry included. Never normalized. */
    function svgOf(html: string): string {
      const match = html.match(/<svg\b[\s\S]*<\/svg>/);
      if (!match) throw new Error("No <svg> element in the artifact");
      return match[0];
    }

    /** §12 -- the rendered fidelity receipt: counts, reason codes, hidden ids. */
    function fidelitySection(html: string): string {
      const match = html.match(/<section class="rvs-fidelity"[\s\S]*?<\/section>/);
      if (!match) throw new Error("No fidelity section in the artifact");
      return match[0];
    }

    /** §10 -- every semantic design token declaration, in document order. */
    function designTokens(html: string): string[] {
      return [...html.matchAll(/--rvs-[a-z0-9-]+:[^;]*;/g)].map((m) => m[0].trim());
    }

    /** §13 -- accessibility metadata, in document order, nothing normalized away. */
    function accessibilityMetadata(html: string): string[] {
      const out: string[] = [];
      for (const [, tag] of html.matchAll(/<([a-zA-Z][^>]*)>/g)) {
        const attrs = [...tag.matchAll(/((?:aria-[a-z-]+|role|tabindex|alt|title|lang|scope|for|hidden|aria-live))(?:="([^"]*)")?/g)]
          .map(([, name, value]) => (value === undefined ? name : `${name}="${value}"`));
        if (attrs.length > 0) out.push(`${tag.split(/\s/)[0]} ${attrs.join(" ")}`);
      }
      for (const [, text] of html.matchAll(/<title>([\s\S]*?)<\/title>/g)) out.push(`title: ${text}`);
      for (const [, text] of html.matchAll(/<desc>([\s\S]*?)<\/desc>/g)) out.push(`desc: ${text}`);
      return out;
    }

    /** §15 -- the browser motion runtime, as shipped in the page. */
    function motionRuntime(html: string): string {
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      const carrying = scripts.filter((s) => s.includes("rvsBuildMotionPlan") || s.includes("rvsMotionPlay"));
      if (carrying.length === 0) throw new Error("No motion runtime in the artifact");
      return carrying.join("\n/* --- */\n");
    }

    /** §25 -- duplicate DOM ids, outside script/style content. */
    function duplicateElementIds(html: string): string[] {
      const markup = html
        .replace(/<script[\s\S]*?<\/script>/g, "<script></script>")
        .replace(/<style[\s\S]*?<\/style>/g, "<style></style>");
      const seen = new Map<string, number>();
      for (const [, id] of markup.matchAll(/\sid="([^"]*)"/g)) seen.set(id, (seen.get(id) ?? 0) + 1);
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id} × ${count}`).sort();
    }

    /** §44 -- the artifact's Content-Security-Policy, verbatim. */
    function csp(html: string): string {
      const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
      if (!match) throw new Error("No Content-Security-Policy meta in the artifact");
      return match[1];
    }

    // Two of the five §38 normalizations, and neither is applied to a
    // visual artifact: @rvs/validator stamps its report with the wall clock and the path it
    // read. Both are run-specific by construction; every rule result,
    // finding, scene and summary field below them is compared untouched.
    function stripValidationVolatile(report: ValidationReport): unknown {
      const { generated_at: _generatedAt, source_file: _sourceFile, ...rest } =
        report as unknown as { generated_at: string; source_file: string } & Record<string, unknown>;
      return rest;
    }

    // §38 -- the two normalizations applied to what a CLI *said*, rather
    // than to what it drew. An error that names a missing file quotes the
    // path it looked in, and the two engines are deliberately run in
    // differently-named directories so that §36's claim is exercised; each
    // engine's own run root is replaced with the same placeholder and
    // nothing else is touched.
    const withoutRunRoot = (text: string, root: string) => text.split(root).join("<run-root>");

    // `npx` prints its own warnings about the ambient npm configuration
    // ("Unknown env config ...") before it hands control to anything, and
    // under `pnpm test` the ambient configuration is pnpm's, so they appear.
    // They are the package manager's stderr, not the CLI's: they arrive
    // before `rvs` has run and say nothing about it. Only lines npm stamped
    // with its own name are dropped, and only from the packaged side, which
    // is the only side reached through `npx`.
    const withoutNpmChatter = (text: string) =>
      text
        .split("\n")
        .filter((line) => !/^npm (warn|notice)\b/.test(line))
        .join("\n");

    /**
     * The Milestone 10 visual packages that esbuild inlines into
     * dist/bin.cjs. None of them is published, so none of them may appear as
     * a runtime dependency of the CLI: an installed consumer would be told to
     * fetch a package that does not exist on any registry. This is the exact
     * defect §6 asks to be permanently guarded against.
     */
    const BUNDLED_VISUAL_PACKAGES = [
      "@rvs/visual-intelligence",
      "@rvs/visual-grammar",
      "@rvs/visual-composition",
      "@rvs/visual-explorer",
      "@rvs/visual-change-review",
      "@rvs/visual-delivery",
    ] as const;

    const DESIGN_PROFILES = ["editorial-light", "executive-dark", "technical-grid"] as const;

    // §5 -- the offline proof.
    //
    // There is no established offline convention in this suite to reuse, so
    // this establishes one, and it is deliberately stronger than proxy
    // variables alone: HTTP_PROXY/HTTPS_PROXY/ALL_PROXY pointed at a dead
    // port constrain anything that honours them, and this preload constrains
    // everything else by making the act of opening a socket throw. Node's
    // built-in fetch ignores proxy variables entirely, which is exactly the
    // hole a "we set HTTP_PROXY" proof would leave open.
    const OFFLINE_GUARD_SOURCE = [
      '"use strict";',
      'const net = require("node:net");',
      'const http = require("node:http");',
      'const https = require("node:https");',
      'const refuse = (what) => { throw new Error("RVS offline guard: " + what + " was attempted during a packaged visual run"); };',
      'net.Socket.prototype.connect = function () { refuse("net.Socket.connect"); };',
      'net.connect = () => refuse("net.connect");',
      'net.createConnection = () => refuse("net.createConnection");',
      'http.request = () => refuse("http.request");',
      'http.get = () => refuse("http.get");',
      'https.request = () => refuse("https.request");',
      'https.get = () => refuse("https.get");',
      'globalThis.fetch = () => refuse("fetch");',
      "",
    ].join("\n");

    /** §30 -- an environment with no route back to the checkout. */
    function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
      // PATH entries inside the monorepo (pnpm puts node_modules/.bin there
      // when it runs the test) would let a packaged run reach workspace
      // binaries. Remove them; keep everything else so node itself is found.
      env.PATH = (env.PATH ?? "")
        .split(":")
        .filter((entry) => entry.length > 0 && !entry.startsWith(repoRoot))
        .join(":");
      for (const key of Object.keys(env)) {
        if (key.startsWith("npm_") || key.startsWith("PNPM_") || key === "INIT_CWD" || key === "NODE_PATH") delete env[key];
      }
      return env;
    }

    // ---------------------------------------------------------------
    // Roots. Different basenames on purpose: §36's claim is that the
    // absolute path a run happens in reaches no stable id and no rendered
    // byte, and identical directory names would prove nothing.
    // ---------------------------------------------------------------
    let richSourceDir: string;
    let richPackagedDir: string;
    let depSourceDir: string;
    let depPackagedDir: string;
    let richSourceLog: string[];
    let richPackagedLog: string[];
    let depSourceLog: string[];
    let depPackagedLog: string[];

    beforeAll(() => {
      visualRoot = realpathSync(mkdtempSync(join(tmpdir(), "rvs packaged visual test ")));
      writeFileSync(
        join(visualRoot, "package.json"),
        JSON.stringify({ name: "rvs-visual-equivalence-install", version: "1.0.0", private: true }, null, 2),
      );
      // The same --no-save reasoning as the outer install: this package.json
      // exists only to give npm somewhere to put node_modules.
      execFileSync("npm", ["install", "--no-save", tarballPath], { cwd: visualRoot, stdio: "inherit" });
      installedCliRoot = join(visualRoot, "node_modules/@rvs/cli");
      installedBinJs = join(installedCliRoot, "dist/bin.cjs");

      guardDir = mkdtempSync(join(tmpdir(), "rvs-offline-guard-"));
      offlineGuard = join(guardDir, "no-network.cjs");
      writeFileSync(offlineGuard, OFFLINE_GUARD_SOURCE);

      richSourceDir = join(visualRoot, "explorer and review from source");
      richPackagedDir = join(visualRoot, "explorer and review from the installed package");
      depSourceDir = join(visualRoot, "dependency grammar from source");
      depPackagedDir = join(visualRoot, "dependency grammar from the installed package");

      richSourceLog = runRichPipeline(sourceEngine, richSourceDir);
      richPackagedLog = runRichPipeline(packagedEngine, richPackagedDir);
      depSourceLog = runDependencyPipeline(sourceEngine, depSourceDir);
      depPackagedLog = runDependencyPipeline(packagedEngine, depPackagedDir);
    }, 900_000);

    afterAll(() => {
      rmSync(visualRoot, { recursive: true, force: true });
      rmSync(guardDir, { recursive: true, force: true });
    });

    // ===============================================================
    // §6, §7, §33, §34 -- what is in the tarball, and what is not.
    // ===============================================================
    it("packs the Milestone 10 visual stack, declares no unpublished runtime dependency, and leaks nothing", () => {
      const listing = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.endsWith("/"))
        .map((line) => line.replace(/^package\//, ""))
        .sort();

      // §7 -- required assets. A missing design profile here is the exact
      // failure §32 asks to be caught with an actionable assertion rather
      // than as a silent palette change at render time.
      const required = [
        "dist/bin.cjs",
        "package.json",
        "assets/design-systems/index.json",
        "assets/design-systems/editorial-light/tokens.json",
        "assets/design-systems/executive-dark/tokens.json",
        "assets/design-systems/technical-grid/tokens.json",
        "assets/skills/repo-visual-studio/SKILL.md",
      ];
      for (const entry of required) {
        expect(listing, `${entry} is missing from the packed tarball`).toContain(entry);
      }
      expect(
        listing.some((f) => f.startsWith("assets/skills/repo-visual-studio/schemas/")),
        "no schemas were packed under assets/skills/repo-visual-studio/schemas/",
      ).toBe(true);

      // §7 -- nothing else. Each pattern is a category the spec names: test
      // sources and fixtures, coverage output, a cache, generated visual
      // artifacts, screenshots, a tarball inside the tarball.
      const forbidden: Array<[RegExp, string]> = [
        [/(^|\/)__tests__\//, "test sources"],
        [/\.test\.(ts|js|mjs|cjs)$/, "test files"],
        [/(^|\/)__fixtures__\//, "test fixtures"],
        [/(^|\/)coverage\//, "coverage output"],
        [/(^|\/)\.rvs\//, "an .rvs cache"],
        [/(^|\/)artifacts\//, "generated artifacts"],
        [/\.tgz$/, "a nested tarball"],
        [/\.(png|jpg|jpeg|webp)$/, "screenshots"],
        [/(^|\/)src\//, "unbundled source"],
        [/(^|\/)node_modules\//, "vendored node_modules"],
      ];
      for (const [pattern, what] of forbidden) {
        const hits = listing.filter((f) => pattern.test(f));
        expect(hits, `the tarball carries ${what}`).toEqual([]);
      }

      // §33 -- the packed manifest. The defect this permanently guards
      // against is a bundled internal visual package left declared as a
      // runtime dependency: every @rvs/* package is inlined into
      // dist/bin.cjs by esbuild and none of them is published, so any
      // @rvs/* entry under "dependencies" installs as an unresolvable
      // specifier on a consumer's machine. The check is on "dependencies"
      // specifically -- devDependencies are never installed by a consumer,
      // and pnpm pack rewrites their workspace:* protocol on the way out.
      const packed = JSON.parse(
        execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], { encoding: "utf8" }),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; bin?: Record<string, string>; files?: string[] };
      const runtimeDeps = packed.dependencies ?? {};
      expect(Object.keys(runtimeDeps).filter((name) => name.startsWith("@rvs/"))).toEqual([]);
      expect(Object.entries(runtimeDeps).filter(([, range]) => range.startsWith("workspace:"))).toEqual([]);
      for (const name of BUNDLED_VISUAL_PACKAGES) {
        expect(runtimeDeps[name], `${name} is bundled into dist/bin.cjs but also declared as a runtime dependency`).toBeUndefined();
      }
      // ...and the real externals stay real. Turning these into
      // devDependencies to satisfy the rule above would break the installed
      // CLI, which is the opposite of what this test is for.
      expect(runtimeDeps["playwright"]).toBeDefined();
      expect(runtimeDeps["@cdktf/hcl2json"]).toBeDefined();
      expect(packed.bin).toEqual({ rvs: "dist/bin.cjs" });

      // The same guard against the source manifest, where the defect would
      // actually be introduced.
      const cliManifest = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      expect(Object.keys(cliManifest.dependencies ?? {}).filter((name) => name.startsWith("@rvs/"))).toEqual([]);

      // §34 -- the build output itself, not the source that fed it. Each
      // marker is a string literal, so it survives bundling verbatim and
      // cannot be renamed away.
      const bundle = readFileSync(installedBinJs, "utf8");
      const bundleMarkers: Array<[string, string]> = [
        ["rvsBuildMotionPlan", "the browser motion plan builder (@rvs/visual-grammar)"],
        ["rvsMotionPlay", "the browser motion player (@rvs/visual-grammar)"],
        ["RVS_MAX_TOTAL_MOTION_MS", "the motion budget constant"],
        ["rvsTraceRoute", "the explorer's in-page traversal (@rvs/visual-explorer)"],
        ["rvsReachFrom", "the explorer's in-page reachability (@rvs/visual-explorer)"],
        ["FIDELITY_SPLIT_INTO_VIEWS", "adaptation/fidelity accounting (@rvs/visual-intelligence)"],
        ["VISUAL_GRAMMAR_ROOT_CAUSE_GROUPED_CAUSES", "the fishbone grammar-selection rule (@rvs/visual-intelligence)"],
        ["data-rvs-change", "the change-review renderer (@rvs/visual-change-review)"],
        ["visual-interactive-v2", "the verification profile table (@rvs/visual-delivery)"],
        ["VISUAL_VERIFICATION_BROWSER_UNAVAILABLE", "the delivery gate's infrastructure finding (@rvs/visual-delivery)"],
        ["prefers-reduced-motion", "the reduced-motion contract"],
      ];
      for (const [marker, what] of bundleMarkers) {
        expect(bundle.includes(marker), `dist/bin.cjs does not carry ${what}`).toBe(true);
      }
      // Nothing in the shipped bundle points back at the machine it was
      // built on.
      expect(bundle.includes(repoRoot)).toBe(false);
      expect(readFileSync(join(installedCliRoot, "dist/bin.cjs.map"), "utf8").includes(repoRoot)).toBe(false);

      // §32 -- the design profiles are not merely present, they are the same
      // bytes the checkout has, so a packed token file cannot drift into a
      // different palette.
      for (const profile of DESIGN_PROFILES) {
        const packedTokens = join(installedCliRoot, "assets/design-systems", profile, "tokens.json");
        expect(existsSync(packedTokens), `design profile "${profile}" is missing from the installed package`).toBe(true);
        expect(readFileSync(packedTokens, "utf8")).toEqual(
          readFileSync(join(repoRoot, "design-systems", profile, "tokens.json"), "utf8"),
        );
      }
    }, 120_000);

    // ===============================================================
    // §30, §31, §32 -- asset resolution from the installed package.
    // ===============================================================
    it("resolves design systems, schemas and the agent skill beneath the installed package", () => {
      const doctor = packagedEngine.run(["doctor"], richPackagedDir, isolatedEnv());
      expect(doctor).toContain("Installation type: packaged");
      expect(doctor).toContain(`Design systems found at ${join(installedCliRoot, "assets/design-systems")}`);
      expect(doctor).toContain(`Schemas found at ${join(installedCliRoot, "assets/skills/repo-visual-studio/schemas")}`);
      expect(doctor).toContain(`Agent skill found at ${join(installedCliRoot, "assets/skills/repo-visual-studio")}`);
      expect(doctor).not.toContain(repoRoot);
      expect(doctor).not.toContain("NOT found");

      // The version, schema versions and diagnostics the two CLIs report are
      // the same facts; only the paths, which are the point of the test
      // above, legitimately differ.
      const factLines = (text: string) =>
        text
          .split("\n")
          // Paths differ by design -- proving that is the point of the
          // assertions above. The Playwright version differs because the
          // isolated install resolved the `^1.48.0` range itself rather than
          // reusing the workspace lockfile's pin; that is an environment
          // fact, not a visual one, and nothing in this milestone renders
          // through it.
          .filter((line) => !/(found at|executable|Package root|Asset path|working directory|Repository root|Installation type|Playwright package)/.test(line));
      expect(textDiff("doctor", factLines(sourceEngine.run(["doctor"], richSourceDir)).join("\n"), factLines(doctor).join("\n"))).toEqual([]);
    }, 120_000);

    /**
     * The layered comparison every scenario runs.
     *
     * Each layer is extracted and compared on its own so a failure names the
     * layer that broke -- "design.tokens" rather than "two 100KB strings are
     * not equal" (§39). The byte comparison at the end is what actually
     * proves equivalence; the layers above it exist so that when it fails,
     * the reason is legible. Nothing is stripped and nothing is sorted:
     * these artifacts carry no timestamp and no absolute path, so there is
     * nothing volatile to normalise away (§38).
     */
    function compareArtifact(sourceDir: string, packagedDir: string, rel: string): void {
      const a = readArtifact(sourceDir, rel);
      const b = readArtifact(packagedDir, rel);

      // §9 -- the VisualCommunicationSpec. Its id is a digest over the spec's
      // own content, so an equal id is not a coincidence of naming: intent,
      // grammar, detail, audience, source ids, focal ids, limits and
      // selection metadata all feed it.
      expect(structuralDiff(specAttributes(a), specAttributes(b), `${rel} spec`)).toEqual([]);

      // §10 -- the semantic design tokens, value by value. A token that fell
      // back because a design asset was missing from the tarball shows up
      // here as a changed value rather than as a subtly different picture.
      expect(textDiff(`${rel} design.tokens`, designTokens(a).join("\n"), designTokens(b).join("\n"))).toEqual([]);
      expect(designTokens(a).length, `${rel} declared no design tokens at all`).toBeGreaterThan(40);

      // §11 -- the primitive and state model, at the last deterministic point
      // before serialisation: the island the page itself reads. Node ids,
      // semantic variants, edge ids and kinds, emphasis, resolution,
      // confidence, evidence references, split-view and stand-in references.
      // The explorer publishes it as #rvs-model and the change review as
      // #rvs-review; both are the same layer under different names.
      const island = a.includes('id="rvs-model"') ? "rvs-model" : "rvs-review";
      expect(structuralDiff(jsonIsland(a, island), jsonIsland(b, island), `${rel} model`)).toEqual([]);

      // §12 -- the fidelity receipt, whole. The renderer writes every
      // reason code, every count and every hidden entity id into this
      // section, so comparing it compares the accounting rather than a
      // summary of it. Two runs that drew a similar-looking picture while
      // collapsing different entities differ here.
      expect(textDiff(`${rel} fidelity`, fidelitySection(a), fidelitySection(b))).toEqual([]);

      // §13 -- accessibility metadata. Roles, names, descriptions,
      // focusability, live regions. Product behaviour, not decoration, so it
      // is compared rather than normalised away.
      expect(textDiff(`${rel} accessibility`, accessibilityMetadata(a).join("\n"), accessibilityMetadata(b).join("\n"))).toEqual([]);

      // §24 -- SVG structure and geometry. Coordinates included: a geometry
      // difference between source and package is a defect, not noise.
      expect(textDiff(`${rel} svg`, svgOf(a), svgOf(b))).toEqual([]);

      // §25 -- duplicate ids, found the same way in both.
      expect(duplicateElementIds(a)).toEqual(duplicateElementIds(b));
      expect(duplicateElementIds(a), `${rel} contains duplicate DOM ids`).toEqual([]);

      // §44 -- the policy, unchanged by packaging.
      expect(csp(a)).toEqual(csp(b));
      expect(csp(a)).toContain("default-src 'none'");

      // §15 -- the browser motion runtime, character for character.
      expect(textDiff(`${rel} motion.runtime`, motionRuntime(a), motionRuntime(b))).toEqual([]);

      // §23 -- and then the whole file. Byte identity is achievable here
      // because the renderers embed no timestamp and no absolute path, so
      // this is asserted rather than approximated.
      expect(b.length, `${rel} differs in length: source ${a.length}, packaged ${b.length}`).toEqual(a.length);
      expect(b === a, `${rel} differs byte-for-byte despite every extracted layer matching`).toBe(true);
    }

    // ===============================================================
    // Scenario 1 -- §17, §18. The interactive architecture explorer.
    // ===============================================================
    it("renders the interactive architecture explorer identically from the installed package", () => {
      compareArtifact(richSourceDir, richPackagedDir, EXPLORER);
      // The executive/simplified pass is the one that actually exercises
      // adaptation: it splits into views, releases an anchor and collapses
      // groups, so the fidelity receipt it produces is the interesting one.
      compareArtifact(richSourceDir, richPackagedDir, EXPLORER_EXECUTIVE);

      const explorer = readArtifact(richSourceDir, EXPLORER);
      const executive = readArtifact(richSourceDir, EXPLORER_EXECUTIVE);
      expect(specAttributes(explorer)["data-rvs-intent"]).toEqual("architecture");
      expect(specAttributes(explorer)["data-rvs-detail-mode"]).toEqual("balanced");
      expect(specAttributes(executive)["data-rvs-audience"]).toEqual("executive");
      // The fixture is built to force real adaptation rather than to fit; if
      // it stopped doing so the parity above would still pass while proving
      // much less, so the shape of the proof is asserted too.
      expect(fidelitySection(executive)).toContain("FIDELITY_SPLIT_INTO_VIEWS");
      expect(explorer).toContain('data-rvs-placeholder');
      expect(explorer).toContain('data-rvs-resolution="unresolved"');
      expect(explorer).toContain('data-rvs-severity="blocking"');
      expect(explorer).toContain('data-rvs-decision-status="unknown"');

      // §42 -- the commands said the same things, in the same order, with
      // the same counts, digests and receipts. Neither transcript mentions
      // the checkout or the directory it ran in.
      expect(textDiff("rich pipeline stdout", richSourceLog.join("\n\n"), richPackagedLog.join("\n\n"))).toEqual([]);
      for (const line of richPackagedLog) {
        expect(line).not.toContain(repoRoot);
        expect(line).not.toContain(richPackagedDir);
      }

      // §18 -- the decision-cache regression, proven through the real CLI on
      // both sides rather than only in the isolated unit test. The fixture
      // writes decisions.json in its true `{ "decisions": [...] }` shape;
      // before the fix `rvs graph open` read it as a bare array and threw
      // "decisions.map is not a function" in exactly those repositories that
      // had run decision intelligence.
      expect(readJson(join(richSourceDir, ".rvs/cache/decisions/decisions.json"))).toHaveProperty("decisions");
      const openStdout = richPackagedLog.find((entry) => entry.startsWith("$ rvs graph open"));
      expect(openStdout).toBeDefined();
      expect(openStdout).toContain("decision(s) carry a status with no visual equivalent");
      expect(openStdout).not.toContain("is not a function");
      expect(explorer).toContain('data-rvs-decision-status');
    }, 120_000);

    // ===============================================================
    // Scenario 2 -- §19, §20. Before / delta / after change review.
    // ===============================================================
    it("renders the before/delta/after change review identically from the installed package", () => {
      for (const rel of [REVIEW, REVIEW_STATIC, REVIEW_GOVERNANCE]) {
        compareArtifact(richSourceDir, richPackagedDir, rel);
      }

      const review = readArtifact(richSourceDir, REVIEW);
      const packagedReview = readArtifact(richPackagedDir, REVIEW);

      // §19 -- the ChangeReviewModel itself, which the page reads from its
      // own island: changes, entities, causal paths, unresolved relations,
      // lenses and glyphs.
      const sourceModel = jsonIsland(review, "rvs-review") as Record<string, unknown>;
      expect(structuralDiff(sourceModel, jsonIsland(packagedReview, "rvs-review"), "review model")).toEqual([]);
      for (const key of ["grammar", "nodes", "edges", "entities", "changes", "paths", "unresolved", "lenses", "glyphs"]) {
        expect(sourceModel, `the change-review model no longer carries ${key}`).toHaveProperty(key);
      }
      expect((sourceModel.changes as unknown[]).length).toBeGreaterThan(0);
      expect(review).toContain("data-rvs-change");
      expect(specAttributes(review)["data-rvs-intent"]).toEqual("change");

      // §20 -- truthfulness. The package must not have acquired a
      // reassurance the source never made. These are the specific
      // false-comfort phrases the change-review contract bans, and the
      // honest unknown-impact wording the source does emit must survive
      // packaging intact.
      const banned = ["No downstream impact", "Safe change", "No consumers", "Nothing else is affected"];
      for (const phrase of banned) {
        expect(packagedReview, `the packaged change review claims "${phrase}"`).not.toContain(phrase);
        expect(review).not.toContain(phrase);
      }
      // The unknown-impact statement is made twice, in two places, and both
      // have to survive packaging. The page states it in its Qualifications
      // notice; the command states it on stdout. They are different
      // sentences because they answer to different readers, and asserting
      // only one of them would let the other regress unnoticed.
      const QUALIFICATION =
        "could not be compared, so this review says nothing about them \u2014 which is not the same as saying nothing changed in them";
      expect(review, "the change review dropped its qualifications notice").toContain(QUALIFICATION);
      expect(packagedReview, "the packaged change review dropped its qualifications notice").toContain(QUALIFICATION);

      const reviewStdout = richPackagedLog.filter((entry) => entry.startsWith("$ rvs graph review"));
      expect(reviewStdout.length).toBeGreaterThan(0);
      for (const entry of reviewStdout) {
        expect(entry, "the packaged `graph review` stopped reporting uncomparable domains").toContain(
          "Not comparable, so unreported either way",
        );
        expect(entry).toContain('This is not "no change" in those domains.');
        for (const phrase of banned) expect(entry).not.toContain(phrase);
      }
      expect(textDiff("review unknown-impact wording", review, packagedReview)).toEqual([]);
    }, 120_000);

    // ===============================================================
    // Scenario 3 -- §21. The dependency-graph grammar.
    // ===============================================================
    it("selects and renders the dependency-graph grammar identically from the installed package", () => {
      compareArtifact(depSourceDir, depPackagedDir, EXPLORER);
      expect(textDiff("dependency pipeline stdout", depSourceLog.join("\n\n"), depPackagedLog.join("\n\n"))).toEqual([]);

      const html = readArtifact(depSourceDir, EXPLORER);
      const attrs = specAttributes(html);
      // The fixture declares capabilities against components no architecture
      // artifact ever declared, so the graph is directed, focal and carries
      // genuinely unresolved relations -- the conditions the dependency
      // grammar exists for.
      expect(attrs["data-rvs-grammar"]).toEqual("dependency_graph");
      expect(html).toContain('data-rvs-resolution="unresolved"');
      expect(html).toContain("data-rvs-edge-kind");
      const model = jsonIsland(html, "rvs-model") as { grammar: string; edges: Array<{ from: string; to: string }> };
      expect(model.grammar).toEqual("dependency_graph");
      expect(model.edges.length).toBeGreaterThan(0);
      // Directed: every edge names a source and a target, and the packaged
      // model names the same ones.
      for (const edge of model.edges) {
        expect(edge.from).toBeTruthy();
        expect(edge.to).toBeTruthy();
      }
    }, 120_000);

    // ===============================================================
    // Scenario 4 -- §22, §53. Root cause and grouped causes.
    // ===============================================================
    it("groups root causes identically from the installed package, and carries the fishbone grammar in the bundle", () => {
      // A limitation stated rather than papered over, per §53.
      //
      // `root_cause` intent and `fishbone` grammar are implemented and
      // selected by @rvs/visual-intelligence, but no CLI command in this
      // milestone renders through them: `rvs graph roots` is the root-cause
      // surface and it produces grouped causes as text and JSON, not a
      // fishbone drawing. Rather than add a production command purely so a
      // test could say "fishbone", this compares the layer that genuinely
      // exists on both sides -- the grouped-cause analysis and its evidence
      // -- and separately proves the grammar itself survived bundling.
      const ROOT_CAUSE_GROUPS = ".rvs/cache/knowledge-graph/root-cause-groups.json";
      const sourceRoots = readJson(join(richSourceDir, ROOT_CAUSE_GROUPS)) as Array<{
        finding_node_ids: string[];
        candidate_root_node_ids: string[];
        classification: string;
        evidence_refs: unknown[];
      }>;
      const packagedRoots = readJson(join(richPackagedDir, ROOT_CAUSE_GROUPS));
      expect(structuralDiff(sourceRoots, packagedRoots, "root-cause groups")).toEqual([]);

      // The fixture is built so this is a real grouped analysis rather than a
      // single finding with one ancestor: three governance findings across
      // three components, sharing more than one causal ancestor.
      expect(sourceRoots.length).toBeGreaterThan(0);
      expect(sourceRoots[0].finding_node_ids.length).toBeGreaterThan(1);
      expect(sourceRoots[0].candidate_root_node_ids.length).toBeGreaterThan(1);
      expect(sourceRoots[0].evidence_refs.length).toBeGreaterThan(0);

      const rootsStdout = richSourceLog.find((entry) => entry.startsWith("$ rvs graph roots"));
      const packagedRootsStdout = richPackagedLog.find((entry) => entry.startsWith("$ rvs graph roots"));
      expect(rootsStdout).toBeDefined();
      expect(textDiff("graph roots stdout", rootsStdout ?? "", packagedRootsStdout ?? "")).toEqual([]);

      // §22's checkable requirement: no causal relation, effect target,
      // cause group or evidence reference may appear in the packaged
      // analysis that the source did not produce. The structural diff above
      // is the proof; this makes the claim unambiguous.
      expect(JSON.stringify(packagedRoots)).toEqual(JSON.stringify(sourceRoots));

      // §34 -- the grammar and its selection rule are in the shipped bundle,
      // so the gap above is a CLI-surface gap and not a packaging one.
      const bundle = readFileSync(installedBinJs, "utf8");
      expect(bundle).toContain("VISUAL_GRAMMAR_ROOT_CAUSE_GROUPED_CAUSES");
      expect(bundle).toContain("fishbone");
      expect(bundle).toContain("root_cause");
    }, 120_000);

    // ===============================================================
    // §14, §15, §16 -- the motion plan, the runtime that builds it in the
    // browser, and what that runtime is allowed to contain.
    // ===============================================================

    /**
     * The pure half of the browser motion runtime, sliced out of a rendered
     * artifact.
     *
     * `MOTION_ALGORITHMS` ends where `MOTION_PLAYER` begins, and the player's
     * first declaration is `rvsMotionEscape`. Slicing there gives exactly the
     * text that touches no document, no window and no timer, which is what
     * makes it runnable in a context with nothing in it.
     */
    function motionAlgorithms(html: string): string {
      const payload = motionRuntime(html);
      const start = payload.indexOf("function rvsMotionEffect(");
      const end = payload.indexOf("function rvsMotionEscape(");
      expect(start, "the rendered artifact carries no motion algorithms").toBeGreaterThan(-1);
      expect(end, "the rendered artifact carries no motion player").toBeGreaterThan(start);
      return payload.slice(start, end);
    }

    interface MotionPlanShape {
      mode: string;
      grammar: string;
      iterations: number;
      interruptible: boolean;
      skippable: boolean;
      blocks_interaction: boolean;
      total_duration_ms: number;
      steps: Array<{ index: number; effect: string; target_ids: string[]; duration_ms: number; depends_on: number[]; announcement?: string }>;
      target_ids: string[];
      reduced_motion_fallback: { behavior: string; applied_target_ids: string[]; announcement?: string };
      unavailable_depths: number[];
    }

    /** Runs one artifact's own motion algorithms over one input. */
    function planFrom(algorithms: string, input: unknown): MotionPlanShape {
      // A context with no host objects in it at all: if the packaged runtime
      // had picked up a dependency on anything ambient, it would fail here
      // rather than behave subtly differently in a browser.
      const context = createContext(Object.create(null) as object);
      runInContext(algorithms, context);
      runInContext(`__plan = JSON.stringify(rvsBuildMotionPlan(${JSON.stringify(input)}))`, context);
      return JSON.parse((context as { __plan: string }).__plan) as MotionPlanShape;
    }

    it("builds the same motion plans in the browser from the installed package, and ships no unsafe motion code", () => {
      const sourceHtml = readArtifact(richSourceDir, EXPLORER);
      const packagedHtml = readArtifact(richPackagedDir, EXPLORER);

      // §15 -- the payload itself, character for character. Nothing is
      // minified or whitespace-folded on the way into the page, so no
      // canonicalisation is needed and none is applied: any difference here
      // is a real difference.
      expect(textDiff("MOTION_ALGORITHMS", motionAlgorithms(sourceHtml), motionAlgorithms(packagedHtml))).toEqual([]);
      expect(textDiff("motion runtime payload", motionRuntime(sourceHtml), motionRuntime(packagedHtml))).toEqual([]);
      for (const rel of VISUAL_ARTIFACTS) {
        expect(motionRuntime(readArtifact(richSourceDir, rel))).toEqual(motionRuntime(readArtifact(richPackagedDir, rel)));
      }

      // §14 -- the plans those payloads generate, for every mode the four
      // scenarios reach. Not wall-clock timing: the generated semantic plan,
      // field for field, including step order, target ids per step,
      // dependencies, duration bands and the reduced-motion fallback.
      const sourceAlgorithms = motionAlgorithms(sourceHtml);
      const packagedAlgorithms = motionAlgorithms(packagedHtml);
      const model = jsonIsland(sourceHtml, "rvs-model") as { nodes: Array<{ id: string }>; edges: Array<{ id: string }> };
      const nodeIds = model.nodes.map((n) => n.id);
      const edgeIds = model.edges.map((e) => e.id);
      expect(nodeIds.length).toBeGreaterThan(4);
      expect(edgeIds.length).toBeGreaterThan(2);

      const inputs: Array<Record<string, unknown>> = [
        { mode: "none", grammar: "architecture", sequence: nodeIds.slice(0, 3) },
        { mode: "reveal", grammar: "architecture", sequence: nodeIds.slice(0, 4) },
        { mode: "trace", grammar: "dependency_graph", sequence: edgeIds.slice(0, 3), destination_announcement: "Route traced." },
        { mode: "step", grammar: "delta", sequence: nodeIds.slice(0, 5) },
        { mode: "compare", grammar: "delta", sequence: nodeIds.slice(0, 2) },
        { mode: "impact", grammar: "dependency_graph", rings: [[nodeIds[0]], [], nodeIds.slice(1, 4)] },
        // The budget path: enough groups that the uncompressed sequence would
        // exceed MAX_TOTAL_MOTION_MS and every step has to be scaled down.
        { mode: "reveal", grammar: "architecture", sequence: nodeIds.concat(nodeIds).concat(nodeIds) },
        // And the same plan asked for under a reduced-motion preference.
        { mode: "impact", grammar: "dependency_graph", rings: [[nodeIds[0]], nodeIds.slice(1, 3)], reduced_motion: "reduce" },
      ];

      for (const input of inputs) {
        const label = `motion plan (${String(input.mode)}${input.reduced_motion ? ", reduced" : ""})`;
        const sourcePlan = planFrom(sourceAlgorithms, input);
        const packagedPlan = planFrom(packagedAlgorithms, input);
        expect(structuralDiff(sourcePlan, packagedPlan, label)).toEqual([]);

        // The invariants the plan contract makes, checked on the plan the
        // packaged runtime actually produced rather than assumed from the
        // source it was built from.
        expect(packagedPlan.iterations).toEqual(1);
        expect(packagedPlan.interruptible).toBe(true);
        expect(packagedPlan.skippable).toBe(true);
        expect(packagedPlan.blocks_interaction).toBe(false);
        expect(packagedPlan.total_duration_ms).toBeLessThanOrEqual(4000);
        expect(packagedPlan.reduced_motion_fallback.behavior).toBeTruthy();
        for (let i = 0; i < packagedPlan.steps.length; i += 1) {
          expect(packagedPlan.steps[i].index).toEqual(i);
          expect(packagedPlan.steps[i].depends_on).toEqual(i === 0 ? [] : [i - 1]);
          expect(packagedPlan.steps[i].duration_ms).toBeGreaterThan(0);
        }
        if (input.reduced_motion === "reduce") {
          // Not played faster -- not played, with the full set of targets
          // still named so the static state is complete.
          expect(packagedPlan.steps).toEqual([]);
          expect(packagedPlan.total_duration_ms).toEqual(0);
          expect(packagedPlan.reduced_motion_fallback.applied_target_ids.length).toBeGreaterThan(0);
        }
      }
      // The empty ring is reported as unavailable rather than silently
      // dropped, in both.
      expect(planFrom(packagedAlgorithms, inputs[5]).unavailable_depths).toEqual([1]);
      expect(planFrom(sourceAlgorithms, inputs[5]).unavailable_depths).toEqual([1]);

      // §16 -- what the motion runtime may not contain. Matched as whole
      // identifiers, so a safe name that merely contains one of these
      // substrings is not banned: `rvsMotionEvaluate` would pass, `eval(`
      // would not.
      const forbidden: Array<[RegExp, string]> = [
        [/\beval\s*\(/, "eval("],
        [/\bnew\s+Function\b/, "new Function"],
        [/\binnerHTML\b/, "innerHTML"],
        [/\bouterHTML\b/, "outerHTML"],
        [/\bsetInterval\b/, "setInterval"],
        [/\brequestAnimationFrame\b/, "requestAnimationFrame"],
        [/\binfinite\b/, "infinite"],
        [/\balternate\b/, "alternate"],
        [/\bfetch\s*\(/, "fetch("],
        [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
        [/\bWebSocket\b/, "WebSocket"],
        [/\bimportScripts\b/, "importScripts"],
      ];
      for (const rel of VISUAL_ARTIFACTS) {
        for (const engine of [richSourceDir, richPackagedDir]) {
          const payload = motionRuntime(readArtifact(engine, rel));
          for (const [pattern, name] of forbidden) {
            expect(pattern.test(payload), `${rel} motion runtime contains ${name}`).toBe(false);
          }
        }
      }
    }, 180_000);

    // ===============================================================
    // §5, §30, §44, §45, §46 -- offline, isolated, and safe.
    // ===============================================================
    it("produces the same artifacts with no network and no route back to the checkout", () => {
      const offlineDir = join(visualRoot, "offline run with no network at all");
      mkdirSync(offlineDir, { recursive: true });
      cpSync(join(richPackagedDir, ".rvs/cache"), join(offlineDir, ".rvs/cache"), { recursive: true });
      cpSync(join(richPackagedDir, "snapshot before"), join(offlineDir, "snapshot before"), { recursive: true });
      cpSync(join(richPackagedDir, "snapshot after"), join(offlineDir, "snapshot after"), { recursive: true });
      writeFileSync(join(offlineDir, "package.json"), readFileSync(join(richPackagedDir, "package.json")));
      writeFileSync(join(offlineDir, "README.md"), readFileSync(join(richPackagedDir, "README.md")));

      // The guard is required into the CLI process itself. `npx` is left out
      // of the picture -- it is a package-manager concern, not the CLI's --
      // by invoking the installed bin directly with the same node that runs
      // this test. The guard file lives in a directory without spaces in it
      // because NODE_OPTIONS is parsed as a shell-ish string.
      expect(offlineGuard.includes(" ")).toBe(false);
      const offlineEnv = isolatedEnv({
        NODE_OPTIONS: `--require ${offlineGuard}`,
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
        npm_config_registry: "http://127.0.0.1:9",
      });
      const offline = (args: string[]) =>
        execFileSync(process.execPath, [installedBinJs, ...args], { cwd: offlineDir, encoding: "utf8", env: offlineEnv });

      const openOut = offline(["graph", "open", "--focus", "component:orders-service"]);
      const reviewOut = offline(["graph", "review", "--from", "snapshot before", "--to", "snapshot after"]);
      expect(openOut).toContain("it needs no server and no network");

      // §5 -- and the offline run produced exactly what the online one did.
      // A command that had reached the network for a font, a schema or a
      // stylesheet would have thrown inside the guard; one that reached it
      // and silently degraded would differ here.
      for (const rel of [EXPLORER, REVIEW]) {
        expect(
          readArtifact(offlineDir, rel) === readArtifact(richPackagedDir, rel),
          `${rel} rendered differently with the network unavailable`,
        ).toBe(true);
      }

      // §30 -- nothing in the output, and nothing the run needed, points at
      // the monorepo. PATH had every checkout entry removed, so a packaged
      // run that had silently depended on a workspace binary could not have
      // completed at all.
      for (const text of [openOut, reviewOut]) {
        expect(text).not.toContain(repoRoot);
        expect(text).not.toContain("node_modules/.pnpm");
      }
      for (const rel of VISUAL_ARTIFACTS) {
        const html = readArtifact(richPackagedDir, rel);
        // §30, §58 -- no absolute local path of any kind reaches the page.
        expect(html).not.toContain(repoRoot);
        expect(html).not.toContain(visualRoot);
        expect(html).not.toContain(homedir());
        expect(html).not.toContain(tmpdir());

        // §44, §45 -- the policy is unchanged and there is nothing remote to
        // apply it to. The one http:// string an SVG legitimately carries is
        // the XML namespace, which is an identifier and never fetched.
        expect(csp(html)).toEqual("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
        const remote = [...html.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]).filter((url) => url !== "http://www.w3.org/2000/svg");
        expect(remote, `${rel} references remote resources`).toEqual([]);
        expect(html).not.toMatch(/<link\b[^>]*\brel="stylesheet"/);
        expect(html).not.toMatch(/<script\b[^>]*\bsrc=/);
        expect(html).not.toMatch(/@import\b/);
        expect(html).not.toMatch(/\burl\s*\(\s*["']?(?:https?:)?\/\//);
        // §45 -- no external visual runtime, by name.
        for (const name of ["archify", "diagram-design", "gsap", "d3.", "cytoscape", "mermaid", "anime.js", "cdn.", "unpkg", "jsdelivr", "fonts.googleapis", "fonts.gstatic"]) {
          expect(html.toLowerCase(), `${rel} references ${name}`).not.toContain(name);
        }
        // §46 -- and no unsafe browser code anywhere in the artifact,
        // including an inline event-handler attribute.
        expect(html).not.toMatch(/\beval\s*\(/);
        expect(html).not.toMatch(/\bnew\s+Function\b/);
        expect(html).not.toMatch(/\b(?:inner|outer)HTML\b/);
        expect(html).not.toMatch(/\bdocument\.write\b/);
        expect(html).not.toMatch(/\bjavascript:/i);
        expect(html).not.toMatch(/<[a-z][^>]*\son(?:click|load|error|mouseover|focus|submit|change|input|keydown)\s*=/i);
      }
    }, 300_000);

    // ===============================================================
    // §35, §36 -- five packaged runs, five fresh directories.
    // ===============================================================
    it("renders the same change review five times from five differently-named directories", () => {
      const runs: string[] = [];
      const digests: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        // Names of different lengths and shapes, one with spaces and one
        // without, so "the absolute path does not reach the output" is
        // actually exercised rather than asserted.
        const names = ["run one", "a-considerably-longer-run-directory-name-2", "run 3", "r4", "run five with several words in it"];
        const dir = join(visualRoot, names[i]);
        mkdirSync(join(dir, ".rvs"), { recursive: true });
        cpSync(join(richPackagedDir, ".rvs/cache"), join(dir, ".rvs/cache"), { recursive: true });
        writeFileSync(join(dir, "package.json"), readFileSync(join(richPackagedDir, "package.json")));
        writeFileSync(join(dir, "README.md"), readFileSync(join(richPackagedDir, "README.md")));
        // §36 -- creation order varied per run. The snapshot files are
        // written forwards for some runs and backwards for others, so a
        // renderer that had picked up filesystem enumeration order would
        // disagree with itself here.
        for (const snapshot of ["snapshot before", "snapshot after"]) {
          mkdirSync(join(dir, snapshot), { recursive: true });
          const files = i % 2 === 0 ? [...SNAPSHOT_FILES] : [...SNAPSHOT_FILES].reverse();
          for (const file of files) cpSync(join(richPackagedDir, snapshot, file), join(dir, snapshot, file));
        }
        const stdout = packagedEngine.run(["graph", "review", "--from", "snapshot before", "--to", "snapshot after"], dir);
        runs.push(readArtifact(dir, REVIEW));
        const digest = stdout.match(/digest ([0-9a-f]+)/);
        expect(digest, "the change review printed no digest").not.toBeNull();
        digests.push(digest?.[1] ?? "");
        rmSync(dir, { recursive: true, force: true });
      }

      for (let i = 1; i < runs.length; i += 1) {
        expect(textDiff(`packaged run ${i + 1} vs run 1`, runs[0], runs[i])).toEqual([]);
        expect(runs[i] === runs[0], `packaged run ${i + 1} differs byte-for-byte from run 1`).toBe(true);
        expect(digests[i]).toEqual(digests[0]);
      }
      // ...and all five agree with the artifact the source workspace made.
      expect(runs[0] === readArtifact(richSourceDir, REVIEW)).toBe(true);
    }, 300_000);

    // ===============================================================
    // §37 -- the same facts, presented in a different order.
    // ===============================================================
    it("renders identically when every input array arrives in the opposite order, from both CLIs", () => {
      const shuffledSource = join(visualRoot, "reversed inputs from source");
      const shuffledPackaged = join(visualRoot, "reversed inputs from the installed package");
      runRichPipeline(sourceEngine, shuffledSource, { reversed: true });
      runRichPipeline(packagedEngine, shuffledPackaged, { reversed: true });

      // The fixture writer reverses components, flows, capabilities,
      // governance findings, decisions, decision links and assumptions. The
      // facts are identical; only the order they were written in differs.
      for (const rel of VISUAL_ARTIFACTS) {
        const reversedSource = readArtifact(shuffledSource, rel);
        const reversedPackaged = readArtifact(shuffledPackaged, rel);
        expect(textDiff(`${rel} source order-independence`, readArtifact(richSourceDir, rel), reversedSource)).toEqual([]);
        expect(textDiff(`${rel} packaged order-independence`, readArtifact(richPackagedDir, rel), reversedPackaged)).toEqual([]);
        expect(reversedPackaged === reversedSource).toBe(true);
      }
      rmSync(shuffledSource, { recursive: true, force: true });
      rmSync(shuffledPackaged, { recursive: true, force: true });
    }, 600_000);

    // ===============================================================
    // §42, §43 -- what the two CLIs say when things go wrong.
    // ===============================================================
    it("fails the same way from the installed package, with an actionable message and no stack trace", () => {
      const emptySource = join(visualRoot, "an empty repository for source");
      const emptyPackaged = join(visualRoot, "an empty repository for the installed package");
      for (const dir of [emptySource, emptyPackaged]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "empty", version: "1.0.0" }, null, 2));
      }

      const cases: Array<{ what: string; args: string[] }> = [
        { what: "no graph cache", args: ["graph", "open"] },
        { what: "no change-review snapshots", args: ["graph", "review", "--from", "nowhere before", "--to", "nowhere after"] },
        { what: "an unknown audience", args: ["graph", "open", "--audience", "definitely-not-an-audience"] },
        { what: "an unknown detail mode", args: ["graph", "open", "--detail", "definitely-not-a-detail-mode"] },
        // The design-system id is validated after the repository model is
        // read, so in a repository that has never been inspected the error
        // reported is the missing prerequisite. What matters here is that
        // both CLIs report the same one.
        { what: "an unknown design system", args: ["create", "slides", "--design-system", "definitely-not-a-design-system"] },
      ];

      for (const testCase of cases) {
        const rawSource = sourceEngine.capture(testCase.args, emptySource);
        const rawPackaged = packagedEngine.capture(testCase.args, emptyPackaged);
        const fromSource = {
          status: rawSource.status,
          stdout: withoutRunRoot(rawSource.stdout, emptySource),
          stderr: withoutRunRoot(rawSource.stderr, emptySource),
        };
        const fromPackaged = {
          status: rawPackaged.status,
          stdout: withoutNpmChatter(withoutRunRoot(rawPackaged.stdout, emptyPackaged)),
          stderr: withoutNpmChatter(withoutRunRoot(rawPackaged.stderr, emptyPackaged)),
        };

        expect(fromSource.status, `${testCase.what}: the source CLI succeeded`).not.toEqual(0);
        expect(fromPackaged.status, `${testCase.what}: the packaged CLI succeeded`).not.toEqual(0);
        expect(fromPackaged.status, `${testCase.what}: exit codes differ`).toEqual(fromSource.status);
        expect(textDiff(`${testCase.what} stdout`, fromSource.stdout, fromPackaged.stdout)).toEqual([]);
        expect(textDiff(`${testCase.what} stderr`, fromSource.stderr, fromPackaged.stderr)).toEqual([]);

        const said = `${fromPackaged.stdout}${fromPackaged.stderr}`;
        expect(said.trim(), `${testCase.what}: the packaged CLI said nothing`).not.toEqual("");
        // Actionable, not a crash report: no frames, no internal paths.
        expect(said, `${testCase.what}: the packaged CLI printed a stack trace`).not.toMatch(/^\s+at\s+\S+/m);
        expect(said).not.toContain("node:internal");
        expect(said).not.toContain(repoRoot);
        expect(said).not.toContain("node_modules/@rvs");
      }

      rmSync(emptySource, { recursive: true, force: true });
      rmSync(emptyPackaged, { recursive: true, force: true });
    }, 240_000);

    // ===============================================================
    // §42 -- what the two CLIs produce when things go right.
    // ===============================================================
    it("writes the same files, in the same places, from the installed package", () => {
      const listing = (root: string): string[] => {
        const out: string[] = [];
        const walk = (dir: string, prefix: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
            if (entry.isDirectory()) walk(join(dir, entry.name), rel);
            else out.push(`${rel} (${readFileSync(join(dir, entry.name)).length} bytes)`);
          }
        };
        walk(root, "");
        return out;
      };
      expect(textDiff("produced files", listing(richSourceDir).join("\n"), listing(richPackagedDir).join("\n"))).toEqual([]);
      expect(textDiff("produced files (dependency)", listing(depSourceDir).join("\n"), listing(depPackagedDir).join("\n"))).toEqual([]);
    }, 120_000);

    // ===============================================================
    // §26, §27, §28, §41 -- the artifacts, in a real browser.
    //
    // Every page opened below is a file the CLI actually wrote during this
    // run. Nothing here is hand-authored markup standing in for packaged
    // output.
    // ===============================================================

    /** What the page is, as the reader would find it, at one moment. */
    interface Observation {
      status: string;
      inspector: string;
      focused: string;
      moving: string[];
      seen: string[];
      states: string[];
    }

    async function openArtifact(browser: Browser, path: string, reducedMotion?: "reduce"): Promise<Page> {
      const context = await browser.newContext(reducedMotion ? { reducedMotion } : {});
      const page = await context.newPage();
      await page.goto(`file://${path}`);
      // The same recorder the graph CLI's browser tests use: every element
      // the player marks is appended in the order it was marked, so an
      // interrupted sequence is visible as a short list rather than as an
      // absence.
      await page.evaluate(() => {
        (window as unknown as { __seen: string[] }).__seen = [];
        new MutationObserver((records) => {
          for (const record of records) {
            const element = record.target as Element;
            if (element.getAttribute("data-rvs-motion") === null) continue;
            (window as unknown as { __seen: string[] }).__seen.push(
              element.getAttribute("data-rvs-node") ?? element.getAttribute("data-rvs-edge") ?? "?",
            );
          }
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-rvs-motion"] });
      });
      return page;
    }

    const observe = (page: Page): Promise<Observation> =>
      page.evaluate(() => {
        const active = document.activeElement;
        const marked = Array.from(document.querySelectorAll("[data-rvs-motion]")).map(
          (el) => el.getAttribute("data-rvs-node") ?? el.getAttribute("data-rvs-edge") ?? "?",
        );
        const states = Array.from(document.querySelectorAll("[data-rvs-state]"))
          .map((el) => `${el.getAttribute("data-rvs-node") ?? el.getAttribute("data-rvs-edge") ?? el.getAttribute("data-rvs-change") ?? "?"}=${el.getAttribute("data-rvs-state")}`)
          .sort();
        return {
          status: document.getElementById("rvs-status")?.textContent ?? "",
          inspector: (document.getElementById("rvs-inspector")?.textContent ?? "").replace(/\s+/g, " ").trim(),
          focused: active === null ? "" : `${active.tagName.toLowerCase()}#${active.id}`,
          moving: marked.sort(),
          seen: [...(window as unknown as { __seen: string[] }).__seen],
          states,
        };
      });

    /**
     * Start a fresh recording window.
     *
     * `__seen` is cumulative over the page's whole lifetime, which is what
     * makes an interrupted sequence legible as a short list. It is the wrong
     * window when the claim under test is "this sequence touched exactly
     * these ids": every earlier interaction played its own motion, and
     * reading them together would make "exactly" unassertable. Called
     * immediately before the action whose motion is being measured, once the
     * previous sequence has finished.
     */
    const clearSeen = (page: Page): Promise<void> =>
      page.evaluate(() => {
        (window as unknown as { __seen: string[] }).__seen = [];
      });

    /** Tabs through the page and reports where focus actually landed. */
    const tabOrder = async (page: Page, steps: number): Promise<string[]> => {
      const order: string[] = [];
      for (let i = 0; i < steps; i += 1) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => {
            const el = document.activeElement;
            if (el === null || el === document.body) return "";
            const name = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
            return `${el.tagName.toLowerCase()}#${el.id}[${name}]`;
          }),
        );
      }
      return order;
    };

    it("behaves identically in the browser, from source and from the installed package", async () => {
      const browser = await chromium.launch();
      try {
        // -----------------------------------------------------------
        // The explorer.
        // -----------------------------------------------------------
        const explorerRun = async (path: string) => {
          const page = await openArtifact(browser, path);
          const record: Record<string, Observation | string[]> = {};

          // §17 -- nothing moves until the reader asks. A page that animated
          // itself on load would have marked something within this window.
          await page.waitForTimeout(1200);
          record.onLoad = await observe(page);

          // §26 -- keyboard reach and a visible focus indicator. Focus order
          // is recorded by accessible name, not by DOM position, so a
          // control that lost its name shows up as a change.
          record.tabOrder = await tabOrder(page, 8);
          record.focusIndicator = [
            await page.evaluate(() => {
              const el = document.getElementById("rvs-search");
              if (el === null) return "no search control";
              el.focus();
              const style = window.getComputedStyle(el);
              // A focused control must be visibly distinguished by something
              // -- an outline, a ring, a border -- not by nothing at all.
              return [style.outlineStyle, style.outlineWidth, style.boxShadow === "none" ? "no-shadow" : "shadow"].join("|");
            }),
          ];

          await page.fill("#rvs-search", "orders");
          await page.waitForTimeout(200);
          record.afterSearch = await observe(page);
          record.searchResults = await page.evaluate(() =>
            Array.from(document.querySelectorAll("#rvs-results li")).map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim()),
          );

          // Select an entity, and read what the inspector says about it.
          await page.evaluate(() => {
            const node = document.querySelector("#rvs-stage [data-rvs-node]") as HTMLElement | null;
            node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          await page.waitForTimeout(200);
          record.afterSelect = await observe(page);

          // §17 -- trace a route, and require the motion to touch exactly
          // the edges the traversal found. Not "roughly the route": the
          // traversal is asked in-page for its own answer, and the animation
          // is compared against it.
          const pair = await page.evaluate(() => {
            const model = JSON.parse(document.getElementById("rvs-model")?.textContent ?? "{}") as {
              nodes: Array<{ id: string }>;
            };
            const trace = (globalThis as unknown as { rvsTraceRoute: (m: unknown, f: string, t: string, d: string) => { edge_ids: string[] } | null }).rvsTraceRoute;
            for (const from of model.nodes) {
              for (const to of model.nodes) {
                if (from.id === to.id) continue;
                const route = trace(model, from.id, to.id, "downstream");
                if (route && route.edge_ids.length > 1) return { from: from.id, to: to.id, edges: route.edge_ids };
              }
            }
            return null;
          });
          record.routeEdges = pair === null ? ["no multi-edge route in this fixture"] : pair.edges;
          if (pair !== null) {
            await page.evaluate((id: string) => {
              const node = document.querySelector(`#rvs-stage [data-rvs-node="${id}"]`) as HTMLElement | null;
              node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }, pair.from);
            // The recorder is cumulative over the page's whole lifetime,
            // which is what makes an interrupted sequence visible as a short
            // list. Here that is the wrong window: selecting the route's
            // origin is itself an interaction and plays its own emphasis, so
            // without clearing the log first the route's motion would be
            // read together with the selection's and "exactly the route"
            // could never be asserted. Cleared after the origin is selected
            // and its motion has finished, so what follows is the route's.
            await page.waitForTimeout(600);
            await clearSeen(page);
            await page.selectOption("#rvs-route-to", pair.to);
            await page.waitForTimeout(1500);
            record.afterRoute = await observe(page);
            const touched = [...new Set((record.afterRoute as Observation).seen)].filter((id) => id !== "?");
            record.routeTouched = touched;
          }

          // §17 -- impact fans out only over what the traversal reached.
          const reached = await page.evaluate(() => {
            const model = JSON.parse(document.getElementById("rvs-model")?.textContent ?? "{}") as { nodes: Array<{ id: string }> };
            const reach = (globalThis as unknown as { rvsReachFrom: (m: unknown, id: string, d: string, depth: number) => { node_ids: string[] } }).rvsReachFrom;
            const start = model.nodes[0].id;
            return { start, node_ids: reach(model, start, "downstream", 2).node_ids };
          });
          record.reachable = reached.node_ids;
          await page.evaluate((id: string) => {
            const node = document.querySelector(`#rvs-stage [data-rvs-node="${id}"]`) as HTMLElement | null;
            node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }, reached.start);
          await page.selectOption("#rvs-direction", "downstream");
          await page.waitForTimeout(600);
          await page.fill("#rvs-depth", "2");
          // Same reason as the route above: selecting the origin and then
          // the direction each played their own emphasis, and the claim
          // being tested here is about what *impact* reached.
          await clearSeen(page);
          await page.dispatchEvent("#rvs-depth", "change");
          await page.waitForTimeout(1500);
          record.afterImpact = await observe(page);

          // §28 -- interrupt. Escape mid-sequence must abandon it, and the
          // page must be usable immediately afterwards.
          await page.fill("#rvs-depth", "3");
          await page.dispatchEvent("#rvs-depth", "change");
          await page.waitForTimeout(60);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          record.afterEscape = await observe(page);

          await page.selectOption("#rvs-lens", "governance");
          await page.waitForTimeout(300);
          record.afterLens = await observe(page);

          await page.click("#rvs-clear");
          await page.waitForTimeout(300);
          record.afterClear = await observe(page);

          await page.close();
          return record;
        };

        const explorerFromSource = await explorerRun(join(richSourceDir, EXPLORER));
        const explorerFromPackage = await explorerRun(join(richPackagedDir, EXPLORER));

        // §28 -- identical actions, identical focused ids, selected ids,
        // visible ids, route ids, motion emphasis and announcement text. No
        // animation timestamp is compared; only what the reader would see.
        expect(structuralDiff(explorerFromSource, explorerFromPackage, "explorer interaction")).toEqual([]);

        // The claims those recordings have to support.
        expect((explorerFromSource.onLoad as Observation).seen, "the explorer moved before the reader asked it to").toEqual([]);
        expect((explorerFromSource.tabOrder as string[]).filter((entry) => entry !== "").length, "keyboard focus reached no controls").toBeGreaterThan(3);
        expect((explorerFromSource.focusIndicator as string[])[0]).not.toEqual("none|0px|no-shadow");
        expect((explorerFromSource.afterSearch as Observation).status).not.toEqual("");
        expect((explorerFromSource.afterSelect as Observation).inspector).not.toEqual("");
        if ((explorerFromSource.routeEdges as string[]).length > 1) {
          // Exactly the route: no extra edge lit up, and none of the route's
          // own edges was skipped.
          expect([...(explorerFromSource.routeTouched as string[])].sort()).toEqual([...(explorerFromSource.routeEdges as string[])].sort());
        }
        for (const id of (explorerFromSource.afterImpact as Observation).seen) {
          if (id === "?") continue;
          expect(explorerFromSource.reachable as string[], `impact motion touched ${id}, which the traversal never reached`).toContain(id);
        }
        // Interrupted, not merely finished: nothing is still marked, and the
        // page still answers.
        expect((explorerFromSource.afterEscape as Observation).moving).toEqual([]);
        expect((explorerFromSource.afterClear as Observation).status).not.toEqual("");

        // -----------------------------------------------------------
        // The change review.
        // -----------------------------------------------------------
        const reviewRun = async (path: string) => {
          const page = await openArtifact(browser, path);
          const record: Record<string, Observation | string[]> = {};
          await page.waitForTimeout(1200);
          record.onLoad = await observe(page);
          record.tabOrder = await tabOrder(page, 8);

          await page.click("#rvs-animate");
          await page.waitForTimeout(2000);
          record.afterAnimate = await observe(page);

          await page.evaluate(() => {
            const item = document.querySelector("#rvs-change-list [data-rvs-change]") as HTMLElement | null;
            item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          await page.waitForTimeout(200);
          record.afterSelectChange = await observe(page);
          record.evidence = await page.evaluate(() =>
            Array.from(document.querySelectorAll("#rvs-evidence li")).map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim()),
          );

          await page.selectOption("#rvs-lens", "governance");
          await page.waitForTimeout(300);
          record.afterLens = await observe(page);
          record.lensCaveat = [await page.evaluate(() => document.getElementById("rvs-lens-caveat")?.textContent ?? "")];

          await page.click("#rvs-animate");
          await page.waitForTimeout(80);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          record.afterEscape = await observe(page);

          await page.close();
          return record;
        };

        const reviewFromSource = await reviewRun(join(richSourceDir, REVIEW));
        const reviewFromPackage = await reviewRun(join(richPackagedDir, REVIEW));
        expect(structuralDiff(reviewFromSource, reviewFromPackage, "change review interaction")).toEqual([]);
        expect((reviewFromSource.onLoad as Observation).seen).toEqual([]);
        expect((reviewFromSource.afterAnimate as Observation).seen.length, "asking for the compare sequence moved nothing").toBeGreaterThan(0);
        expect((reviewFromSource.afterSelectChange as Observation).inspector).not.toEqual("");
        expect((reviewFromSource.lensCaveat as string[])[0], "the governance lens dropped its caveat").toContain("no finding was recorded");
        expect((reviewFromSource.afterEscape as Observation).moving).toEqual([]);

        // -----------------------------------------------------------
        // §27 -- and the same pages, for a reader who has asked for
        // reduced motion.
        // -----------------------------------------------------------
        const reducedRun = async (path: string, trigger: (page: Page) => Promise<void>) => {
          const page = await openArtifact(browser, path, "reduce");
          await trigger(page);
          await page.waitForTimeout(2000);
          const record = await observe(page);
          const readout = await page.evaluate(() => ({
            // The complete static semantics: every entity still drawn, still
            // named, still carrying its state.
            nodes: Array.from(document.querySelectorAll("[data-rvs-node]")).map((el) => el.getAttribute("data-rvs-node")).sort(),
            edges: Array.from(document.querySelectorAll("[data-rvs-edge]")).map((el) => el.getAttribute("data-rvs-edge")).sort(),
            titles: Array.from(document.querySelectorAll("svg title")).map((el) => el.textContent).sort(),
            descriptions: Array.from(document.querySelectorAll("svg desc")).map((el) => el.textContent).sort(),
            live: Array.from(document.querySelectorAll("[aria-live]")).map((el) => `${el.id}=${el.getAttribute("aria-live")}`).sort(),
          }));
          await page.close();
          return { record, readout };
        };

        const explorerTrigger = async (page: Page) => {
          await page.evaluate(() => {
            const node = document.querySelector("#rvs-stage [data-rvs-node]") as HTMLElement | null;
            node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
          await page.selectOption("#rvs-direction", "downstream");
          await page.fill("#rvs-depth", "2");
          await page.dispatchEvent("#rvs-depth", "change");
        };
        const reviewTrigger = async (page: Page) => { await page.click("#rvs-animate"); };

        for (const [label, rel, trigger] of [
          ["explorer", EXPLORER, explorerTrigger],
          ["change review", REVIEW, reviewTrigger],
        ] as Array<[string, string, (page: Page) => Promise<void>]>) {
          const fromSource = await reducedRun(join(richSourceDir, rel), trigger);
          const fromPackage = await reducedRun(join(richPackagedDir, rel), trigger);
          expect(structuralDiff(fromSource, fromPackage, `${label} reduced motion`)).toEqual([]);

          // Not played faster -- not played.
          expect(fromSource.record.seen, `${label} animated under a reduced-motion preference`).toEqual([]);
          expect(fromSource.record.moving).toEqual([]);
          // ...and nothing was withheld for it. The reader who turned motion
          // off still has the whole document, the announcement, and the
          // route or comparison they asked for.
          expect(fromSource.record.status, `${label} said nothing under reduced motion`).not.toEqual("");
          expect(fromSource.readout.nodes.length).toBeGreaterThan(0);
          expect(fromSource.readout.titles.length).toBeGreaterThan(0);
          expect(fromSource.readout.descriptions.length).toBeGreaterThan(0);
          expect(fromSource.readout.live.length).toBeGreaterThan(0);
        }
      } finally {
        await browser.close();
      }
    }, 600_000);

    // ===============================================================
    // §26 -- the accessibility validators, on both artifacts, reusing the
    // engine that already exists rather than a second one.
    // ===============================================================
    it("passes the same accessibility validation from source and from the installed package", async () => {
      for (const rel of VISUAL_ARTIFACTS) {
        const fromSource = await validateHtmlFile(join(richSourceDir, rel));
        const fromPackage = await validateHtmlFile(join(richPackagedDir, rel));
        // Only `generated_at` and `source_file` are stripped: one is a
        // timestamp and the other is the path the file happened to be read
        // from. Every finding, code, message, severity and count is compared.
        expect(structuralDiff(stripValidationVolatile(fromSource), stripValidationVolatile(fromPackage), `${rel} validation`)).toEqual([]);
        // §26 -- the checks the validator already implements, including the
        // minimum text size and contrast floors, must pass on what the
        // installed package produced.
        const failures = fromPackage.scenes.flatMap((scene) =>
          scene.checks.filter((check) => check.status === "fail").map((check) => `${scene.scene_id} ${check.rule}: ${check.message}`),
        );
        expect(failures, `${rel} failed accessibility validation from the installed package`).toEqual([]);
        expect(fromPackage.summary.failed).toEqual(0);
        expect(fromPackage.summary.scenes, `${rel} presented nothing for the validator to check`).toBeGreaterThan(0);
      }
    }, 300_000);

    // ===============================================================
    // Milestone 10.6 §55-§58 -- verified delivery, from the installed
    // package.
    //
    // The delivery gate is the part of the visual system whose failure is
    // silent. A packaging defect that made verification pass vacuously --
    // a validator family bundled but never reached, a profile table
    // tree-shaken to nothing -- would promote whatever it was handed, and
    // no output anywhere would say so. So the whole sequence runs through
    // both CLIs (promote, refuse, promote again) and every artifact of the
    // decision is compared: candidate identity, verification digest,
    // validator families and their check counts, findings, the repair
    // receipt, the promotion state, the verified record, and the promoted
    // bytes.
    //
    // The refusal in the middle is an infrastructure refusal -- no browser
    // -- rather than a content refusal, and that is a property of the
    // system rather than a shortcut here. There is no way to hand `rvs` an
    // invalid candidate: it verifies only what its own renderers have just
    // produced, and those renderers are themselves guarded. Degradation
    // preserves critical paths (`VISUAL_PRESERVE_PRIMARY_PATH`) and
    // unresolved references (`VISUAL_PRESERVE_UNRESOLVED`) rather than
    // dropping them, and the renderer grows the frame instead of shrinking
    // type, so no repository content drives a generated candidate into a
    // layout, fidelity or typography rejection. Content rejections are
    // proved where a candidate can actually be constructed: over real
    // validator output in packages/visual-delivery/src/__tests__ and in
    // packages/cli/src/__tests__/verified-delivery.test.ts. What this test
    // owns is that the packaged gate reaches the same decision, by the same
    // route, as the source one.
    // ===============================================================

    const DELIVERED_EXPLORER = "artifacts/visuals/architecture-explorer.html";
    const DELIVERED_REVIEW = "artifacts/visuals/change-review.html";
    const DELIVERY_RUNS = ".rvs/cache/visual-delivery/runs";
    const DELIVERY_TARGETS = ".rvs/cache/visual-delivery/targets";

    /** One command, and everything it decided. */
    interface DeliveryStage {
      what: string;
      status: number;
      console: string;
      target_bytes: string | null;
      report: unknown;
      receipt: unknown;
      receipt_markdown: string | null;
      verified: unknown;
      runs: string[];
    }

    /**
     * §38 -- the clock, and only the clock.
     *
     * `created_at`, `verified_at` and `generated_at` are the three fields
     * the delivery layer stamps from the wall clock, and it stamps nothing
     * else from it: candidate ids, verification digests and receipt ids are
     * content-derived by construction, which is exactly what makes them
     * comparable between two CLIs run minutes apart. Removed recursively so
     * every other field of every nested record is compared untouched.
     */
    function withoutClock(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(withoutClock);
      if (value === null || typeof value !== "object") return value;
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === "created_at" || key === "verified_at" || key === "generated_at") continue;
        out[key] = withoutClock(nested);
      }
      return out;
    }

    /**
     * §38 -- the third normalization, and the only one this milestone adds.
     *
     * When no browser can be started the reason carries Playwright's own
     * first line, which names the browser build it looked for. The isolated
     * install resolved `^1.48.0` itself rather than reusing the workspace
     * lockfile's pin -- the same environment fact the doctor comparison
     * above already excludes -- so the two engines legitimately looked for
     * different revisions in different places. What must match is that both
     * reported the browser unavailable, called the verification incomplete
     * rather than failed, and promoted nothing.
     */
    const withoutBrowserBuild = (text: string) =>
      text.replace(
        /Browser verification is unavailable: [^]*?\. Install the browser/g,
        "Browser verification is unavailable: <cause>. Install the browser",
      );

    /** The verified record for one target, found by the path it names rather than by its digested key. */
    function verifiedRecordFor(root: string, targetPath: string): unknown {
      const dir = join(root, DELIVERY_TARGETS);
      if (!existsSync(dir)) return null;
      for (const key of readdirSync(dir).sort()) {
        const path = join(dir, key, "verified.json");
        if (!existsSync(path)) continue;
        const record = readJson(path) as { target_path?: string };
        if (record.target_path === targetPath) return record;
      }
      return null;
    }

    /**
     * Promote, refuse, promote again -- for the explorer and for the change
     * review, through one CLI.
     *
     * Seeded from the graph cache and snapshots that engine already built,
     * so the candidate being gated is the same artifact the rest of this
     * file has compared byte for byte.
     */
    function runDeliveryPipeline(engine: Engine, dir: string, richDir: string, browserless: string): DeliveryStage[] {
      mkdirSync(dir, { recursive: true });
      cpSync(join(richDir, ".rvs/cache"), join(dir, ".rvs/cache"), { recursive: true });
      for (const snapshot of ["snapshot before", "snapshot after"]) {
        cpSync(join(richDir, snapshot), join(dir, snapshot), { recursive: true });
      }
      writeFileSync(join(dir, "package.json"), readFileSync(join(richDir, "package.json")));
      writeFileSync(join(dir, "README.md"), readFileSync(join(richDir, "README.md")));

      const open = ["graph", "open", "--focus", "component:orders-service", "--verified", "--output", DELIVERED_EXPLORER];
      const review = ["graph", "review", "--from", "snapshot before", "--to", "snapshot after", "--verified", "--output", DELIVERED_REVIEW];

      // The middle run of each triple is the one that must not promote. The
      // browsers path is a real, empty directory, so Playwright's own
      // launch fails the way it would on a machine where nobody ran
      // `playwright install` -- the infrastructure failure this behaviour
      // exists for, not a simulated one.
      const plan: Array<{ what: string; args: string[]; target: string; blind?: true }> = [
        { what: "explorer V1", args: open, target: DELIVERED_EXPLORER },
        { what: "explorer V2, with no browser", args: open, target: DELIVERED_EXPLORER, blind: true },
        { what: "explorer V3", args: open, target: DELIVERED_EXPLORER },
        { what: "change review V1", args: review, target: DELIVERED_REVIEW },
        { what: "change review V2, with no browser", args: review, target: DELIVERED_REVIEW, blind: true },
        { what: "change review V3", args: review, target: DELIVERED_REVIEW },
      ];

      // The preview line carries a `file://` URL, which percent-encodes the
      // spaces in the run root, so replacing the plain path does not reach
      // it. Both spellings of this engine's own root become the same
      // placeholder -- §36 once more: where a run happened is not a fact
      // about what it produced.
      const withoutRoot = (text: string) =>
        withoutRunRoot(withoutRunRoot(text, dir), pathToFileURL(dir).toString().replace(/^file:\/\//, ""));

      const stages: DeliveryStage[] = [];
      for (const step of plan) {
        const env = step.blind === true ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserless } : undefined;
        const raw = engine.capture(step.args, dir, env);
        const runs = readdirSync(join(dir, DELIVERY_RUNS)).filter((name) => name.startsWith("run-")).sort();
        const latest = join(dir, DELIVERY_RUNS, runs[runs.length - 1]);
        const receiptPath = join(latest, "repair-receipt.json");
        const markdownPath = join(latest, "repair-receipt.md");
        const targetPath = join(dir, step.target);
        stages.push({
          what: step.what,
          status: raw.status,
          console: withoutBrowserBuild(withoutNpmChatter(withoutRoot(`${raw.stdout}${raw.stderr}`))),
          target_bytes: existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null,
          report: withoutClock(JSON.parse(withoutBrowserBuild(readFileSync(join(latest, "visual-verification-report.json"), "utf8")))),
          receipt: existsSync(receiptPath)
            ? withoutClock(JSON.parse(withoutBrowserBuild(readFileSync(receiptPath, "utf8"))))
            : null,
          receipt_markdown: existsSync(markdownPath) ? withoutBrowserBuild(readFileSync(markdownPath, "utf8")) : null,
          verified: withoutClock(verifiedRecordFor(dir, step.target)),
          runs,
        });
      }
      return stages;
    }

    it("verifies, promotes and preserves identically from the installed package", () => {
      const browserless = mkdtempSync(join(tmpdir(), "rvs-no-browsers-"));
      const deliverySource = join(visualRoot, "verified delivery from source");
      const deliveryPackaged = join(visualRoot, "verified delivery from the installed package");

      const fromSource = runDeliveryPipeline(sourceEngine, deliverySource, richSourceDir, browserless);
      const fromPackaged = runDeliveryPipeline(packagedEngine, deliveryPackaged, richPackagedDir, browserless);

      // §56, §98 -- every layer of the decision, in one comparison:
      // candidate digest and id, profile, verification digest, family
      // results and check counts, findings, receipt, promotion state, the
      // verified record and its history, the promoted bytes, the exit
      // status, and what each CLI printed.
      expect(structuralDiff(fromSource, fromPackaged, "verified delivery")).toEqual([]);
      for (let i = 0; i < fromSource.length; i += 1) {
        expect(textDiff(`${fromSource[i].what} console`, fromSource[i].console, fromPackaged[i].console)).toEqual([]);
      }

      type Report = {
        status: string;
        promotion_status: string;
        verification_digest: string;
        candidate: { candidate_id: string; artifact_digest: string; generation: number; validation_profile: string };
        profile: { id: string };
        validators: Array<{ family: string; status: string; checks: number }>;
        findings: Array<{ code: string; severity: string }>;
        target: { path: string; digest_before: string | null; digest_after: string | null };
        last_known_good: { verified_artifact_id: string } | null;
        incomplete_reason?: string;
      };
      type Receipt = {
        verification_status: string;
        target_preserved: boolean;
        last_known_good_id: string | null;
        findings: Array<{ code: string; validator: string; supported_repairs: string[] }>;
      };
      type Verified = { current: { verified_artifact_id: string; generation: number; profile_id: string; artifact_digest: string } | null; previous: Array<{ verified_artifact_id: string }> };

      const report = (stage: DeliveryStage) => stage.report as Report;
      const verified = (stage: DeliveryStage) => stage.verified as Verified;

      // The claims are made against the packaged side: it is the one at
      // risk, and the comparison above has already established that the
      // source side agrees with it in every field.
      const [explorerV1, explorerV2, explorerV3, reviewV1, reviewV2, reviewV3] = fromPackaged;

      for (const [first, blind, third, target, profileId, plain] of [
        [explorerV1, explorerV2, explorerV3, DELIVERED_EXPLORER, "visual-interactive-v2", EXPLORER],
        [reviewV1, reviewV2, reviewV3, DELIVERED_REVIEW, "visual-change-review-v2", REVIEW],
      ] as Array<[DeliveryStage, DeliveryStage, DeliveryStage, string, string, string]>) {
        // ---- V1: a valid candidate, and the first thing ever verified
        // at this target.
        expect(first.status, `${first.what} did not exit zero`).toEqual(0);
        expect(report(first).status).toEqual("passed");
        expect(report(first).promotion_status).toEqual("promoted");
        expect(report(first).profile.id).toEqual(profileId);
        expect(report(first).findings.filter((f) => f.severity === "blocking")).toEqual([]);
        expect(report(first).target.digest_before, "something was already at the target").toBeNull();
        expect(report(first).target.digest_after).toEqual(report(first).candidate.artifact_digest);
        expect(first.console).toContain(`Promoted verified artifact to ${target}.`);
        expect(first.console).toContain(profileId);
        expect(first.receipt, "a passing candidate wrote a repair receipt").toBeNull();
        // Every family the profile names actually ran. A gate that silently
        // skipped a family would report exactly this shape minus a row.
        expect(report(first).validators.map((v) => v.family).sort()).toEqual(
          ["accessibility", "fidelity", "interaction", "layout", "motion", "reference", "schema"],
        );
        for (const family of report(first).validators) {
          expect(family.status, `${family.family} did not pass`).toEqual("passed");
          // Not a vacuous pass: each family measured something. `motion` is
          // the one exception, and deliberately so -- §33 says a static
          // artifact is a valid artifact, and `rvs graph open` draws one, so
          // the honest count of motion checks on the explorer is zero.
          if (family.family === "motion" && target === DELIVERED_EXPLORER) {
            expect(family.checks, "the static explorer claimed motion checks").toEqual(0);
          } else {
            expect(family.checks, `${family.family} ran no checks`).toBeGreaterThan(0);
          }
        }

        // §60, §68, §69 -- the promoted file is exactly the artifact the
        // ordinary command writes. The gate chooses whether to publish; it
        // has no renderer of its own and does not touch a byte.
        expect(first.target_bytes).toEqual(readArtifact(richPackagedDir, plain));

        const promoted = verified(first).current;
        expect(promoted?.artifact_digest).toEqual(report(first).candidate.artifact_digest);
        expect(promoted?.profile_id).toEqual(profileId);
        expect(verified(first).previous, "a first promotion carried history").toEqual([]);

        // ---- V2: the browser cannot start. Nothing about the artifact was
        // measured, so nothing is claimed about it.
        expect(blind.status, `${blind.what} exited zero`).toEqual(1);
        expect(report(blind).status).toEqual("incomplete");
        expect(report(blind).promotion_status).toEqual("not_promoted");
        expect(report(blind).incomplete_reason).toContain("Browser verification is unavailable");
        // §77 -- infrastructure failure is not content failure. The
        // families that need a browser did not run; the ones that do not
        // still passed, and are still reported.
        const byFamily = new Map(report(blind).validators.map((v) => [v.family, v.status] as const));
        expect(byFamily.get("layout")).toEqual("not_run");
        expect(byFamily.get("interaction")).toEqual("not_run");
        expect(byFamily.get("schema")).toEqual("passed");
        expect(byFamily.get("fidelity")).toEqual("passed");
        expect(byFamily.get("reference")).toEqual("passed");

        // §34 -- the last known good is preserved as bytes, not as an
        // equivalent document.
        expect(blind.target_bytes).toEqual(first.target_bytes);
        expect(report(blind).target.digest_after).toEqual(report(blind).target.digest_before);
        expect(report(blind).target.digest_after).toEqual(promoted?.artifact_digest);
        expect(verified(blind).current?.verified_artifact_id).toEqual(promoted?.verified_artifact_id);

        // §80 -- and a receipt that says which of the two it was.
        const receipt = blind.receipt as Receipt;
        expect(receipt.verification_status).toEqual("incomplete");
        expect(receipt.target_preserved).toBe(true);
        expect(receipt.last_known_good_id).toEqual(promoted?.verified_artifact_id ?? null);
        expect(receipt.findings.map((f) => f.code)).toContain("VISUAL_VERIFICATION_BROWSER_UNAVAILABLE");
        expect(blind.receipt_markdown).toContain("Verification incomplete");
        expect(blind.console).toContain("Verification incomplete");
        expect(blind.console).toContain("Candidate not promoted.");
        expect(blind.console).toContain(`Last known good preserved: ${target}`);

        // ---- V3: the same repository, verified again once the browser is
        // back. A newer generation replaces the artifact, and the record it
        // replaces moves into history rather than disappearing.
        expect(third.status, `${third.what} did not exit zero`).toEqual(0);
        expect(report(third).status).toEqual("passed");
        expect(report(third).promotion_status).toEqual("promoted");
        expect(report(third).candidate.generation).toBeGreaterThan(report(first).candidate.generation);
        expect(third.target_bytes).toEqual(first.target_bytes);
        expect(verified(third).previous.map((p) => p.verified_artifact_id)).toEqual([
          promoted?.verified_artifact_id ?? "",
        ]);
        // Identity is content-derived, so re-verifying identical bytes
        // under the same profile is the same candidate and the same
        // verification -- the generation is what moved.
        expect(report(third).candidate.candidate_id).toEqual(report(first).candidate.candidate_id);
        expect(report(third).verification_digest).toEqual(report(first).verification_digest);
      }

      // §36 -- nothing the gate wrote names the machine it ran on: not the
      // run root, not the install root, not the checkout, not $HOME.
      for (const stage of fromPackaged) {
        const written = `${JSON.stringify(stage.report)}${JSON.stringify(stage.receipt)}${stage.receipt_markdown ?? ""}`;
        for (const path of [deliveryPackaged, visualRoot, repoRoot, homedir()]) {
          expect(written, `${stage.what} recorded an absolute path`).not.toContain(path);
        }
      }

      // §47 -- and everything it wrote, it wrote inside the delivery cache.
      const strayFiles = (root: string): string[] => {
        const out: string[] = [];
        const walk = (dir: string, prefix: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
            if (entry.isDirectory()) walk(join(dir, entry.name), rel);
            else out.push(rel);
          }
        };
        walk(root, "");
        return out;
      };
      const written = strayFiles(deliveryPackaged);
      const delivered = written.filter((rel) => rel.includes("visual-delivery") || rel.startsWith("artifacts/"));
      expect(delivered.length, "the delivery run wrote nothing").toBeGreaterThan(0);
      for (const rel of delivered) {
        expect(
          rel.startsWith(".rvs/cache/visual-delivery/") || rel === DELIVERED_EXPLORER || rel === DELIVERED_REVIEW,
          `${rel} was written outside the delivery cache and the target`,
        ).toBe(true);
      }
      // §35 -- and left no temporary of its own behind: no `.partial`, no
      // half-promoted file beside the target.
      expect(written.filter((rel) => rel.endsWith(".partial") || rel.includes(".rvs-promote"))).toEqual([]);
      // A rejected candidate is retained for diagnosis; a promoted one is
      // not, because the target holds it.
      const staged = written.filter((rel) => /^\.rvs\/cache\/visual-delivery\/runs\/run-\d+\/[^/]+\.html$/.test(rel));
      expect(staged.length, "a promoted candidate was left in staging, or a rejected one was cleaned away").toEqual(2);

      rmSync(browserless, { recursive: true, force: true });
      rmSync(deliverySource, { recursive: true, force: true });
    }, 900_000);

    // ===============================================================
    // §58 -- the same gate, with the network unavailable.
    // ===============================================================
    it("verifies and promotes from the installed package with no network at all", () => {
      const dir = join(visualRoot, "verified delivery with no network at all");
      const source = join(visualRoot, "verified delivery from the installed package");
      mkdirSync(dir, { recursive: true });
      for (const entry of [".rvs/cache", "snapshot before", "snapshot after"]) {
        cpSync(join(source, entry), join(dir, entry), { recursive: true });
      }
      for (const file of ["package.json", "README.md"]) writeFileSync(join(dir, file), readFileSync(join(source, file)));

      const env = isolatedEnv({
        NODE_OPTIONS: `--require ${offlineGuard}`,
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
        npm_config_registry: "http://127.0.0.1:9",
      });
      // The installed bin, run by this test's own node, with the socket
      // guard preloaded. Chromium is driven over a pipe rather than a
      // socket, so the browser families genuinely run here -- this is the
      // full interactive profile offline, not the browser-free subset.
      const stdout = execFileSync(process.execPath, [installedBinJs, "graph", "open", "--focus", "component:orders-service", "--verified", "--output", DELIVERED_EXPLORER], {
        cwd: dir,
        encoding: "utf8",
        env,
      });

      expect(stdout).toContain(`Promoted verified artifact to ${DELIVERED_EXPLORER}.`);
      expect(stdout).toContain("visual-interactive-v2");

      const runs = readdirSync(join(dir, DELIVERY_RUNS)).filter((name) => name.startsWith("run-")).sort();
      const offlineReport = readJson(join(dir, DELIVERY_RUNS, runs[runs.length - 1], "visual-verification-report.json")) as {
        status: string;
        verification_digest: string;
        validators: Array<{ family: string; status: string }>;
        candidate: { candidate_id: string };
      };
      const onlineReport = readJson(
        join(
          source,
          DELIVERY_RUNS,
          readdirSync(join(source, DELIVERY_RUNS)).filter((name) => name.startsWith("run-")).sort()[0],
          "visual-verification-report.json",
        ),
      ) as { verification_digest: string; candidate: { candidate_id: string } };

      expect(offlineReport.status).toEqual("passed");
      // Every family ran, including the two that need a browser.
      expect(offlineReport.validators.filter((v) => v.status !== "passed")).toEqual([]);
      // §5, §56 -- the same candidate, the same verification, the same
      // bytes as the run that had a network available.
      expect(offlineReport.candidate.candidate_id).toEqual(onlineReport.candidate.candidate_id);
      expect(offlineReport.verification_digest).toEqual(onlineReport.verification_digest);
      expect(readArtifact(dir, DELIVERED_EXPLORER)).toEqual(readArtifact(source, DELIVERED_EXPLORER));

      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }, 300_000);

  });
});
