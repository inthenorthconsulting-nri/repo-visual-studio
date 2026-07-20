import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DECISION_CACHE_DIR, DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";

// Decision output is namespaced under .rvs/cache/decisions/, mirroring
// governance-cache.ts's precedent of a per-domain subdirectory rather than
// the flat .rvs/cache/ root cache.ts's helpers use.

export function decisionCacheDir(repoRoot: string): string {
  return resolve(repoRoot, DECISION_CACHE_DIR);
}

export function decisionOutputPath(repoRoot: string, file: string): string {
  return resolve(decisionCacheDir(repoRoot), file);
}

export function readDecisionCachedJson<T>(repoRoot: string, file: string): T {
  const path = decisionOutputPath(repoRoot, file);
  if (!existsSync(path)) {
    throw new Error(`Missing .rvs/cache/decisions/${file}. Run \`rvs decisions analyze\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readDecisionCachedJsonOptional<T>(repoRoot: string, file: string): T | undefined {
  const path = decisionOutputPath(repoRoot, file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes every present (non-undefined) key of `outputs` to its corresponding DECISION_OUTPUT_FILES filename under .rvs/cache/decisions/. */
export function writeDecisionOutputs(repoRoot: string, outputs: Partial<Record<keyof typeof DECISION_OUTPUT_FILES, unknown>>): void {
  mkdirSync(decisionCacheDir(repoRoot), { recursive: true });
  for (const [key, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    const file = DECISION_OUTPUT_FILES[key as keyof typeof DECISION_OUTPUT_FILES];
    writeFileSync(decisionOutputPath(repoRoot, file), JSON.stringify(value, null, 2));
  }
}
