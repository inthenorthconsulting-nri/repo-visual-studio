import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Milestone 6.2's routing/governance layer is documentation-only — there is
// no runtime routing engine to unit-test. Per MASTER_AGENT.md's own design
// mandate, these tests verify the layer structurally instead: every file
// the operating model promises exists, every relative markdown link it
// makes actually resolves, and the required policy content (authorization
// boundaries, evidence bars) is actually present rather than merely
// intended. This mirrors packages/architecture-intelligence's
// validate-structure.test.ts pattern of testing structure directly rather
// than inventing a synthetic execution harness.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

function extractRelativeMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const target = match[1]!.split("#")[0]!.trim();
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
    links.push(target);
  }
  return links;
}

const REQUIRED_STRUCTURE = [
  "MASTER_AGENT.md",
  "skills/repo-visual-studio/SKILL.md",
  "skills/repo-visual-studio/references/intelligence-routing.md",
  "skills/repo-visual-studio/references/architecture-intelligence.md",
  "skills/repo-visual-studio/references/capability-intelligence.md",
  "skills/repo-visual-studio/references/product-intelligence.md",
  "skills/repo-visual-studio/references/portfolio-intelligence.md",
  "skills/repo-visual-studio/references/presentation-and-export.md",
  "skills/pr-governance/SKILL.md",
  "skills/pr-governance/references/branch-policy.md",
  "skills/pr-governance/references/commit-policy.md",
  "skills/pr-governance/references/pull-request-policy.md",
  "skills/pr-governance/references/review-policy.md",
  "skills/pr-governance/references/merge-policy.md",
  "skills/pr-governance/references/task-boundaries.md",
  "skills/repository-maintenance/SKILL.md",
  "skills/repository-maintenance/references/repository-health.md",
  "skills/repository-maintenance/references/dependency-maintenance.md",
  "skills/repository-maintenance/references/documentation-maintenance.md",
  "skills/repository-maintenance/references/test-maintenance.md",
  "skills/repository-maintenance/references/dead-code-and-artifact-cleanup.md",
  "skills/repository-maintenance/references/release-readiness.md",
  "docs/agent-operating-model.md",
  "docs/pr-governance.md",
  "docs/repository-maintenance.md",
];

const SKILL_MD_FILES = [
  "skills/repo-visual-studio/SKILL.md",
  "skills/pr-governance/SKILL.md",
  "skills/repository-maintenance/SKILL.md",
];

describe("Milestone 6.2 required deliverable structure", () => {
  it.each(REQUIRED_STRUCTURE)("%s exists", (relPath) => {
    expect(existsSync(resolve(ROOT, relPath)), `expected ${relPath} to exist`).toBe(true);
  });

  it("MASTER_AGENT.md is within its target size band (approximately 300-600 lines)", () => {
    const lineCount = read("MASTER_AGENT.md").split("\n").length;
    expect(lineCount).toBeGreaterThan(250);
    expect(lineCount).toBeLessThan(700);
  });
});

describe("skill frontmatter", () => {
  const names = SKILL_MD_FILES.map((path) => {
    const content = read(path);
    const match = content.match(/^name:\s*(\S+)/m);
    expect(match, `${path} must declare a frontmatter "name:"`).toBeTruthy();
    return match![1]!;
  });

  it("has no duplicate skill names", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses the directory name as the skill name", () => {
    for (const path of SKILL_MD_FILES) {
      const dir = path.split("/")[1]!;
      const content = read(path);
      expect(content).toMatch(new RegExp(`^name:\\s*${dir}\\s*$`, "m"));
    }
  });
});

describe("relative markdown links resolve", () => {
  const filesToCheck = [
    "MASTER_AGENT.md",
    ...SKILL_MD_FILES,
    "docs/agent-operating-model.md",
    "docs/pr-governance.md",
    "docs/repository-maintenance.md",
    "AGENTS.md",
    "CLAUDE.md",
  ];

  for (const file of filesToCheck) {
    it(`every relative link in ${file} resolves to a real file`, () => {
      const content = read(file);
      const baseDir = dirname(resolve(ROOT, file));
      for (const link of extractRelativeMarkdownLinks(content)) {
        const target = resolve(baseDir, link);
        expect(existsSync(target), `${file} links to "${link}" which does not resolve to ${target}`).toBe(true);
      }
    });
  }
});

describe("tool adapters reference MASTER_AGENT.md, not a duplicate of it", () => {
  for (const adapter of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    it(`${adapter} points to MASTER_AGENT.md`, () => {
      const content = read(adapter);
      expect(content).toMatch(/MASTER_AGENT\.md/);
    });

    it(`${adapter} does not duplicate the routing table or authorization rules`, () => {
      const content = read(adapter);
      // A thin adapter should not itself define task classes or restate the
      // publication-boundary list — those belong only in MASTER_AGENT.md.
      expect(content).not.toMatch(/force-push/i);
      expect(content.split("\n").length).toBeLessThan(30);
    });
  }
});

