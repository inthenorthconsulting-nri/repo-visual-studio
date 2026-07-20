import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DECISIONS_CONFIG_RELATIVE_PATH, decisionsConfigPath, loadDecisionsConfig } from "../decisions-config.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "decisions-config-test-"));
  mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeDecisionsYaml(content: string): void {
  writeFileSync(join(repoRoot, ".rvs", "decisions.yml"), content, "utf8");
}

describe("decisionsConfigPath / DECISIONS_CONFIG_RELATIVE_PATH", () => {
  it("resolves to .rvs/decisions.yml under repoRoot", () => {
    expect(DECISIONS_CONFIG_RELATIVE_PATH).toBe(".rvs/decisions.yml");
    expect(decisionsConfigPath(repoRoot)).toBe(resolve(repoRoot, ".rvs/decisions.yml"));
  });
});

describe("loadDecisionsConfig: optional-file semantics", () => {
  it("returns undefined when .rvs/decisions.yml does not exist", () => {
    expect(loadDecisionsConfig(repoRoot)).toBeUndefined();
  });

  it("returns undefined when the .rvs directory itself does not exist", () => {
    rmSync(join(repoRoot, ".rvs"), { recursive: true, force: true });
    expect(loadDecisionsConfig(repoRoot)).toBeUndefined();
  });
});

describe("loadDecisionsConfig: valid configs", () => {
  it("loads a minimal config with only schema_version and one source", () => {
    writeDecisionsYaml(["schema_version: 1", "sources:", "  - path: docs/adr", "    type: adr"].join("\n"));
    const config = loadDecisionsConfig(repoRoot);
    expect(config).toEqual({ schema_version: 1, sources: [{ path: "docs/adr", type: "adr" }] });
  });

  it("loads a full config with include, status_mapping, and identity.prefer", () => {
    writeDecisionsYaml(
      [
        "schema_version: 1",
        "sources:",
        "  - path: docs/adr",
        "    type: adr",
        "    include:",
        "      - '**/*.md'",
        "  - path: docs/rfc",
        "    type: rfc",
        "status_mapping:",
        "  accepted:",
        "    - shipped",
        "identity:",
        "  prefer:",
        "    - frontmatter.id",
        "    - path",
      ].join("\n"),
    );
    const config = loadDecisionsConfig(repoRoot);
    expect(config).toEqual({
      schema_version: 1,
      sources: [
        { path: "docs/adr", type: "adr", include: ["**/*.md"] },
        { path: "docs/rfc", type: "rfc" },
      ],
      status_mapping: { accepted: ["shipped"] },
      identity: { prefer: ["frontmatter.id", "path"] },
    });
  });

  it("accepts every recognized source type", () => {
    for (const type of ["adr", "rfc", "design_decision", "decision_log"]) {
      writeDecisionsYaml(["schema_version: 1", "sources:", "  - path: docs", `    type: ${type}`].join("\n"));
      expect(loadDecisionsConfig(repoRoot)?.sources[0].type).toBe(type);
    }
  });

  it("accepts every recognized identity.prefer strategy value", () => {
    writeDecisionsYaml(
      [
        "schema_version: 1",
        "sources:",
        "  - path: docs",
        "    type: adr",
        "identity:",
        "  prefer: [configured_id, frontmatter.id, filename, path, content_digest]",
      ].join("\n"),
    );
    expect(loadDecisionsConfig(repoRoot)?.identity?.prefer).toEqual(["configured_id", "frontmatter.id", "filename", "path", "content_digest"]);
  });
});

