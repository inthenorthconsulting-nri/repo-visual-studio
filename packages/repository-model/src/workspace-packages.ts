import { MANIFEST_DETECTORS } from "./tech-stack.js";
import type { FileInventory } from "./scan.js";
import { readTextFile } from "./scan.js";

/**
 * A directory anywhere in the repository (including the repo root) that
 * contains its own package manifest — the same generic, ecosystem-standard
 * signal (npm/pnpm/yarn `package.json`, Python `pyproject.toml`, Go
 * `go.mod`, Rust `Cargo.toml`, Java `pom.xml`/`build.gradle`, Ruby
 * `Gemfile`) that every workspace/monorepo tool already uses to define a
 * "package". Nothing here is specific to any one repository.
 */
export interface WorkspacePackage {
  /** Repo-relative directory path, "" for the repo root itself. */
  path: string;
  manifestFile: string;
  name?: string;
  description?: string;
  /** True when a package.json declares a non-empty "bin" field. */
  hasBinEntry: boolean;
  /** Repo-relative file paths resolved from package.json's "bin" field, if any. */
  binPaths: string[];
  /** Combined dependencies + devDependencies keys, for package.json manifests only. */
  dependencyNames: string[];
  /** True when package.json declares "main", "module", or "exports". */
  hasLibraryExport: boolean;
}

const MANIFEST_FILENAMES = new Set(MANIFEST_DETECTORS.map((d) => d.file));

interface ParsedPackageJson {
  name?: string;
  description?: string;
  bin?: string | Record<string, string>;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function joinRepoPath(dir: string, relative: string): string {
  const cleaned = relative.replace(/^\.\//, "");
  return dir ? `${dir}/${cleaned}` : cleaned;
}

function readPackageJson(repoRoot: string, dir: string, manifestPath: string): WorkspacePackage {
  try {
    const parsed = JSON.parse(readTextFile(repoRoot, manifestPath)) as ParsedPackageJson;
    const binPaths: string[] = [];
    if (typeof parsed.bin === "string" && parsed.bin.trim().length > 0) {
      binPaths.push(joinRepoPath(dir, parsed.bin));
    } else if (parsed.bin && typeof parsed.bin === "object") {
      for (const value of Object.values(parsed.bin)) {
        if (typeof value === "string" && value.trim().length > 0) binPaths.push(joinRepoPath(dir, value));
      }
    }
    const dependencyNames = [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
    return {
      path: dir,
      manifestFile: "package.json",
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined,
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : undefined,
      hasBinEntry: binPaths.length > 0,
      binPaths: binPaths.sort(),
      dependencyNames,
      hasLibraryExport: Boolean(parsed.main || parsed.module || parsed.exports),
    };
  } catch {
    // Malformed package.json — still a real package root (directory + manifest evidence), just without content-derived classification signals.
    return { path: dir, manifestFile: "package.json", hasBinEntry: false, binPaths: [], dependencyNames: [], hasLibraryExport: false };
  }
}

// Cheap, regex-based best-effort name extraction for non-JSON manifests —
// intentionally not a full TOML/Gradle parser; only the package's declared
// name is worth extracting here, and every consumer must tolerate `name`
// being absent.
function bestEffortName(repoRoot: string, dir: string, manifestFile: string, manifestPath: string): string | undefined {
  try {
    const contents = readTextFile(repoRoot, manifestPath);
    if (manifestFile === "go.mod") {
      const match = contents.match(/^module\s+(\S+)/m);
      return match ? match[1].split("/").pop() : undefined;
    }
    if (manifestFile === "Cargo.toml" || manifestFile === "pyproject.toml") {
      const match = contents.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      return match ? match[1] : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detects every workspace package root in the repository — any directory
 * containing its own manifest, at any depth — using the FULL, untruncated
 * file inventory (mirrors detectTechStack's already-established pattern of
 * reading full inventory + manifest content before RepositoryModel caps
 * anything for downstream consumers). This is what lets a monorepo's
 * individual packages be recognized as distinct components instead of
 * collapsing into one coarse top-level directory bucket.
 */
export function detectWorkspacePackages(repoRoot: string, inventory: FileInventory): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seenDirs = new Set<string>();
  let rootManifest: { base: string; path: string } | undefined;
  for (const file of inventory.files) {
    const base = file.path.includes("/") ? file.path.slice(file.path.lastIndexOf("/") + 1) : file.path;
    if (!MANIFEST_FILENAMES.has(base) || base === "pnpm-workspace.yaml") continue;
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    if (dir === "") {
      // Deferred, not skipped: a monorepo's root manifest (this repo's own
      // shape) stays represented via tech_stack only, so per-package
      // granularity is never diluted by a coarse root entry — see the
      // packages.length check below, which only promotes the root manifest
      // when there is no nested package to prefer over it.
      if (!rootManifest) rootManifest = { base, path: file.path };
      continue;
    }
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    if (base === "package.json") {
      packages.push(readPackageJson(repoRoot, dir, file.path));
    } else {
      packages.push({ path: dir, manifestFile: base, name: bestEffortName(repoRoot, dir, base, file.path), hasBinEntry: false, binPaths: [], dependencyNames: [], hasLibraryExport: false });
    }
  }

  // A single-package repository (no nested workspace packages) still has
  // real package-defining evidence at its own root — most commonly a CLI's
  // package.json with a "bin" field living directly at the repo root, the
  // single most common real-world Node CLI shape. Without this, that
  // evidence was invisible to every downstream consumer that reads
  // workspace_packages (component classification, capability candidates,
  // archetype detection).
  if (packages.length === 0 && rootManifest) {
    packages.push(
      rootManifest.base === "package.json"
        ? readPackageJson(repoRoot, "", rootManifest.path)
        : {
            path: "",
            manifestFile: rootManifest.base,
            name: bestEffortName(repoRoot, "", rootManifest.base, rootManifest.path),
            hasBinEntry: false,
            binPaths: [],
            dependencyNames: [],
            hasLibraryExport: false,
          },
    );
  }

  return packages.sort((a, b) => a.path.localeCompare(b.path));
}
