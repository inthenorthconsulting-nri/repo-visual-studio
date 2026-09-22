// Static call-graph proof that @rvs/proposal-architecture-review-visual's
// non-test source never re-binds truth this package must only consume, and
// never widens its dependency boundary beyond the four packages authorized
// for this milestone (Milestone 11.3.3.2B, §8/§27/§44).
//
// Mirrors @rvs/proposal-architecture-review's own
// forbidden-authority-calls.test.ts method, with one addition: this
// package's dependency boundary is *stricter* than that package's (no
// `@rvs/change-workbench`/`@rvs/knowledge-graph` reference at all, not even
// `import type`), because §8 names exactly four allowed dependencies and
// neither of those two packages is among them.

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
  "classifyNodeAttributes",
  "classifyEdgeAttributes",
];

const FORBIDDEN_IMPURITY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Date.now()", pattern: /\bDate\.now\s*\(/ },
  { label: "Math.random()", pattern: /\bMath\.random\s*\(/ },
  { label: "crypto.randomUUID()", pattern: /\brandomUUID\s*\(/ },
  { label: "fetch(", pattern: /\bfetch\s*\(/ },
  { label: "fs. (node:fs usage)", pattern: /\bfs\./ },
  { label: "net. (node:net usage)", pattern: /\bnet\./ },
  { label: "http. (node:http usage)", pattern: /\bhttp\./ },
  { label: "child_process", pattern: /child_process/ },
  { label: "process.cwd()", pattern: /\bprocess\.cwd\s*\(/ },
  { label: "process.env", pattern: /\bprocess\.env\b/ },
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

describe("static audit: @rvs/proposal-architecture-review-visual non-test source never re-binds truth or re-derives evaluation", () => {
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

    it(`${name}: no reference at all (value or type) to @rvs/change-workbench or @rvs/knowledge-graph`, () => {
      expect(code.includes("@rvs/change-workbench")).toBe(false);
      expect(code.includes("@rvs/knowledge-graph")).toBe(false);
    });

    it(`${name}: no reference to @rvs/proposal-review, @rvs/governance-intelligence, or @rvs/decision-intelligence`, () => {
      expect(code.includes("@rvs/proposal-review")).toBe(false);
      expect(code.includes("@rvs/governance-intelligence")).toBe(false);
      expect(code.includes("@rvs/decision-intelligence")).toBe(false);
    });
  }

  it("no generated string literal in production source contains any FORBIDDEN_PROPOSAL_TRUTH_WORDING entry", () => {
    expect(FORBIDDEN_PROPOSAL_TRUTH_WORDING.length).toBeGreaterThan(0);
    for (const file of files) {
      // Comments are prose *about* this boundary (and freely discuss the
      // forbidden terms as examples of what to avoid) -- only code, where a
      // string literal could actually reach a reader, is load-bearing here.
      const raw = stripComments(readFileSync(file, "utf8")).toLowerCase();
      for (const forbidden of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
        expect(raw.includes(forbidden.toLowerCase())).toBe(false);
      }
    }
  });

  it("no generated string literal uses proposal-truth-inflating Projected State wording ('After', 'Target State', 'Final Architecture', etc.)", () => {
    const disallowed = ["target state", "final architecture", "new architecture", "approved architecture", "resulting architecture", "target snapshot", "future snapshot", "production architecture"];
    for (const file of files) {
      const raw = stripComments(readFileSync(file, "utf8")).toLowerCase();
      const stringLiterals = [...raw.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)].map((m) => m[0]);
      for (const literal of stringLiterals) {
        for (const term of disallowed) {
          expect(literal.includes(term)).toBe(false);
        }
      }
    }
  });
});
