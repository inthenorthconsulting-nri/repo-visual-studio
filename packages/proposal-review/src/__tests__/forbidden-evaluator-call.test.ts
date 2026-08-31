// Static call-graph proof that @rvs/proposal-review's non-test source
// never calls a @rvs/change-workbench evaluator. This is the mandatory
// evidence backing adapter.ts's own header-comment claim: this package is
// a *binder*, not an evaluator, and re-derives none of proposal
// validation, overlay projection, or advisory generation.
//
// Method: read every non-test .ts file under src/ via node:fs (source-text
// scanning, not a type-aware call graph), strip `//` and `/* */` comments
// so the header commentary's own prose references to these function names
// (e.g. "consume `evaluateProposedChange()` rather than...") don't produce
// false positives, then assert two things against the remaining CODE text
// only: (1) every `@rvs/change-workbench` import statement is
// `import type`, never a value import; (2) none of @rvs/change-workbench's
// evaluator/builder function names appear as a call anywhere in the code.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(__dirname, "..");

const FORBIDDEN_EVALUATOR_CALLS = [
  "evaluateProposedChange",
  "validateProposedChangeSet",
  "buildChangeOverlay",
  "buildChangeAdvisory",
  "buildChangeAdvisoryFromEvaluationInputs",
  "buildImpactAdvisory",
  "buildGovernanceAdvisory",
  "buildDecisionAdvisory",
  "composeProposedChangeSet",
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function nonTestSourceFiles(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(SRC_DIR, entry.name));
}

describe("static audit: @rvs/proposal-review non-test source never calls a @rvs/change-workbench evaluator", () => {
  const files = nonTestSourceFiles();

  it("found at least ids.ts, contracts.ts, adapter.ts, index.ts to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    const name = file.split("/").pop();

    it(`${name}: every @rvs/change-workbench import statement is "import type" only`, () => {
      const importLines = code.split("\n").filter((line) => line.trim().startsWith("import") && line.includes("@rvs/change-workbench"));
      for (const line of importLines) {
        expect(line.trim().startsWith("import type")).toBe(true);
      }
    });

    it(`${name}: no forbidden evaluator/builder call-syntax occurrence outside comments`, () => {
      for (const fn of FORBIDDEN_EVALUATOR_CALLS) {
        const callPattern = new RegExp(`\\b${fn}\\s*\\(`);
        expect(callPattern.test(code)).toBe(false);
      }
    });
  }

  it("adapter.ts calls exactly one @rvs/visual-intelligence content-producing function: buildProposalTruthDisclosure", () => {
    const adapterSource = readFileSync(join(SRC_DIR, "adapter.ts"), "utf8");
    expect(/\bbuildProposalTruthDisclosure\s*\(/.test(adapterSource)).toBe(true);
  });
});