describe("loadDecisionsConfig: schema validation failures", () => {
  it("throws a clear error for malformed YAML", () => {
    writeDecisionsYaml("schema_version: 1\nsources: [this is not: valid: yaml structure\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/not valid YAML/);
  });

  it("throws a clear, single-sentence-prefixed error when schema_version is missing", () => {
    writeDecisionsYaml("sources:\n  - path: docs\n    type: adr\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/Invalid \.rvs\/decisions\.yml/);
  });

  it("throws when schema_version is not 1", () => {
    writeDecisionsYaml("schema_version: 2\nsources:\n  - path: docs\n    type: adr\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws when sources is missing", () => {
    writeDecisionsYaml("schema_version: 1\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws when sources is an empty array (min 1)", () => {
    writeDecisionsYaml("schema_version: 1\nsources: []\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws for an unrecognized source type", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: made_up_type\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/sources/);
  });

  it("throws for an empty source path", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: ''\n    type: adr\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws on an unknown top-level field (strict schema)", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: adr\nunknown_field: true\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws on an unknown field within a source entry (strict per-source schema)", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: adr\n    extra_field: true\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws on an unknown field within identity (strict identity schema)", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: adr\nidentity:\n  unknown: true\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("throws for an unrecognized identity.prefer strategy value", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: adr\nidentity:\n  prefer: [not_a_real_strategy]\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/identity\.prefer/);
  });

  it("throws when a status_mapping value is not an array of non-empty strings", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs\n    type: adr\nstatus_mapping:\n  accepted:\n    - ''\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow();
  });

  it("collapses multiple validation issues into one flat-sentence error rather than a raw multi-line dump", () => {
    writeDecisionsYaml("schema_version: 2\nsources: []\n");
    try {
      loadDecisionsConfig(repoRoot);
      expect.unreachable("expected loadDecisionsConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message.split("\n")).toHaveLength(1);
      expect(message).toContain("schema_version");
      expect(message).toContain("sources");
    }
  });
});

// ---------------------------------------------------------------------------
// Untrusted-input / security coverage: decisionsConfigPath always resolves
// `.rvs/decisions.yml` as a fixed relative path under repoRoot -- there is no
// config-controlled or attacker-influenced path segment for
// loadDecisionsConfig to combine, so path-traversal and symlink-escape
// adversarial cases (which apply to discovery.ts's config-driven source.path
// resolution) have no analogous surface here. The untrusted surface is the
// YAML *content*, covered below.
// ---------------------------------------------------------------------------

describe("loadDecisionsConfig: untrusted YAML content", () => {
  it("rejects duplicate keys as malformed YAML (the yaml parser enforces unique map keys by default)", () => {
    writeDecisionsYaml("schema_version: 1\nschema_version: 1\nsources:\n  - path: docs\n    type: adr\n");
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/not valid YAML/);
  });

  it("resolves YAML anchors/aliases as plain inert data, never executing anything", () => {
    writeDecisionsYaml(["schema_version: 1", "sources:", "  - path: &p docs/adr", "    type: adr", "    include:", "      - *p"].join("\n"));
    const config = loadDecisionsConfig(repoRoot);
    expect(config?.sources[0].path).toBe("docs/adr");
    expect(config?.sources[0].include).toEqual(["docs/adr"]);
  });

  it("parses deeply nested YAML without hanging or crashing, then cleanly rejects the unrecognized shape via the strict schema", () => {
    const depth = 2000;
    const nested = "[".repeat(depth) + "1" + "]".repeat(depth);
    writeDecisionsYaml(`schema_version: 1\nsources:\n  - path: docs\n    type: adr\nunknown_deeply_nested_field: ${nested}\n`);
    expect(() => loadDecisionsConfig(repoRoot)).toThrow(/Invalid \.rvs\/decisions\.yml|not valid YAML/);
  });

  it("parses an oversized sources list without crashing (no size guard -- documenting actual behavior)", () => {
    const sources = Array.from({ length: 500 }, (_, i) => `  - path: docs/adr-${i}\n    type: adr`).join("\n");
    writeDecisionsYaml(`schema_version: 1\nsources:\n${sources}\n`);
    const config = loadDecisionsConfig(repoRoot);
    expect(config?.sources).toHaveLength(500);
  });

  it("round-trips a source path containing multi-byte unicode characters", () => {
    writeDecisionsYaml("schema_version: 1\nsources:\n  - path: docs/日本語\n    type: adr\n");
    const config = loadDecisionsConfig(repoRoot);
    expect(config?.sources[0].path).toBe("docs/日本語");
  });
});
