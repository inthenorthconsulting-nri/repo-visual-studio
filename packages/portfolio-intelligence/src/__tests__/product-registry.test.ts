import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PortfolioConfig } from "../contracts.js";
import { loadPortfolioConfig, portfolioConfigPath, validatePortfolioConfig } from "../product-registry.js";
import { makePortfolioConfig, makePortfolioConfigProduct } from "./fixtures.js";

// These tests exercise validatePortfolioConfig's existsSync(artifact_root) check
// and loadPortfolioConfig's real node:fs-backed YAML parse against a genuine
// temp directory (mkdtempSync under node:os's tmpdir), cleaned up after each test.

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "rvs-portfolio-registry-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/** Creates a real `<repoRoot>/artifacts/<configId>` directory and returns the `.rvs/portfolio.yml`-style relative artifact_root string that points at it. */
function makeArtifactDir(configId: string): string {
  mkdirSync(join(repoRoot, "artifacts", configId), { recursive: true });
  return `./artifacts/${configId}`;
}

describe("validatePortfolioConfig", () => {
  it("returns no errors for a config whose single product has an existing artifact_root and no duplicates", () => {
    const config = makePortfolioConfig({
      products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: makeArtifactDir("governance-cli") })],
    });
    expect(validatePortfolioConfig(config, repoRoot)).toEqual([]);
  });

  it("errors when two products declare the same id", () => {
    const config: PortfolioConfig = {
      ...makePortfolioConfig(),
      products: [
        makePortfolioConfigProduct({ id: "governance-cli", artifact_root: makeArtifactDir("governance-cli") }),
        makePortfolioConfigProduct({ id: "governance-cli", artifact_root: makeArtifactDir("governance-cli-2") }),
      ],
    };
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.field === "products" && e.message.includes('Duplicate product id "governance-cli"'))).toBe(true);
  });

  it("errors when a product's artifact_root does not exist on disk", () => {
    const config = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: "./artifacts/does-not-exist" })] });
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.message.includes('artifact_root "./artifacts/does-not-exist" does not exist'))).toBe(true);
  });

  it("does not error when a second product declares a valid alias_of pointing at a declared product id sharing the same artifact_root", () => {
    const root = makeArtifactDir("governance-cli");
    const config: PortfolioConfig = {
      ...makePortfolioConfig(),
      products: [
        makePortfolioConfigProduct({ id: "governance-cli", artifact_root: root }),
        makePortfolioConfigProduct({ id: "governance-cli-alias", artifact_root: root, alias_of: "governance-cli" }),
      ],
    };
    expect(validatePortfolioConfig(config, repoRoot)).toEqual([]);
  });

  it("errors when alias_of points at an undeclared product id", () => {
    const root = makeArtifactDir("governance-cli");
    const config: PortfolioConfig = {
      ...makePortfolioConfig(),
      products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: root, alias_of: "not-declared" })],
    };
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.message.includes('alias_of "not-declared", which is not a declared product id'))).toBe(true);
  });

  it("errors when two products point at the same artifact_root without an explicit alias_of", () => {
    const root = makeArtifactDir("governance-cli");
    const config: PortfolioConfig = {
      ...makePortfolioConfig(),
      products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: root }), makePortfolioConfigProduct({ id: "governance-cli-shadow", artifact_root: root })],
    };
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.message.includes("without an explicit alias_of"))).toBe(true);
  });

  it("rejects an artifact_root with a URL scheme instead of resolving it as a relative path", () => {
    const config = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: "https://example.com/artifacts" })] });
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.message.includes("must be a local filesystem path, not a remote URL"))).toBe(true);
  });

  it("errors when two products point at the same real directory through a symlinked artifact_root, without an explicit alias_of", () => {
    const root = makeArtifactDir("governance-cli");
    const symlinkRoot = "./artifacts/governance-cli-link";
    symlinkSync(join(repoRoot, "artifacts", "governance-cli"), join(repoRoot, "artifacts", "governance-cli-link"));
    const config: PortfolioConfig = {
      ...makePortfolioConfig(),
      products: [makePortfolioConfigProduct({ id: "governance-cli", artifact_root: root }), makePortfolioConfigProduct({ id: "governance-cli-shadow", artifact_root: symlinkRoot })],
    };
    const errors = validatePortfolioConfig(config, repoRoot);
    expect(errors.some((e) => e.message.includes("without an explicit alias_of"))).toBe(true);
  });
});

