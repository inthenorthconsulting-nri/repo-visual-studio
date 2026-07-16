import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  CONFIG_RELATIVE_PATH,
  configPath,
  defaultConfig,
  detectWorkspace,
  serializeConfig,
  workspaceSourcePatterns,
  type Logger,
} from "@rvs/core";

export function runInit(repoRoot: string, logger: Logger): void {
  const path = configPath(repoRoot);
  if (existsSync(path)) {
    logger.warn(`${CONFIG_RELATIVE_PATH} already exists — leaving it untouched.`);
    return;
  }

  let projectName = basename(repoRoot);
  const pkgJsonPath = resolve(repoRoot, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: string };
      if (pkg.name) projectName = pkg.name;
    } catch {
      // fall back to directory name
    }
  }

  const workspace = detectWorkspace(repoRoot);
  const config = defaultConfig(projectName, workspace);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeConfig(config));
  logger.info(`Wrote ${CONFIG_RELATIVE_PATH}`);

  if (workspace.kind === "single-package") {
    logger.info("No workspace manifest detected — using the concise single-package source list.");
  } else {
    const { include } = workspaceSourcePatterns(workspace);
    logger.info(
      `Detected a ${workspace.kind} workspace via ${workspace.marker} (package globs: ${workspace.packageGlobs.join(", ")}).`,
    );
    logger.info(
      `Added ${include.join(", ")} to sources.include and broadened excludes to **/node_modules/** and **/dist/** so nested workspace packages are scanned without nested node_modules or build output.`,
    );
  }
}
