// CLI-layer fs I/O counterpart to @rvs/change-workbench's persistence.ts,
// which deliberately never touches the filesystem itself -- exactly
// mirroring graph-cache.ts's/decision-cache.ts's relationship to their own
// domain packages. Only ever invoked when a caller explicitly opts in
// (`rvs change evaluate --cache`); default `rvs change evaluate` never
// writes here (§16).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildChangeAdvisoryCachePath, CHANGE_WORKBENCH_ADVISORIES_DIR } from "@rvs/change-workbench";
import type { StoredChangeAdvisory } from "@rvs/change-workbench";

/**
 * Duplicated locally rather than imported -- persistence.ts's own copy is
 * private, and this repo's established convention (see
 * change-workbench/src/ids.ts's own comment) is to duplicate small
 * deterministic path/id utilities per package rather than cross-import
 * them.
 */
function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

/** Persists a StoredChangeAdvisory at its conventional path and returns the absolute path written. */
export function writeStoredChangeAdvisory(repoRoot: string, stored: StoredChangeAdvisory): string {
  const relativePath = buildChangeAdvisoryCachePath(stored.advisory.repository_id, stored.advisory.id);
  const path = resolve(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(stored, null, 2));
  return path;
}

/**
 * `rvs change explain <advisory-id>` retrieval path. Advisory ids are
 * globally unique content digests, but their storage path is namespaced by
 * repository_id (not derivable from just an advisory id), so this scans
 * every repository-id subdirectory under
 * .rvs/cache/change-workbench/advisories/ for a file named after the
 * (sanitized) advisory id -- the smallest coherent retrieval design that
 * needs no new `--repository-id` flag.
 */
export function findStoredChangeAdvisoryById(repoRoot: string, advisoryId: string): StoredChangeAdvisory | undefined {
  const advisoriesDir = resolve(repoRoot, CHANGE_WORKBENCH_ADVISORIES_DIR);
  if (!existsSync(advisoriesDir)) return undefined;

  const fileName = `${sanitizePathSegment(advisoryId)}.json`;

  for (const entry of readdirSync(advisoriesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = resolve(advisoriesDir, entry.name, fileName);
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")) as StoredChangeAdvisory;
    }
  }
  return undefined;
}
