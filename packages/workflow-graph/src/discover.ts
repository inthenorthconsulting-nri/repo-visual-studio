import { join } from "node:path";
import fg from "fast-glob";

const DEFAULT_PATTERNS = [".github/workflows/*.yml", ".github/workflows/*.yaml"];

// Discovery only ever looks at checked-in files under the repo root — no
// GitHub API calls, no network access.
export async function discoverWorkflowFiles(
  repoRoot: string,
  patterns: string[] = DEFAULT_PATTERNS,
): Promise<string[]> {
  const matches = await fg(patterns, {
    cwd: repoRoot,
    onlyFiles: true,
    unique: true,
  });
  return matches.sort().map((relPath) => relPath.split("\\").join("/"));
}

export function resolveWorkflowPath(repoRoot: string, relPath: string): string {
  return join(repoRoot, relPath);
}
