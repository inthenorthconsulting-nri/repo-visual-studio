import { readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import fg from "fast-glob";

export interface ScannedFile {
  path: string; // repo-relative, posix separators
  extension: string;
  bytes: number;
}

export interface FileInventory {
  total: number;
  byExtension: Record<string, number>;
  files: ScannedFile[];
}

export async function scanFiles(
  repoRoot: string,
  include: string[],
  exclude: string[],
): Promise<FileInventory> {
  const matches = await fg(include, {
    cwd: repoRoot,
    ignore: exclude,
    onlyFiles: true,
    dot: false,
    unique: true,
  });

  const files: ScannedFile[] = matches
    .sort()
    .map((relPath) => {
      const absPath = join(repoRoot, relPath);
      const bytes = statSync(absPath).size;
      return {
        path: relative(repoRoot, absPath).split("\\").join("/"),
        extension: extname(relPath).toLowerCase(),
        bytes,
      };
    });

  const byExtension: Record<string, number> = {};
  for (const file of files) {
    const key = file.extension || "(none)";
    byExtension[key] = (byExtension[key] ?? 0) + 1;
  }

  return { total: files.length, byExtension, files };
}

export function readTextFile(repoRoot: string, relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}
