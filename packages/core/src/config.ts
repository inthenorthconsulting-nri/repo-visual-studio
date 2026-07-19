import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { workspaceSourcePatterns, type WorkspaceDetection } from "./workspace.js";

// Single source of truth for the single-package default — also referenced
// by defaultConfig() below when layering in workspace-detected patterns,
// so the two never drift apart.
// Manifest and source patterns are "**/"-prefixed so they match at any
// depth (fast-glob treats a bare "package.json" as root-only, which would
// silently hide every nested workspace/module manifest in a monorepo).
// "**/" also matches a zero-segment prefix, so these still cover the
// repo-root file too — no separate root-only entry is needed.
// pnpm-workspace.yaml is deliberately left root-only: it is only ever
// meaningful at the repo root by pnpm's own convention.
const DEFAULT_INCLUDE = [
  "README.md",
  "docs/**",
  "**/src/**",
  ".github/workflows/**",
  "**/package.json",
  "pnpm-workspace.yaml",
  "**/pyproject.toml",
  "**/requirements.txt",
  "**/go.mod",
  "**/Cargo.toml",
  "**/pom.xml",
  "**/build.gradle",
  "**/Gemfile",
];
// Secret-bearing paths are excluded unconditionally, including .env.* —
// which also matches .env.example. That's a deliberate choice, not an
// oversight: a repo-specific config can re-include .env.example via
// sources.include if it's genuinely useful evidence there, but the
// out-of-the-box default must never risk treating a same-named real
// secrets file as safe because its sibling .env.example looked benign.
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  ".git/**",
  "**/*.lock",
  "**/*.secret",
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  ".aws/credentials",
  ".rvs/cache/**",
  "artifacts/**",
];

export const RvsConfigSchema = z.object({
  version: z.literal(1),
  project: z.object({
    name: z.string(),
    owner: z.string().optional(),
  }),
  sources: z.object({
    include: z.array(z.string()).default(DEFAULT_INCLUDE),
    exclude: z.array(z.string()).default(DEFAULT_EXCLUDE),
  }),
  security: z.object({
    redact_patterns: z.boolean().default(true),
    allow_external_upload: z.boolean().default(false),
  }),
  defaults: z.object({
    audience: z.enum(["executive", "architecture-review"]).default("executive"),
    design_system: z
      .enum(["executive-dark", "editorial-light", "technical-grid"])
      .default("executive-dark"),
    output_dir: z.string().default("artifacts/visuals"),
  }),
  quality: z.object({
    fail_on_overflow: z.boolean().default(true),
    fail_on_missing_evidence: z.boolean().default(true),
    minimum_contrast: z.enum(["AA", "AAA"]).default("AA"),
  }),
});

export type RvsConfig = z.infer<typeof RvsConfigSchema>;

export const CONFIG_RELATIVE_PATH = ".rvs/config.yml";

// `workspace` is optional so every existing call site (all current tests,
// plus any future single-package caller) keeps producing the exact same
// output as before — the workspace-aware behavior only activates when a
// caller (currently just `rvs init`) explicitly passes a detection result.
export function defaultConfig(projectName: string, workspace?: WorkspaceDetection): RvsConfig {
  const extra = workspace ? workspaceSourcePatterns(workspace) : { include: [], exclude: [] };
  return RvsConfigSchema.parse({
    version: 1,
    project: { name: projectName },
    sources: {
      include: [...DEFAULT_INCLUDE, ...extra.include],
      exclude: [...DEFAULT_EXCLUDE, ...extra.exclude],
    },
    security: {},
    defaults: {},
    quality: {},
  });
}

export function configPath(repoRoot: string): string {
  return resolve(repoRoot, CONFIG_RELATIVE_PATH);
}

export function loadConfig(repoRoot: string): RvsConfig {
  const path = configPath(repoRoot);
  if (!existsSync(path)) {
    throw new Error(
      `No .rvs/config.yml found at ${path}. Run \`rvs init\` first.`,
    );
  }
  const raw = parseYaml(readFileSync(path, "utf8"));
  return RvsConfigSchema.parse(raw);
}

export function serializeConfig(config: RvsConfig): string {
  return stringifyYaml(config, { indent: 2 });
}
