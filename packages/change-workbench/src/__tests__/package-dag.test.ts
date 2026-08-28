// Package-DAG proof: @rvs/change-workbench sits at the top of the
// dependency graph (Milestone 11) and must never participate in a cycle.
// This walks every workspace package's real package.json `dependencies`
// (node:fs, test-only -- the package's own runtime source never touches the
// filesystem, see persistence.ts's header comment) and asserts two things:
// (1) the whole workspace dependency graph is acyclic, and (2) none of
// change-workbench's own direct/transitive dependencies depend on
// change-workbench itself, directly or transitively.

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

describe("package DAG: the whole workspace dependency graph is acyclic", () => {
  it("finds no cycle among any workspace:* package.json dependency", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.size).toBeGreaterThan(10);
    const cycle = findCycle(graph);
    expect(cycle).toBeUndefined();
  });
});

describe("package DAG: @rvs/change-workbench never appears as a transitive dependency of what it depends on", () => {
  it("none of change-workbench's own dependencies (direct or transitive) depend back on change-workbench", () => {
    const graph = loadWorkspaceDependencyGraph();
    const changeWorkbenchDeps = graph.get("@rvs/change-workbench") ?? [];
    expect(changeWorkbenchDeps.length).toBeGreaterThan(0);
    for (const dep of changeWorkbenchDeps) {
      const depsOfDep = transitiveDependencies(graph, dep);
      expect(depsOfDep.has("@rvs/change-workbench")).toBe(false);
    }
  });

  it("change-workbench's declared direct dependencies match its actual source imports (@rvs/knowledge-graph, @rvs/decision-intelligence, @rvs/governance-intelligence)", () => {
    const graph = loadWorkspaceDependencyGraph();
    const changeWorkbenchDeps = new Set(graph.get("@rvs/change-workbench") ?? []);
    expect(changeWorkbenchDeps.has("@rvs/knowledge-graph")).toBe(true);
    expect(changeWorkbenchDeps.has("@rvs/governance-intelligence")).toBe(true);
  });
});
