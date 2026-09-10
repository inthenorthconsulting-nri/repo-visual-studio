// Static boundary guard for the generic marker channel (Milestone 11.3.3.2A).
//
// The whole value of this precursor is that M10 transports semantic
// qualification without learning what any of it means. That property is not
// self-enforcing: the very next slice will have a strong pull towards
// teaching `semantic-markers.ts` about the one caller it was built for, and
// a single `if (marker.key === "...")` would convert a generic channel into
// a private one while every behavioural test kept passing.
//
// So this file scans source text, the same way
// @rvs/proposal-architecture-review's forbidden-authority-calls.test.ts does,
// and asks the questions a behavioural test cannot: does the marker channel
// name a caller's domain, and did anything upstream of it acquire a
// dependency it is not allowed to have?

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(__dirname, "..", "..", "..");
const GUARDED_PACKAGES = ["visual-intelligence", "visual-grammar"] as const;

/**
 * Files that legitimately contain proposal-oriented wording because they are
 * already-certified generic helpers ABOUT proposal truth (Milestone 11.2),
 * not marker code. They are named individually rather than matched by a
 * pattern, so a new file cannot join the allowlist by accident.
 */
const PROPOSAL_WORDING_ALLOWLIST = new Set([
  "visual-intelligence/src/proposal-truth.ts",
  "visual-intelligence/src/proposal-provenance.ts",
  "visual-intelligence/src/contracts.ts",
  "visual-intelligence/src/ids.ts",
  "visual-intelligence/src/index.ts",
]);

/**
 * Exact pre-existing occurrences in files that are NOT about proposal truth
 * and are therefore scanned in full.
 *
 * `"proposed"` is an ADR lifecycle value in the closed `VisualDecisionStatus`
 * vocabulary, certified long before this slice and unrelated to the marker
 * channel -- so it is excused token by token rather than by excusing the file
 * that also declares the marker field. Each entry is asserted to still exist,
 * so an excuse cannot quietly outlive the thing it excused.
 */
const PRE_EXISTING_CONCEPT_TOKENS: Record<string, readonly string[]> = {
  "visual-intelligence/src/data-model.ts": ['"proposed"'],
};

/** Packages the two generic layers may never import from, at any depth. */
const FORBIDDEN_IMPORTS = [
  "@rvs/proposal-review",
  "@rvs/proposal-architecture-review",
  "@rvs/change-workbench",
  "@rvs/knowledge-graph",
  "@rvs/governance-intelligence",
  "@rvs/decision-intelligence",
];

/**
 * Concepts that belong to a caller, not to a transport. A marker channel that
 * knew any of these would have stopped being generic.
 */
const FORBIDDEN_MARKER_CONCEPTS = [
  "proposal",
  "proposed",
  "projected",
  "baseline_binding",
  "baseline binding",
  "proposal_id",
  "not observed",
  "caller proposed",
];

