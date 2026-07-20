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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    // -- rather than a second pack/install. Deliberately the last thing this
    // test does: the final `create slides --profile governance` step below
    // overwrites deck.html/visualdoc.json with the governance deck, which
    // would invalidate the portfolio deck.html/git-commit/scene-id assertions
    // earlier in this test (see the note above the reordered-input proof) if
    // it ran any sooner.
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
  });
});
