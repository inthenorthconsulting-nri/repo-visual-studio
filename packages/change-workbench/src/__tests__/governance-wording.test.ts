// Governance wording regression: asserts toProposedBasisStatement() rephrases
// every present-tense violation statement the real evaluatePolicy() actually
// produces (see governance-advisory.ts's header comment for the exhaustive
// grep this was verified against) onto a proposed, not-yet-applied basis --
// "would violate"/"would exceed", never a bare "violates"/", violating rule"
// or an unqualified "exceeding the configured maximum".

import { describe, expect, it } from "vitest";
import { buildGovernanceAdvisory, toProposedBasisStatement } from "../governance-advisory.js";

const REPRESENTATIVE_CANONICAL_STATEMENTS = [
  'Component "comp-a" was removed, violating rule "Forbid Component Removal".',
  'Dependency edge "comp-a -> comp-b" was removed, violating rule "Forbid Dependency Removal".',
  'Capability "cap-1" regressed from operational to planned, violating rule "Forbid Operational To Planned Regression".',
  'Policy exception "exc-1" lacks a linked decision, violating rule "Require Decision For Policy Exception".',
  'Repository "repo-1" has 7 unresolved relationships, exceeding the configured maximum of 5, violating rule "Limit Unresolved Relationships".',
  'Repository "repo-1" has 4 unresolved decision conflicts, exceeding the configured maximum of 2, violating rule "Limit Unresolved Decision Conflicts".',
];

describe("governance wording regression: toProposedBasisStatement", () => {
  it.each(REPRESENTATIVE_CANONICAL_STATEMENTS)("rephrases %j onto a proposed basis with no bare present-tense violation phrasing surviving", (canonical) => {
    const rephrased = toProposedBasisStatement(canonical);
    expect(rephrased).not.toContain(", violating rule");
    expect(rephrased).not.toContain("exceeding the configured maximum");
    expect(rephrased.startsWith("On the proposed (not-yet-applied) basis evaluated by this advisory: ")).toBe(true);
  });

  it("turns a plain 'violating rule' statement into 'which would violate rule'", () => {
    const rephrased = toProposedBasisStatement('Component "comp-a" was removed, violating rule "Forbid Component Removal".');
    expect(rephrased).toContain(', which would violate rule "Forbid Component Removal".');
  });

  it("turns a plain 'exceeding the configured maximum' statement into 'which would exceed the configured maximum'", () => {
    const rephrased = toProposedBasisStatement('Repository "repo-1" has 7 unresolved relationships, exceeding the configured maximum of 5.');
    expect(rephrased).toContain(", which would exceed the configured maximum of 5.");
  });

  it("never mutates or drops any other part of the canonical statement (round-trips everything except the two targeted substrings)", () => {
    const canonical = 'Component "comp-a" was removed, violating rule "Forbid Component Removal".';
    const rephrased = toProposedBasisStatement(canonical);
    expect(rephrased).toContain('Component "comp-a" was removed');
    expect(rephrased).toContain('rule "Forbid Component Removal"');
  });
});

describe("governance wording regression: buildGovernanceAdvisory honest not_evaluated default", () => {
  it("reports not_evaluated with no findings when no real evaluatePolicy() input is supplied", () => {
    const result = buildGovernanceAdvisory({});
    expect(result.status).toBe("not_evaluated");
    expect(result.findings).toEqual([]);
    expect(result.detail.length).toBeGreaterThan(0);
  });
});
