import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KNOWLEDGE_GRAPH_CACHE_DIR, KNOWLEDGE_GRAPH_OUTPUT_FILES } from "@rvs/knowledge-graph";

// Knowledge-graph output is namespaced under .rvs/cache/knowledge-graph/,
// mirroring decision-cache.ts's/governance-cache.ts's per-domain
// subdirectory precedent rather than the flat .rvs/cache/ root cache.ts's
// helpers use.

export function graphCacheDir(repoRoot: string): string {
  return resolve(repoRoot, KNOWLEDGE_GRAPH_CACHE_DIR);
}

export function graphOutputPath(repoRoot: string, file: string): string {
  return resolve(graphCacheDir(repoRoot), file);
}

export function readGraphCachedJson<T>(repoRoot: string, file: string): T {
  const path = graphOutputPath(repoRoot, file);
  if (!existsSync(path)) {
    throw new Error(`Missing .rvs/cache/knowledge-graph/${file}. Run \`rvs graph build\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readGraphCachedJsonOptional<T>(repoRoot: string, file: string): T | undefined {
  const path = graphOutputPath(repoRoot, file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes every present (non-undefined) key of `outputs` to its corresponding KNOWLEDGE_GRAPH_OUTPUT_FILES filename under .rvs/cache/knowledge-graph/. */
export function writeGraphOutputs(repoRoot: string, outputs: Partial<Record<keyof typeof KNOWLEDGE_GRAPH_OUTPUT_FILES, unknown>>): void {
  mkdirSync(graphCacheDir(repoRoot), { recursive: true });
  for (const [key, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    const file = KNOWLEDGE_GRAPH_OUTPUT_FILES[key as keyof typeof KNOWLEDGE_GRAPH_OUTPUT_FILES];
    writeFileSync(graphOutputPath(repoRoot, file), JSON.stringify(value, null, 2));
  }
}
