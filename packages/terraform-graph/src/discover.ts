import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import fg from "fast-glob";
import { parseTerraformFile } from "./hcl-bridge.js";

const DEFAULT_INCLUDE = ["**/*.tf"];

// Always excluded regardless of user config — generated/cache directories
// and Terraform state/plan artifacts are never parsed (spec section 8/16).
export const ALWAYS_EXCLUDE = [
  "**/.terraform/**",
  ".terraform/**",
  "**/node_modules/**",
  "**/dist/**",
  ".rvs/cache/**",
  "artifacts/**",
];

// Discovery only ever looks at checked-in `.tf` files under the repo root —
// no `terraform init`, no state inspection, no network access.
export async function discoverTerraformFiles(
  repoRoot: string,
  include: string[] = DEFAULT_INCLUDE,
  exclude: string[] = [],
): Promise<string[]> {
  const matches = await fg(include, {
    cwd: repoRoot,
    onlyFiles: true,
    unique: true,
    ignore: [...ALWAYS_EXCLUDE, ...exclude],
  });
  return matches.sort().map((relPath) => relPath.split("\\").join("/"));
}

export interface TerraformDirectory {
  relDir: string; // repo-relative, "" for repo root itself
  files: string[]; // repo-relative .tf file paths directly inside relDir
}

// Groups discovered `.tf` files by their containing directory — each such
// directory is a "candidate module" (spec section 8). Root-vs-child
// classification happens later, once module blocks have been parsed.
export function groupIntoDirectories(files: string[]): TerraformDirectory[] {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const dir = dirname(file);
    const relDir = dir === "." ? "" : dir;
    const list = byDir.get(relDir) ?? [];
    list.push(file);
    byDir.set(relDir, list);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relDir, dirFiles]) => ({ relDir, files: dirFiles.sort() }));
}

// Resolves a local module `source` (e.g. "./modules/network",
// "../shared/network") against the directory that declared it, returning a
// repo-relative directory path with no leading "./" and no ".." segments
// remaining unresolved.
export function resolveLocalModuleSource(repoRoot: string, declaringDir: string, source: string): string {
  const absDeclaring = join(repoRoot, declaringDir);
  const absTarget = join(absDeclaring, source);
  const rel = relative(repoRoot, absTarget);
  return rel.split("\\").join("/");
}

export function isLocalModuleSource(source: string): boolean {
  return source.startsWith("./") || source.startsWith("../");
}

function unwrapLiteral(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\$\{([\s\S]*)\}$/.exec(value);
  return m ? m[1] : value;
}

// Spec section 8: a directory with `.tf` files is a candidate module; one
// referenced as a local `source` by another candidate module is a child,
// everything else is a root candidate. This is a lightweight pre-pass (it
// re-parses module blocks only) run before the full declare/link topology
// build, so root/child classification doesn't depend on which directory
// happens to be built first.
export async function classifyRootModules(repoRoot: string, directories: TerraformDirectory[]): Promise<{ roots: TerraformDirectory[]; referenced: Set<string> }> {
  const referenced = new Set<string>();
  for (const dir of directories) {
    for (const file of dir.files) {
      const text = await readFile(join(repoRoot, file), "utf8");
      let json: Record<string, unknown>;
      try {
        json = (await parseTerraformFile(file, text)).json;
      } catch {
        continue; // parse errors are reported later, during the real build
      }
      const moduleBlocks = (json.module as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
      for (const occurrences of Object.values(moduleBlocks)) {
        for (const body of occurrences) {
          const source = unwrapLiteral(body.source);
          if (source && isLocalModuleSource(source)) {
            referenced.add(resolveLocalModuleSource(repoRoot, dir.relDir, source));
          }
        }
      }
    }
  }
  const roots = directories.filter((d) => !referenced.has(d.relDir));
  return { roots, referenced };
}
