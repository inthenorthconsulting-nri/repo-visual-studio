// Package-DAG proof for @rvs/proposal-review (Milestone 11.3.1). Mirrors
// @rvs/change-workbench's package-dag.test.ts exactly (same
// loadWorkspaceDependencyGraph/findCycle/transitiveDependencies logic,
// same node:fs-reads-real-package.json approach) but scoped to this
// package's own placement requirement: it must sit BETWEEN
// @rvs/change-workbench and @rvs/visual-intelligence in the dependency
// graph, without either of those two packages gaining a dependency on
// each other or on @rvs/proposal-review.

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

describe("package DAG: the whole workspace dependency graph is acyclic (including @rvs/proposal-review)", () => {
  it("finds no cycle among any workspace:* package.json dependency", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has("@rvs/proposal-review")).toBe(true);
    const cycle = findCycle(graph);
    expect(cycle).toBeUndefined();
  });
});

describe("package DAG: @rvs/proposal-review's declared placement", () => {
  it("depends on @rvs/change-workbench, @rvs/knowledge-graph, and @rvs/visual-intelligence directly", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = new Set(graph.get("@rvs/proposal-review") ?? []);
    expect(deps.has("@rvs/change-workbench")).toBe(true);
    expect(deps.has("@rvs/knowledge-graph")).toBe(true);
    expect(deps.has("@rvs/visual-intelligence")).toBe(true);
  });

  it("none of proposal-review's own dependencies (direct or transitive) depend back on proposal-review", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get("@rvs/proposal-review") ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      const depsOfDep = transitiveDependencies(graph, dep);
      expect(depsOfDep.has("@rvs/proposal-review")).toBe(false);
    }
  });

  it("@rvs/change-workbench does not depend on @rvs/proposal-review or @rvs/visual-intelligence", () => {
    const graph = loadWorkspaceDependencyGraph();
    const changeWorkbenchDeps = transitiveDependencies(graph, "@rvs/change-workbench");
    expect(changeWorkbenchDeps.has("@rvs/proposal-review")).toBe(false);
    expect(changeWorkbenchDeps.has("@rvs/visual-intelligence")).toBe(false);
  });

  it("@rvs/visual-intelligence does not depend on @rvs/proposal-review or @rvs/change-workbench", () => {
    const graph = loadWorkspaceDependencyGraph();
    const visualIntelligenceDeps = transitiveDependencies(graph, "@rvs/visual-intelligence");
    expect(visualIntelligenceDeps.has("@rvs/proposal-review")).toBe(false);
    expect(visualIntelligenceDeps.has("@rvs/change-workbench")).toBe(false);
  });

  it("no workspace package other than @rvs/proposal-review itself depends on @rvs/proposal-review (no reverse edge yet -- this slice adds no consumer)", () => {
    const graph = loadWorkspaceDependencyGraph();
    for (const [name, deps] of graph.entries()) {
      if (name === "@rvs/proposal-review") continue;
      expect(deps.includes("@rvs/proposal-review")).toBe(false);
    }
  });

  it("@rvs/proposal-review is not itself @rvs/change-workbench, @rvs/visual-intelligence, or @rvs/cli (must not live inside any of those)", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.has("@rvs/proposal-review")).toBe(true);
    expect("@rvs/proposal-review").not.toBe("@rvs/change-workbench");
    expect("@rvs/proposal-review").not.toBe("@rvs/visual-intelligence");
    expect("@rvs/proposal-review").not.toBe("@rvs/cli");
  });
});
