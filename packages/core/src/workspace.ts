import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface WorkspaceDetection {
  kind: "pnpm" | "npm" | "yarn" | "single-package";
  marker: string | null;
  packageGlobs: string[];
}

// Detects the three common JS/TS monorepo conventions without touching
// node_modules: a pnpm-workspace.yaml file, or a package.json "workspaces"
// field (the same field shape for both npm and Yarn — which lockfile is
// present only tells you which installer runs, not the glob semantics).
export function detectWorkspace(repoRoot: string): WorkspaceDetection {
  const pnpmWorkspacePath = resolve(repoRoot, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    try {
      const doc = parseYaml(readFileSync(pnpmWorkspacePath, "utf8")) as { packages?: string[] } | null;
      const packageGlobs = doc?.packages?.filter((g) => !g.startsWith("!")) ?? [];
      return { kind: "pnpm", marker: "pnpm-workspace.yaml", packageGlobs: packageGlobs.length ? packageGlobs : ["packages/*"] };
    } catch {
      return { kind: "pnpm", marker: "pnpm-workspace.yaml", packageGlobs: ["packages/*"] };
    }
  }

  const pkgJsonPath = resolve(repoRoot, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const raw = pkg.workspaces;
      const packageGlobs = (Array.isArray(raw) ? raw : raw?.packages ?? []).filter((g) => !g.startsWith("!"));
      if (packageGlobs.length > 0) {
        const kind = existsSync(resolve(repoRoot, "yarn.lock")) ? "yarn" : "npm";
        return { kind, marker: "package.json (workspaces field)", packageGlobs };
      }
    } catch {
      // Malformed package.json — fall through to single-package rather than throwing during init.
    }
  }

  return { kind: "single-package", marker: null, packageGlobs: [] };
}

// Turns workspace package globs ("packages/*", "apps/**") into repository-model
// source include patterns. A glob's trailing "/*" or "/**" is stripped to get
// the base directory, then re-expanded as "<base>/*/package.json" and
// "<base>/*/src/**" — the two things repository-model actually needs to see
// inside each workspace package.
export function workspaceSourcePatterns(detection: WorkspaceDetection): { include: string[]; exclude: string[] } {
  if (detection.kind === "single-package") return { include: [], exclude: [] };

  const include: string[] = [];
  for (const glob of detection.packageGlobs) {
    const base = glob.replace(/\/\*+$/, "");
    include.push(`${base}/*/package.json`, `${base}/*/src/**`);
  }
  return { include, exclude: ["**/node_modules/**", "**/dist/**"] };
}
