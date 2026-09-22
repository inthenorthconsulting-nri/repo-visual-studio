// Package-DAG proof for @rvs/proposal-architecture-review-visual
// (Milestone 11.3.3.2B). Mirrors @rvs/proposal-architecture-review's own
// package-dag.test.ts exactly (same loadWorkspaceDependencyGraph/
// findCycle/transitiveDependencies logic, same node:fs-reads-real-
// package.json approach) but scoped to this package's own placement
// requirement (§8/§44): it depends only on @rvs/proposal-architecture-review,
// @rvs/visual-intelligence, @rvs/visual-grammar, and @rvs/visual-composition,
// and no M10 package may depend back on it.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(__dirname, "..", "..", "..");

function loadWorkspaceDependencyGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(PACKAGES_DIR, entry.name, "package.json");
    let raw: string;
    try {
      raw = readFileSync(packageJsonPath, "utf8");
    } catch {
      continue;
    }
    const pkg = JSON.parse(raw) as { name: string; dependencies?: Record<string, string> };
    const workspaceDeps = Object.entries(pkg.dependencies ?? {})
      .filter(([, version]) => version === "workspace:*")
      .map(([name]) => name);
    graph.set(pkg.name, workspaceDeps);
  }
  return graph;
}

function findCycle(graph: Map<string, string[]>): string[] | undefined {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const name of graph.keys()) color.set(name, WHITE);

  const path: string[] = [];
  function visit(node: string): string[] | undefined {
    color.set(node, GRAY);
    path.push(node);
    for (const dep of graph.get(node) ?? []) {
      const depColor = color.get(dep);
      if (depColor === GRAY) return [...path.slice(path.indexOf(dep)), dep];
      if (depColor === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    color.set(node, BLACK);
    return undefined;
  }

  for (const name of graph.keys()) {
    if (color.get(name) === WHITE) {
      const found = visit(name);
      if (found) return found;
    }
  }
  return undefined;
}

function transitiveDependencies(graph: Map<string, string[]>, root: string): Set<string> {
  const visited = new Set<string>();
  const stack = [...(graph.get(root) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    stack.push(...(graph.get(next) ?? []));
  }
  return visited;
}

const PACKAGE_NAME = "@rvs/proposal-architecture-review-visual";

describe("package DAG: the whole workspace dependency graph is acyclic (including @rvs/proposal-architecture-review-visual)", () => {
  it("finds no cycle among any workspace:* package.json dependency", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has(PACKAGE_NAME)).toBe(true);
    const cycle = findCycle(graph);
    expect(cycle).toBeUndefined();
  });
});

describe("package DAG: @rvs/proposal-architecture-review-visual's declared placement", () => {
  it("depends on exactly the four authorized production dependencies", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get(PACKAGE_NAME) ?? [];
    expect([...deps].sort()).toEqual(["@rvs/proposal-architecture-review", "@rvs/visual-composition", "@rvs/visual-grammar", "@rvs/visual-intelligence"]);
  });

  it("does not depend on @rvs/change-workbench, @rvs/knowledge-graph, or @rvs/proposal-review directly (only transitively, through the one permitted @rvs/proposal-architecture-review -> @rvs/proposal-review chain)", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get(PACKAGE_NAME) ?? [];
    expect(deps).not.toContain("@rvs/change-workbench");
    expect(deps).not.toContain("@rvs/knowledge-graph");
    expect(deps).not.toContain("@rvs/proposal-review");
  });

  it("none of its own dependencies (direct or transitive) depend back on it", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get(PACKAGE_NAME) ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      const depsOfDep = transitiveDependencies(graph, dep);
      expect(depsOfDep.has(PACKAGE_NAME)).toBe(false);
    }
  });

  it("no M10 package (@rvs/visual-intelligence, @rvs/visual-grammar, @rvs/visual-composition) depends on this package, directly or transitively", () => {
    const graph = loadWorkspaceDependencyGraph();
    for (const m10 of ["@rvs/visual-intelligence", "@rvs/visual-grammar", "@rvs/visual-composition"]) {
      const transitive = transitiveDependencies(graph, m10);
      expect(transitive.has(PACKAGE_NAME)).toBe(false);
    }
  });

  it("is not itself @rvs/proposal-architecture-review, @rvs/proposal-review, or @rvs/visual-change-review (must not live inside any of those)", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.has(PACKAGE_NAME)).toBe(true);
    expect(PACKAGE_NAME).not.toBe("@rvs/proposal-architecture-review");
    expect(PACKAGE_NAME).not.toBe("@rvs/proposal-review");
    expect(PACKAGE_NAME).not.toBe("@rvs/visual-change-review");
  });
});
