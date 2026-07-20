import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGovernanceConfig } from "../governance-config.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "governance-config-test-"));
  mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeGovernanceYaml(repo: string, content: string): void {
  writeFileSync(join(repo, ".rvs", "governance.yml"), content, "utf8");
}

describe("loadGovernanceConfig", () => {
  it("returns undefined when .rvs/governance.yml does not exist", () => {
    expect(loadGovernanceConfig(repoRoot)).toBeUndefined();
  });

  it("loads a valid config with baseline, comparison, and policies", () => {
    writeGovernanceYaml(
      repoRoot,
      [
        "schema_version: 1",
        "baseline:",
        "  snapshot: .rvs/cache/governance/baseline-snapshot.json",
        "comparison:",
        "  fail_on: [blocking]",
        "  warn_on: [review_required]",
        "policies:",
        "  - .rvs/policies/architecture.yml",
        "  - .rvs/policies/capability.yml",
        "  - .rvs/policies/product.yml",
        "  - .rvs/policies/portfolio.yml",
      ].join("\n"),
    );

    const config = loadGovernanceConfig(repoRoot);
    expect(config).toBeDefined();
    expect(config?.schema_version).toBe(1);
    expect(config?.baseline).toEqual({ snapshot: ".rvs/cache/governance/baseline-snapshot.json" });
    expect(config?.comparison).toEqual({ fail_on: ["blocking"], warn_on: ["review_required"] });
    expect(config?.policies).toEqual([".rvs/policies/architecture.yml", ".rvs/policies/capability.yml", ".rvs/policies/product.yml", ".rvs/policies/portfolio.yml"]);
  });

  it("loads a minimal config with only schema_version", () => {
    writeGovernanceYaml(repoRoot, "schema_version: 1\n");
    const config = loadGovernanceConfig(repoRoot);
    expect(config).toEqual({ schema_version: 1 });
  });

  it("throws a clear error for malformed YAML", () => {
    writeGovernanceYaml(repoRoot, "schema_version: 1\nbaseline: [this is not: valid: yaml structure\n");
    expect(() => loadGovernanceConfig(repoRoot)).toThrow(/not valid YAML/);
  });

  it("throws a clear error when schema_version is missing", () => {
    writeGovernanceYaml(repoRoot, "baseline:\n  snapshot: .rvs/cache/governance/baseline-snapshot.json\n");
    expect(() => loadGovernanceConfig(repoRoot)).toThrow(/Invalid \.rvs\/governance\.yml/);
  });

  it("throws a clear error for an unrecognized severity value in fail_on", () => {
    writeGovernanceYaml(repoRoot, ["schema_version: 1", "comparison:", "  fail_on: [catastrophic]"].join("\n"));
    expect(() => loadGovernanceConfig(repoRoot)).toThrow(/comparison\.fail_on/);
  });

  it("throws a clear error for an unrecognized severity value in warn_on", () => {
    writeGovernanceYaml(repoRoot, ["schema_version: 1", "comparison:", "  warn_on: [nonsense]"].join("\n"));
    expect(() => loadGovernanceConfig(repoRoot)).toThrow();
  });

  it("throws on an unknown top-level field (strict schema)", () => {
    writeGovernanceYaml(repoRoot, "schema_version: 1\nunknown_field: true\n");
    expect(() => loadGovernanceConfig(repoRoot)).toThrow();
  });

  it("throws when schema_version is not 1", () => {
    writeGovernanceYaml(repoRoot, "schema_version: 2\n");
    expect(() => loadGovernanceConfig(repoRoot)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Untrusted-input / security coverage: `.rvs/governance.yml` is read
// straight from the repository being scanned (spec §47) via a plain
// `readFileSync` (governance-config.ts has no path-traversal or symlink
// logic of its own -- the path is always `resolve(repoRoot,
// ".rvs/governance.yml")`, never attacker-influenced), so the untrusted
// surface here is the YAML *content*, not the file path. Path-traversal /
// symlink OS-level tests are therefore deliberately out of scope for this
// file.
// ---------------------------------------------------------------------------

describe("loadGovernanceConfig: untrusted YAML content", () => {
  it("resolves YAML anchors/aliases as plain data (never executes anything) and rejects any leftover alias-only garbage as ordinary schema input", () => {
    // `&snap` anchors a scalar; `*snap` aliases it back in `policies`. The
    // `yaml` package (used via `parse` in governance-config.ts) only ever
    // performs structural node-graph expansion here -- there is no code
    // execution surface for a YAML anchor/alias to exploit, unlike (say) a
    // custom-tag-enabled parser. This test's core assertion is simply that
    // the alias resolves to the SAME string the anchor defined, proving the
    // parser treated it as inert data.
    writeGovernanceYaml(
      repoRoot,
      ["schema_version: 1", "baseline:", "  snapshot: &snap .rvs/cache/governance/baseline-snapshot.json", "policies:", "  - *snap"].join("\n"),
    );
    const config = loadGovernanceConfig(repoRoot);
    expect(config?.baseline?.snapshot).toBe(".rvs/cache/governance/baseline-snapshot.json");
    expect(config?.policies).toEqual([".rvs/cache/governance/baseline-snapshot.json"]);
  });

  it("parses deeply nested YAML without hanging or crashing, then cleanly rejects the unrecognized shape via the strict schema", () => {
    // A pathologically deep flow-style array (not an anchor/alias
    // "billion laughs" amplification bomb -- this file's schema has no field
    // that would even accept a nested-array value, so amplification isn't
    // the risk here; a parser that recurses per nesting level instead of
    // iterating IS the risk). 2000 levels is deep enough to blow a naive
    // recursive-descent stack while staying fast to generate/parse when the
    // parser is well-behaved.
    const depth = 2000;
    let nested = "";
    for (let i = 0; i < depth; i += 1) nested += "[";
    nested += "1";
    for (let i = 0; i < depth; i += 1) nested += "]";
    writeGovernanceYaml(repoRoot, `schema_version: 1\nunknown_deeply_nested_field: ${nested}\n`);
    expect(() => loadGovernanceConfig(repoRoot)).toThrow(/Invalid \.rvs\/governance\.yml/);
  });
});
