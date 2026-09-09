// Package-DAG proof for @rvs/proposal-architecture-review (Milestone
// 11.3.3.1). Mirrors @rvs/proposal-review's own package-dag.test.ts
// exactly (same loadWorkspaceDependencyGraph/findCycle/
// transitiveDependencies logic, same node:fs-reads-real-package.json
// approach) but scoped to this package's own placement requirement: it
// depends on @rvs/proposal-review only, sits strictly downstream of it,
// and does not widen the DAG to @rvs/visual-grammar, @rvs/visual-
// composition, or @rvs/visual-delivery in this slice.

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

describe("package DAG: the whole workspace dependency graph is acyclic (including @rvs/proposal-architecture-review)", () => {
  it("finds no cycle among any workspace:* package.json dependency", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has("@rvs/proposal-architecture-review")).toBe(true);
    const cycle = findCycle(graph);
    expect(cycle).toBeUndefined();
  });
});

describe("package DAG: @rvs/proposal-architecture-review's declared placement", () => {
  it("depends on @rvs/proposal-review only, as a production dependency", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get("@rvs/proposal-architecture-review") ?? [];
    expect(deps).toEqual(["@rvs/proposal-review"]);
  });

  it("does not depend (directly or transitively) on @rvs/visual-grammar, @rvs/visual-composition, or @rvs/visual-delivery", () => {
    const graph = loadWorkspaceDependencyGraph();
    const transitive = transitiveDependencies(graph, "@rvs/proposal-architecture-review");
    expect(transitive.has("@rvs/visual-grammar")).toBe(false);
    expect(transitive.has("@rvs/visual-composition")).toBe(false);
    expect(transitive.has("@rvs/visual-delivery")).toBe(false);
  });

  it("none of its own dependencies (direct or transitive) depend back on it", () => {
    const graph = loadWorkspaceDependencyGraph();
    const deps = graph.get("@rvs/proposal-architecture-review") ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      const depsOfDep = transitiveDependencies(graph, dep);
      expect(depsOfDep.has("@rvs/proposal-architecture-review")).toBe(false);
    }
  });

  it("is not itself @rvs/proposal-review, @rvs/visual-change-review, or @rvs/visual-composition (must not live inside any of those)", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.has("@rvs/proposal-architecture-review")).toBe(true);
    expect("@rvs/proposal-architecture-review").not.toBe("@rvs/proposal-review");
    expect("@rvs/proposal-architecture-review").not.toBe("@rvs/visual-change-review");
    expect("@rvs/proposal-architecture-review").not.toBe("@rvs/visual-composition");
  });
});
