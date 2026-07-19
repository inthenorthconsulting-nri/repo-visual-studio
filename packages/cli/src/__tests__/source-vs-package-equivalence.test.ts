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
    execFileSync("npm", ["install", tarballPath], { cwd: packagedDir, stdio: "inherit" });

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

  it("produces structurally identical cache, workflow, and deck output from source and from the tarball", () => {
    for (const run of [runSource, runPackaged]) {
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
  });
});
