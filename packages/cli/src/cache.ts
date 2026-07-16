import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function cacheDir(repoRoot: string): string {
  return resolve(repoRoot, ".rvs/cache");
}

export function readCachedJson<T>(repoRoot: string, file: string): T {
  const path = resolve(cacheDir(repoRoot), file);
  if (!existsSync(path)) {
    throw new Error(`Missing .rvs/cache/${file}. Run \`rvs inspect\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readCachedJsonOptional<T>(repoRoot: string, file: string): T | undefined {
  const path = resolve(cacheDir(repoRoot), file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