describe("portfolioConfigPath", () => {
  it("resolves to <repoRoot>/.rvs/portfolio.yml", () => {
    expect(portfolioConfigPath(repoRoot)).toBe(join(repoRoot, ".rvs", "portfolio.yml"));
  });
});

describe("loadPortfolioConfig", () => {
  it("returns undefined when .rvs/portfolio.yml does not exist", () => {
    expect(loadPortfolioConfig(repoRoot)).toBeUndefined();
  });

  it("parses a real .rvs/portfolio.yml file back into a matching PortfolioConfig", () => {
    makeArtifactDir("governance-cli");
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    const yaml = ["schema_version: 1", "portfolio:", "  id: test-portfolio", "  display_name: Test Portfolio", "products:", "  - id: governance-cli", "    artifact_root: ./artifacts/governance-cli", ""].join(
      "\n",
    );
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), yaml, "utf8");

    const loaded = loadPortfolioConfig(repoRoot);
    expect(loaded).toEqual({
      schema_version: 1,
      portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
      products: [{ id: "governance-cli", artifact_root: "./artifacts/governance-cli" }],
    });
  });

  it("parses alias_of, audiences, and approved_relationships from a real file", () => {
    makeArtifactDir("governance-cli");
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    const yaml = [
      "schema_version: 1",
      "portfolio:",
      "  id: test-portfolio",
      "  display_name: Test Portfolio",
      "products:",
      "  - id: governance-cli",
      "    artifact_root: ./artifacts/governance-cli",
      "  - id: governance-cli-alias",
      "    artifact_root: ./artifacts/governance-cli",
      "    alias_of: governance-cli",
      "audiences:",
      "  - executive",
      "approved_relationships:",
      "  - product_a: governance-cli",
      "    product_b: governance-cli-alias",
      "    relationship: shared_platform",
      "",
    ].join("\n");
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), yaml, "utf8");

    const loaded = loadPortfolioConfig(repoRoot);
    expect(loaded?.products).toEqual([
      { id: "governance-cli", artifact_root: "./artifacts/governance-cli" },
      { id: "governance-cli-alias", artifact_root: "./artifacts/governance-cli", alias_of: "governance-cli" },
    ]);
    expect(loaded?.audiences).toEqual(["executive"]);
    expect(loaded?.approved_relationships).toEqual([{ product_a: "governance-cli", product_b: "governance-cli-alias", relationship: "shared_platform" }]);
  });

  it("throws (with a message identifying the failing product) when the loaded config fails validatePortfolioConfig", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    const yaml = ["schema_version: 1", "portfolio:", "  id: test-portfolio", "  display_name: Test Portfolio", "products:", "  - id: governance-cli", "    artifact_root: ./artifacts/does-not-exist", ""].join(
      "\n",
    );
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), yaml, "utf8");
    expect(() => loadPortfolioConfig(repoRoot)).toThrow(/does not exist/);
  });

  it("throws a friendly single-sentence error (not a raw YAML parser exception) when the file contains malformed YAML", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), "schema_version: 1\nportfolio:\n  id: [unterminated\n", "utf8");
    expect(() => loadPortfolioConfig(repoRoot)).toThrow(/^Invalid \.rvs\/portfolio\.yml: not valid YAML \(/);
  });

  it("throws a friendly single-sentence error (not a raw ZodError dump) when schema_version does not match", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    const yaml = ["schema_version: 2", "portfolio:", "  id: test-portfolio", "  display_name: Test Portfolio", "products:", "  - id: governance-cli", "    artifact_root: ./artifacts/governance-cli", ""].join(
      "\n",
    );
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), yaml, "utf8");
    expect(() => loadPortfolioConfig(repoRoot)).toThrow(/^Invalid \.rvs\/portfolio\.yml: schema_version:/);
  });

  it("throws a friendly single-sentence error when products is missing entirely", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    const yaml = ["schema_version: 1", "portfolio:", "  id: test-portfolio", "  display_name: Test Portfolio", ""].join("\n");
    writeFileSync(join(repoRoot, ".rvs", "portfolio.yml"), yaml, "utf8");
    expect(() => loadPortfolioConfig(repoRoot)).toThrow(/^Invalid \.rvs\/portfolio\.yml: products:/);
  });
});
