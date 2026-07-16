import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { configPath, type Logger } from "@rvs/core";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { WORKFLOW_GRAPH_SCHEMA_VERSION } from "@rvs/workflow-graph";
import { chromium } from "playwright";
import { DESIGN_SYSTEMS_ROOT, RVS_ASSETS_ROOT, RVS_INSTALL_ROOT, SCHEMAS_ROOT, SKILLS_ROOT } from "../paths.js";
import { CLI_VERSION } from "../version.js";

// VisualDocSchema.shape.version is a z.literal(N) — this reads the literal
// out instead of hardcoding a second copy of the number here.
const VISUALDOC_SCHEMA_VERSION = VisualDocSchema.shape.version.value;

// Walks up from cwd looking for a .git directory, so doctor can report a
// repository root even when invoked from a subdirectory. Returns null
// outside any repository rather than throwing — doctor must never fail
// just because it was run somewhere that isn't a git repo.
function findRepoRoot(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Distinguishes a monorepo dev checkout (tsx running src/bin.ts, assets
// resolved via the monorepo fallback) from a real packaged install (assets
// copied alongside dist/bin.cjs by build.mjs) — useful context for anyone
// debugging asset-resolution issues from doctor output alone.
function installType(): "packaged" | "workspace-source" {
  return existsSync(resolve(RVS_INSTALL_ROOT, "assets")) ? "packaged" : "workspace-source";
}

// Same isomorphic-probe trick as moduleDir() (module-dir.ts): the bundled
// CJS output (dist/bin.cjs) has a native `require` in scope; dev (tsx
// running src/bin.ts as real ESM, no __dirname/require shims here) falls
// back to createRequire(import.meta.url) instead.
function isomorphicRequire(importMetaUrl: string): NodeRequire {
  // eslint-disable-next-line no-undef
  return typeof require !== "undefined" ? require : createRequire(importMetaUrl);
}

export async function runDoctor(repoRoot: string, logger: Logger): Promise<void> {
  logger.info(`rvs ${CLI_VERSION}`);
  logger.info(`Node ${process.version} (${os.platform()}/${os.arch()})`);
  logger.info(`Installation type: ${installType()}`);
  logger.info(`CLI executable: ${process.argv[1] ?? "(unknown)"}`);
  logger.info(`Package root: ${RVS_INSTALL_ROOT}`);
  logger.info(`Asset path: ${RVS_ASSETS_ROOT}`);
  logger.info(
    existsSync(DESIGN_SYSTEMS_ROOT)
      ? `Design systems found at ${DESIGN_SYSTEMS_ROOT}`
      : `Design systems NOT found (expected ${DESIGN_SYSTEMS_ROOT})`,
  );
  logger.info(
    existsSync(SCHEMAS_ROOT)
      ? `Schemas found at ${SCHEMAS_ROOT}`
      : `Schemas NOT found (expected ${SCHEMAS_ROOT})`,
  );
  logger.info(
    existsSync(SKILLS_ROOT)
      ? `Agent skill found at ${SKILLS_ROOT}`
      : `Agent skill NOT found (expected ${SKILLS_ROOT})`,
  );
  logger.info(`VisualDoc schema version: ${VISUALDOC_SCHEMA_VERSION}`);
  logger.info(`WorkflowGraph schema version: ${WORKFLOW_GRAPH_SCHEMA_VERSION}`);
  logger.info(`Current working directory: ${repoRoot}`);

  const gitRoot = findRepoRoot(repoRoot);
  logger.info(gitRoot ? `Repository root: ${gitRoot}` : "Repository root: not inside a git repository");

  logger.info(
    existsSync(configPath(repoRoot))
      ? ".rvs/config.yml found"
      : ".rvs/config.yml missing — run `rvs init`",
  );

  try {
    const playwrightVersion = (
      isomorphicRequire(import.meta.url)("playwright/package.json") as { version: string }
    ).version;
    logger.info(`Playwright package: available (v${playwrightVersion})`);
  } catch {
    logger.error("Playwright package is not installed — Chromium checks below will fail.");
  }

  try {
    const browser = await chromium.launch();
    await browser.close();
    logger.info("Playwright Chromium launches successfully.");
  } catch (err) {
    logger.error("Playwright Chromium is not available. Run: npx playwright install chromium");
    logger.debug(err instanceof Error ? err.message : String(err));
  }
}
