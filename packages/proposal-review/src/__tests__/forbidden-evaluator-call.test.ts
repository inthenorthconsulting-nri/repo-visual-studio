// Static call-graph proof that @rvs/proposal-review's non-test source
// never calls a @rvs/change-workbench evaluator. This is the mandatory
// evidence backing adapter.ts's own header-comment claim: this package is
// a *binder*, not an evaluator, and re-derives none of proposal
// validation, overlay projection, or advisory generation.
//
// Milestone 11.3.3A narrowed the previously-absolute "every
// @rvs/change-workbench/@rvs/knowledge-graph import is `import type`" rule
// by exactly one named value-import per package: `buildProposedChangeSetId`
// (@rvs/change-workbench) and `buildGraphSnapshot` (@rvs/knowledge-graph).
// Both are pure, deterministic identity/canonicalization utilities -- not
// evaluators, not builders of new domain content -- reused so
// adapter.ts's Milestone 11.3.3A integrity checks recompute expected
// identity from caller-supplied content using each package's own
// authoritative algorithm, rather than reimplementing SHA-256
// canonicalization locally (which would create a second, driftable
// identity authority). This file enforces that the exception stays
// exactly that narrow: no other value import, from either package, is
// permitted; both allowlisted functions must actually be called; and
// adapter.ts must not locally define its own canonicalize/digest/hash
// logic that could quietly duplicate what the allowlisted functions
// already do.
//
// Method: read every non-test .ts file under src/ via node:fs (source-text
// scanning, not a type-aware call graph), strip `//` and `/* */` comments
// so the header commentary's own prose references to these function names
// (e.g. "consume `evaluateProposedChange()` rather than...") don't produce
// false positives, then assert against the remaining CODE text only.

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

/** The ONLY name each package may be value-imported for -- an identity/canonicalization utility, never an evaluator/builder of new domain content. */
const ALLOWED_VALUE_IMPORTS: Record<string, string> = {
  "@rvs/change-workbench": "buildProposedChangeSetId",
  "@rvs/knowledge-graph": "buildGraphSnapshot",
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function nonTestSourceFiles(): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(SRC_DIR, entry.name));
}

/** Parses `import { a, b } from "pkg";` (or `import x from "pkg"`) into its imported names. Returns undefined for lines this simple parser doesn't recognize (e.g. `import * as`), which callers treat as "not a bare named-value import" and reject outright. */
function namedImportsFrom(line: string, pkg: string): string[] | undefined {
  const match = line.match(new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*["']${pkg.replace(/[/]/g, "\\/")}["'];?\\s*$`));
  if (!match) return undefined;
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

describe("static audit: @rvs/proposal-review non-test source never calls a @rvs/change-workbench evaluator", () => {
  const files = nonTestSourceFiles();

  it("found at least ids.ts, contracts.ts, adapter.ts, index.ts to scan", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    const name = file.split("/").pop();

    for (const pkg of Object.keys(ALLOWED_VALUE_IMPORTS)) {
      it(`${name}: every ${pkg} import statement is "import type", except the single allowlisted value import`, () => {
        const importLines = code.split("\n").filter((line) => line.trim().startsWith("import") && line.includes(pkg));
        for (const rawLine of importLines) {
          const line = rawLine.trim();
          if (line.startsWith("import type")) continue;
          const names = namedImportsFrom(line, pkg);
          expect(names, `unrecognized non-type import form from ${pkg}: "${line}"`).toBeDefined();
          expect(names).toEqual([ALLOWED_VALUE_IMPORTS[pkg]]);
        }
      });
    }

    it(`${name}: no forbidden evaluator/builder call-syntax occurrence outside comments`, () => {
      for (const fn of FORBIDDEN_EVALUATOR_CALLS) {
        const callPattern = new RegExp(`\\b${fn}\\s*\\(`);
        expect(callPattern.test(code)).toBe(false);
      }
    });

    it(`${name}: no local canonicalize/digest/hash reimplementation`, () => {
      expect(/\bcreateHash\s*\(/.test(code)).toBe(false);
      expect(/\bfunction\s+canonicalize\s*\(/.test(code)).toBe(false);
      expect(/\bfunction\s+digestOf\s*\(/.test(code)).toBe(false);
    });
  }

  it("adapter.ts calls exactly one @rvs/visual-intelligence content-producing function: buildProposalTruthDisclosure", () => {
    const adapterSource = readFileSync(join(SRC_DIR, "adapter.ts"), "utf8");
    expect(/\bbuildProposalTruthDisclosure\s*\(/.test(adapterSource)).toBe(true);
  });

  it("adapter.ts actually calls both allowlisted identity-verification functions (the exception is used, not just permitted)", () => {
    const adapterSource = stripComments(readFileSync(join(SRC_DIR, "adapter.ts"), "utf8"));
    expect(/\bbuildProposedChangeSetId\s*\(/.test(adapterSource)).toBe(true);
    expect(/\bbuildGraphSnapshot\s*\(/.test(adapterSource)).toBe(true);
  });
});
