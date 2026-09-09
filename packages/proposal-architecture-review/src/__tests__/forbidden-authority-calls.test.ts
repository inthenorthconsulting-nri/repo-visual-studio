// Static call-graph proof that @rvs/proposal-architecture-review's
// non-test source never re-binds truth this package must only consume.
// Mirrors @rvs/proposal-review's own forbidden-evaluator-call.test.ts
// method (source-text scanning after stripping comments, not a
// type-aware call graph) but scoped to Milestone 11.3.3.1's own
// authorization boundary (§27/§44 of the task specification):
//
// - No evaluator/builder re-invocation: this package consumes a single
//   already-bound `ProposalReviewVisualInput`, never re-derives
//   validation, overlay projection, or advisory content from more
//   primitive Workbench/knowledge-graph inputs.
// - No ChangeReviewModel/observed-before-after reuse (Milestone 10):
//   Projected State is an unobserved deterministic overlay result, never
//   an "after" snapshot.
// - No GraphSnapshot minting for Projected State.
// - No impurity: no clock, no randomness, no filesystem, no network, no
//   child_process.
// - No proposal-truth-inflating wording in any generated string literal
//   (reuses @rvs/visual-intelligence's own FORBIDDEN_PROPOSAL_TRUTH_WORDING
//   authority rather than duplicating it).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FORBIDDEN_PROPOSAL_TRUTH_WORDING } from "@rvs/visual-intelligence";

const SRC_DIR = join(__dirname, "..");

const FORBIDDEN_CALLS = [
  "evaluateProposedChange",
  "validateProposedChangeSet",
  "buildChangeOverlay",
  "buildChangeAdvisory",
  "buildChangeAdvisoryFromEvaluationInputs",
  "buildImpactAdvisory",
  "buildGovernanceAdvisory",
  "buildDecisionAdvisory",
  "composeProposedChangeSet",
  "computeDecisionImpact",
  "verifyGraphContentDigest",
  "buildGraphSnapshot",
  "buildProposedChangeSetId",
  "buildGraphContentDigest",
  "buildReviewAssembly",
];

/** Impurity call-syntax patterns -- checked separately from FORBIDDEN_CALLS because these are bare expressions/property accesses, not `name(` call sites. */
const FORBIDDEN_IMPURITY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Date.now()", pattern: /\bDate\.now\s*\(/ },
  { label: "Math.random()", pattern: /\bMath\.random\s*\(/ },
  { label: "crypto.randomUUID()", pattern: /\brandomUUID\s*\(/ },
  { label: "fetch(", pattern: /\bfetch\s*\(/ },
  { label: "fs. (node:fs usage)", pattern: /\bfs\./ },
  { label: "child_process", pattern: /child_process/ },
  { label: "process.cwd()", pattern: /\bprocess\.cwd\s*\(/ },
];

const FORBIDDEN_TYPE_NAMES = ["ChangeReviewModel", "ReviewSnapshot"];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function nonTestSourceFiles(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(SRC_DIR, entry.name));
}

describe("static audit: @rvs/proposal-architecture-review non-test source never re-binds truth or re-derives evaluation", () => {
  const files = nonTestSourceFiles();

  it("found at least contracts.ts, ids.ts, compose.ts, index.ts to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    const name = file.split("/").pop();

    it(`${name}: no forbidden evaluator/builder/re-derivation call-syntax occurrence outside comments`, () => {
      for (const fn of FORBIDDEN_CALLS) {
        const callPattern = new RegExp(`\\b${fn}\\s*\\(`);
        expect(callPattern.test(code)).toBe(false);
      }
    });

    it(`${name}: no ChangeReviewModel/ReviewSnapshot (Milestone 10 observed before/after) type reference`, () => {
      for (const typeName of FORBIDDEN_TYPE_NAMES) {
        expect(new RegExp(`\\b${typeName}\\b`).test(code)).toBe(false);
      }
    });

    it(`${name}: no from_snapshot_id/to_snapshot_id field (Change Review's observed before/after identity)`, () => {
      expect(/\bfrom_snapshot_id\b/.test(code)).toBe(false);
      expect(/\bto_snapshot_id\b/.test(code)).toBe(false);
    });

    it(`${name}: no impurity call-syntax occurrence outside comments`, () => {
      for (const { pattern } of FORBIDDEN_IMPURITY_PATTERNS) {
        expect(pattern.test(code)).toBe(false);
      }
    });

    it(`${name}: no value import from @rvs/change-workbench or @rvs/knowledge-graph in non-test production source`, () => {
      const importLines = code
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("import") && (line.includes("@rvs/change-workbench") || line.includes("@rvs/knowledge-graph")));
      for (const line of importLines) {
        expect(line.startsWith("import type")).toBe(true);
      }
    });
  }

  it("no generated string literal in production source contains any FORBIDDEN_PROPOSAL_TRUTH_WORDING entry", () => {
    expect(FORBIDDEN_PROPOSAL_TRUTH_WORDING.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = readFileSync(file, "utf8").toLowerCase();
      for (const forbidden of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
        expect(raw.includes(forbidden.toLowerCase())).toBe(false);
      }
    }
  });

  it("no generated string literal uses proposal-truth-inflating Projected State wording ('After', 'Target State', 'Final Architecture', etc.)", () => {
    const disallowed = ["after", "target state", "final architecture", "new architecture", "approved architecture", "resulting architecture", "target snapshot", "future snapshot", "production architecture"];
    for (const file of files) {
      const raw = readFileSync(file, "utf8").toLowerCase();
      // Only scan quoted string-literal content, not doc-comment prose (which legitimately discusses these terms as *forbidden* examples).
      const stringLiterals = [...raw.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)].map((m) => m[0]);
      for (const literal of stringLiterals) {
        for (const term of disallowed) {
          expect(literal.includes(term)).toBe(false);
        }
      }
    }
  });
});
