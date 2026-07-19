import type { FileInventory } from "./scan.js";
import { readTextFile } from "./scan.js";

export interface TechStack {
  primaryLanguage: string;
  languages: string[];
  packageManagers: string[];
  frameworks: string[];
  manifestFile?: string;
  /** The package manifest's own short description field (e.g. package.json "description"), when present and non-empty. Evidence for system-identity fallback — not a generated summary. */
  manifestDescription?: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".swift": "Swift",
  ".kt": "Kotlin",
};

export const MANIFEST_DETECTORS: { file: string; packageManager: string; language: string }[] = [
  { file: "package.json", packageManager: "npm/pnpm/yarn", language: "JavaScript/TypeScript" },
  { file: "pnpm-workspace.yaml", packageManager: "pnpm", language: "JavaScript/TypeScript" },
  { file: "pyproject.toml", packageManager: "pip/poetry", language: "Python" },
  { file: "requirements.txt", packageManager: "pip", language: "Python" },
  { file: "go.mod", packageManager: "go modules", language: "Go" },
  { file: "Cargo.toml", packageManager: "cargo", language: "Rust" },
  { file: "pom.xml", packageManager: "maven", language: "Java" },
  { file: "build.gradle", packageManager: "gradle", language: "Java/Kotlin" },
  { file: "Gemfile", packageManager: "bundler", language: "Ruby" },
];

const FRAMEWORK_KEYWORDS = [
  "react",
  "vue",
  "svelte",
  "next",
  "nuxt",
  "express",
  "fastify",
  "commander",
  "vitest",
  "jest",
  "playwright",
  "zod",
  "django",
  "flask",
  "fastapi",
];

export function detectTechStack(repoRoot: string, inventory: FileInventory): TechStack {
  const extensionCounts = new Map<string, number>();
  for (const file of inventory.files) {
    const language = LANGUAGE_BY_EXTENSION[file.extension];
    if (language) {
      extensionCounts.set(language, (extensionCounts.get(language) ?? 0) + 1);
    }
  }

  const languages = [...extensionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language]) => language);

  const packageManagers = new Set<string>();
  let manifestFile: string | undefined;
  for (const detector of MANIFEST_DETECTORS) {
    if (inventory.files.some((f) => f.path === detector.file)) {
      packageManagers.add(detector.packageManager);
      manifestFile ??= detector.file;
    }
  }

  const frameworks = new Set<string>();
  let manifestDescription: string | undefined;
  const packageJsonEntry = inventory.files.find((f) => f.path === "package.json");
  if (packageJsonEntry) {
    try {
      const contents = readTextFile(repoRoot, "package.json");
      const parsed = JSON.parse(contents) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        description?: string;
      };
      const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
      for (const dep of Object.keys(allDeps)) {
        for (const keyword of FRAMEWORK_KEYWORDS) {
          if (dep.toLowerCase().includes(keyword)) {
            frameworks.add(keyword);
          }
        }
      }
      if (typeof parsed.description === "string" && parsed.description.trim().length > 0) {
        manifestDescription = parsed.description.trim();
      }
    } catch {
      // malformed package.json — skip framework/description detection, not fatal
    }
  }

  return {
    primaryLanguage: languages[0] ?? "unknown",
    languages,
    packageManagers: [...packageManagers],
    frameworks: [...frameworks],
    manifestFile,
    manifestDescription,
  };
}