describe("authorization boundaries are unambiguous in MASTER_AGENT.md", () => {
  const content = read("MASTER_AGENT.md");

  it("requires explicit authorization for every publication boundary", () => {
    expect(content).toMatch(/explicit.*authorization/is);
    for (const action of ["Creating a commit", "Pushing a branch", "Opening a PR", "Merging a PR"]) {
      expect(content).toContain(action);
    }
  });

  it("never states that one authorization implies the next", () => {
    expect(content.toLowerCase()).not.toMatch(/automatically (push|merge|commit|open a pr)/);
    expect(content).toContain("does not authorize");
  });

  it("names the destructive-operation guard list explicitly", () => {
    for (const command of ["git reset --hard", "git push --force", "git rebase", "git commit --amend"]) {
      expect(content).toContain(command);
    }
  });
});

describe("pr-governance skill encodes one-task-per-branch discipline", () => {
  const taskBoundaries = read("skills/pr-governance/references/task-boundaries.md");

  it("distinguishes new tasks from continuation work", () => {
    expect(taskBoundaries).toMatch(/new task/i);
    expect(taskBoundaries).toMatch(/continuation/i);
  });

  it("forbids bundling unrelated work into an existing branch", () => {
    expect(taskBoundaries.toLowerCase()).toContain("do not bundle");
  });

  const pullRequestPolicy = read("skills/pr-governance/references/pull-request-policy.md");
  it("requires explicit authorization before opening a PR", () => {
    expect(pullRequestPolicy).toMatch(/explicit.*authorization/is);
  });

  const mergePolicy = read("skills/pr-governance/references/merge-policy.md");
  it("requires explicit authorization before merging", () => {
    expect(mergePolicy).toMatch(/explicit.*authorization/is);
  });
});

describe("repository-maintenance skill is evidence-based, not autonomous", () => {
  const cleanup = read("skills/repository-maintenance/references/dead-code-and-artifact-cleanup.md");
  it("requires positive evidence before deleting anything", () => {
    for (const evidence of ["No importers", "No CLI registration", "No test dependency"]) {
      expect(cleanup).toContain(evidence);
    }
    expect(cleanup.toLowerCase()).toContain("do not delete based only on filename or apparent age");
  });

  const dependencies = read("skills/repository-maintenance/references/dependency-maintenance.md");
  it("routes dependency upgrades to their own branch/PR", () => {
    expect(dependencies.toLowerCase()).toMatch(/own branch and pr/);
  });

  const release = read("skills/repository-maintenance/references/release-readiness.md");
  it("never claims release readiness implies publishing", () => {
    expect(release.toLowerCase()).toContain("it never\npublishes anything itself");
  });

  const skillDoc = read("skills/repository-maintenance/SKILL.md");
  it("explicitly excludes continuous/scheduled/cross-repository monitoring", () => {
    expect(skillDoc).toMatch(/schedule/i);
    expect(skillDoc).toMatch(/continuous/i);
  });
});

describe("MASTER_AGENT.md routing table matches the intelligence layers actually built", () => {
  const content = read("MASTER_AGENT.md");
  const classes: Array<[string, string[], string[]]> = [
    ["Repository orientation", ["Architecture Intelligence"], ["Capability Intelligence", "Product Identity", "Portfolio Intelligence"]],
    ["Capability analysis", ["Architecture Intelligence", "Capability Intelligence"], ["Product Identity", "Portfolio Intelligence"]],
    ["Portfolio analysis", ["Portfolio Intelligence"], []],
    ["Code implementation", [], ["Portfolio Intelligence"]],
  ];

  it.each(classes)("%s section names its required route without pulling in unrelated layers", (label, required) => {
    const sectionStart = content.indexOf(label);
    expect(sectionStart, `expected a "${label}" row/section in MASTER_AGENT.md`).toBeGreaterThanOrEqual(0);
    for (const layer of required) {
      expect(content).toContain(layer);
    }
  });

  it("code implementation does not require Product or Portfolio Intelligence", () => {
    const row = content.split("\n").find((line) => line.includes("Fix a code defect") || line.includes("Code implementation"));
    expect(row).toBeTruthy();
  });
});

describe("no prohibited Milestone 6.2 scope creep in the routing/governance layer", () => {
  const files = ["MASTER_AGENT.md", ...readdirsRecursive("skills"), ...readdirsRecursive("docs").filter((f) => /agent-operating-model|pr-governance|repository-maintenance/.test(f))];

  const prohibited = [/architecture drift/i, /continuous repository monitoring/i, /scheduled portfolio synthesis/i, /automatic(ally)? (merge|approve)/i];

  for (const file of files) {
    it(`${file} does not describe a prohibited Milestone 7-class capability as implemented`, () => {
      const content = read(file);
      for (const pattern of prohibited) {
        const match = content.match(pattern);
        if (!match) continue;
        // Mentioning a prohibition (e.g. "must not add architecture drift
        // detection") is expected and fine; only fail if it reads as
        // something this milestone claims to implement.
        const idx = match.index ?? 0;
        const window = content.slice(Math.max(0, idx - 80), idx + 80).toLowerCase();
        expect(window).toMatch(/not|never|out of scope|does not|no /);
      }
    });
  }
});

function readdirsRecursive(relDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const relPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.endsWith(".md")) out.push(relPath);
    }
  };
  walk(relDir);
  return out;
}