/** Impurity patterns (§47), checked on the new module specifically. */
const FORBIDDEN_IMPURITY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Date.now()", pattern: /\bDate\.now\s*\(/ },
  { label: "Math.random()", pattern: /\bMath\.random\s*\(/ },
  { label: "crypto.randomUUID()", pattern: /\brandomUUID\s*\(/ },
  { label: "fetch(", pattern: /\bfetch\s*\(/ },
  { label: "node:fs", pattern: /\bnode:fs\b/ },
  { label: "child_process", pattern: /child_process/ },
  { label: "process.cwd()", pattern: /\bprocess\.cwd\s*\(/ },
  { label: "process.env", pattern: /\bprocess\.env\b/ },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every non-test `.ts` file in a guarded package's `src`, recursively. */
function productionSourceFiles(pkg: string): string[] {
  const root = join(PACKAGES_DIR, pkg, "src");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** A path relative to `packages/`, so allowlist entries read as repository paths. */
const relative = (file: string) => file.slice(PACKAGES_DIR.length + 1);

describe("boundary: the generic layers gain no dependency on any caller of the marker channel", () => {
  for (const pkg of GUARDED_PACKAGES) {
    const files = productionSourceFiles(pkg);

    it(`${pkg}: found production sources to scan`, () => {
      expect(files.length).toBeGreaterThan(5);
    });

    it(`${pkg}: no production source imports a downstream or upstream intelligence package`, () => {
      for (const file of files) {
        const code = stripComments(readFileSync(file, "utf8"));
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(code.includes(forbidden), `${relative(file)} references ${forbidden}`).toBe(false);
        }
      }
    });

    it(`${pkg}: package.json declares no dependency on any of them either`, () => {
      const pkgJson = JSON.parse(readFileSync(join(PACKAGES_DIR, pkg, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = Object.keys({ ...pkgJson.dependencies, ...pkgJson.devDependencies });
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(declared, `${pkg} declares ${forbidden}`).not.toContain(forbidden);
      }
    });
  }
});

describe("boundary: the marker channel encodes no caller's concepts", () => {
  for (const pkg of GUARDED_PACKAGES) {
    for (const file of productionSourceFiles(pkg)) {
      const rel = relative(file);
      if (PROPOSAL_WORDING_ALLOWLIST.has(rel)) continue;

      it(`${rel}: mentions no caller-domain concept`, () => {
        // Comments are stripped first: prose that explains which concepts
        // this layer must NOT learn is the opposite of a violation, and a
        // guard that punished the explanation would delete the reasoning.
        let code = stripComments(readFileSync(file, "utf8")).toLowerCase();
        for (const token of PRE_EXISTING_CONCEPT_TOKENS[rel] ?? []) {
          expect(code.includes(token), `${rel} no longer contains excused token ${token}`).toBe(true);
          code = code.split(token).join("");
        }
        for (const concept of FORBIDDEN_MARKER_CONCEPTS) {
          expect(code.includes(concept), `${rel} mentions "${concept}"`).toBe(false);
        }
      });
    }
  }

  it("the allowlist names only files that existed before this slice and are not marker code", () => {
    for (const rel of PROPOSAL_WORDING_ALLOWLIST) {
      const code = readFileSync(join(PACKAGES_DIR, rel), "utf8");
      expect(code.includes("semanticMarker"), `${rel} is allowlisted but touches marker code`).toBe(false);
      expect(code.includes("SemanticMarker") && !rel.endsWith("index.ts"), `${rel} is allowlisted but touches marker code`).toBe(
        false,
      );
    }
  });
});

describe("boundary: the marker channel adds no authority and no impurity", () => {
  const markerModule = join(PACKAGES_DIR, "visual-intelligence", "src", "semantic-markers.ts");

  it("is pure: no clock, no randomness, no filesystem, no network, no environment", () => {
    const code = stripComments(readFileSync(markerModule, "utf8"));
    for (const { label, pattern } of FORBIDDEN_IMPURITY_PATTERNS) {
      expect(pattern.test(code), `semantic-markers.ts uses ${label}`).toBe(false);
    }
  });

  it("resolves a marker from its own input only -- it imports nothing but the id authority", () => {
    const code = stripComments(readFileSync(markerModule, "utf8"));
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((mm) => mm[1]);
    expect(imports).toEqual(["./ids.js"]);
  });

  it("mints no word suggesting verification, certification, approval or observation", () => {
    const code = readFileSync(markerModule, "utf8");
    const literals = [...code.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)].map((lit) =>
      lit[0].toLowerCase(),
    );
    for (const literal of literals) {
      for (const word of ["verified", "certified", "approved", "safe", "observed", "trusted", "validated"]) {
        expect(literal.includes(word), `semantic-markers.ts emits "${word}"`).toBe(false);
      }
    }
  });

  it("does not reach into the closed VisualState vocabulary or the change contract", () => {
    const code = stripComments(readFileSync(markerModule, "utf8"));
    for (const name of ["VISUAL_STATES", "resolveVisualState", "VisualChange", "VisualSeverity", "VisualDecisionStatus"]) {
      expect(code.includes(name), `semantic-markers.ts touches ${name}`).toBe(false);
    }
  });
});

// The §33 gate: this precursor must add zero workspace dependency edges.
// Mirrors the loadWorkspaceDependencyGraph/findCycle method the
// proposal-review and proposal-architecture-review packages already use, so
// there is one way in this repository to prove a placement claim.

function loadWorkspaceDependencyGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try {
      raw = readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8");
    } catch {
      continue;
    }
    const pkg = JSON.parse(raw) as { name: string; dependencies?: Record<string, string> };
    graph.set(
      pkg.name,
      Object.entries(pkg.dependencies ?? {})
        .filter(([, version]) => version === "workspace:*")
        .map(([name]) => name),
    );
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
  function visit(nodeName: string): string[] | undefined {
    color.set(nodeName, GRAY);
    path.push(nodeName);
    for (const dep of graph.get(nodeName) ?? []) {
      const depColor = color.get(dep);
      if (depColor === GRAY) return [...path.slice(path.indexOf(dep)), dep];
      if (depColor === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    color.set(nodeName, BLACK);
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

describe("package DAG: the marker precursor adds no workspace dependency edge", () => {
  it("@rvs/visual-intelligence still depends on nothing in the workspace", () => {
    expect(loadWorkspaceDependencyGraph().get("@rvs/visual-intelligence")).toEqual([]);
  });

  it("@rvs/visual-grammar still depends on @rvs/visual-intelligence and nothing else", () => {
    expect(loadWorkspaceDependencyGraph().get("@rvs/visual-grammar")).toEqual(["@rvs/visual-intelligence"]);
  });

  it("the workspace graph is still acyclic", () => {
    const graph = loadWorkspaceDependencyGraph();
    expect(graph.size).toBeGreaterThan(10);
    expect(findCycle(graph)).toBeUndefined();
  });
});
