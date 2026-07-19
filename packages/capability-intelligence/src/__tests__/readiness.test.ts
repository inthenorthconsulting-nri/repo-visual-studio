import { describe, expect, it } from "vitest";
import { aggregateCandidateEvidence } from "../evidence.js";
import type { CapabilityMaturityScores } from "../maturity.js";
import { classifyCapabilityStatus, computeCapabilityReadiness } from "../readiness.js";
import { makeCapabilityCandidate, makeCapabilityEvidence, makeReadiness } from "./fixtures.js";

function maturity(overrides: Partial<CapabilityMaturityScores> = {}): CapabilityMaturityScores {
  return { implementation: 0, execution: 0, verification: 0, documentation: 0, adoption: 0, blockers: [], qualifiers: [], ...overrides };
}

// A realistic candidate/aggregate pair with structural, non-deprecated,
// non-documentation-only evidence — used as the baseline for boundary tests
// that only vary the injected CapabilityReadiness, per the spec's
// requirement that hard gates and thresholds be tested independent of how a
// particular score was produced.
function realisticCandidateAndAggregate() {
  const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
  return { candidate, aggregate: aggregateCandidateEvidence(candidate) };
}

describe("computeCapabilityReadiness", () => {
  it("computes a weighted average using DEFAULT_CAPABILITY_READINESS_WEIGHTS (35/25/20/10/10)", () => {
    const readiness = computeCapabilityReadiness(maturity({ implementation: 100, execution: 100, verification: 100, documentation: 100, adoption: 100 }));
    expect(readiness.score).toBe(100);
  });

  it("computes zero when every axis is zero", () => {
    expect(computeCapabilityReadiness(maturity()).score).toBe(0);
  });

  it("weighs implementation and execution most heavily", () => {
    const implementationOnly = computeCapabilityReadiness(maturity({ implementation: 100 }));
    const documentationOnly = computeCapabilityReadiness(maturity({ documentation: 100 }));
    expect(implementationOnly.score).toBeGreaterThan(documentationOnly.score);
    expect(implementationOnly.score).toBe(35);
    expect(documentationOnly.score).toBe(10);
  });

  it("honors a custom weights table", () => {
    const readiness = computeCapabilityReadiness(maturity({ adoption: 100 }), { implementation: 0, execution: 0, verification: 0, documentation: 0, adoption: 100 });
    expect(readiness.score).toBe(100);
  });

  it("carries blockers and qualifiers through from the maturity assessment unchanged", () => {
    const readiness = computeCapabilityReadiness(maturity({ blockers: ["no execution path"], qualifiers: ["no tests"] }));
    expect(readiness.blockers).toEqual(["no execution path"]);
    expect(readiness.qualifiers).toEqual(["no tests"]);
  });

  it("copies each axis score onto its own readiness field", () => {
    const readiness = computeCapabilityReadiness(maturity({ implementation: 10, execution: 20, verification: 30, documentation: 40, adoption: 50 }));
    expect(readiness).toMatchObject({ implementationScore: 10, executionScore: 20, verificationScore: 30, documentationScore: 40, adoptionScore: 50 });
  });
});

describe("classifyCapabilityStatus — special-case routing", () => {
  it("returns 'unknown' for a candidate with zero evidence, regardless of score", () => {
    const candidate = makeCapabilityCandidate({ evidence: [] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness({ score: 99 }));
    expect(status).toBe("unknown");
  });

  it("returns 'deprecated' when a deprecated marker is present without contradictory confirmed evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("deprecated_marker", { confidence: "suggested" })] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness());
    expect(status).toBe("deprecated");
  });

  it("returns 'abandoned' for an archived/abandoned signal with zero execution and weak implementation", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["archived"], evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness({ executionScore: 0, implementationScore: 20 }));
    expect(status).toBe("abandoned");
  });

  it("does not classify as 'abandoned' when implementation score is high, even with an archived signal", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["archived"], evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness({ executionScore: 0, implementationScore: 80, score: 20 }));
    expect(status).not.toBe("abandoned");
  });

  it("returns 'planned' for documentation-only evidence carrying a roadmap keyword", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["planned"], evidence: [makeCapabilityEvidence("documentation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness());
    expect(status).toBe("planned");
  });

  it("returns 'unknown' for documentation-only evidence with no roadmap keyword", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const status = classifyCapabilityStatus(candidate, aggregate, makeReadiness());
    expect(status).toBe("unknown");
  });
});

describe("classifyCapabilityStatus — threshold boundaries (operational=85, implemented=70, partial=45, experimental=25, scaffolded=10)", () => {
  const cases: Array<[number, string]> = [
    [85, "operational"],
    [84, "implemented"],
    [70, "implemented"],
    [69, "partial"],
    [45, "partial"],
    [44, "experimental"],
    [25, "experimental"],
    [24, "scaffolded"],
    [10, "scaffolded"],
    [9, "planned"],
    [0, "planned"],
  ];

  for (const [score, expected] of cases) {
    it(`score ${score} classifies as '${expected}' (with a healthy execution+verification score)`, () => {
      const { candidate, aggregate } = realisticCandidateAndAggregate();
      const readiness = makeReadiness({ score, implementationScore: 80, executionScore: 80, verificationScore: 80 });
      expect(classifyCapabilityStatus(candidate, aggregate, readiness)).toBe(expected);
    });
  }

  it("caps at 'implemented' (never 'operational') when verificationScore is zero, even at a score of 100", () => {
    const { candidate, aggregate } = realisticCandidateAndAggregate();
    const readiness = makeReadiness({ score: 100, implementationScore: 80, executionScore: 80, verificationScore: 0 });
    expect(classifyCapabilityStatus(candidate, aggregate, readiness)).toBe("implemented");
  });
});

describe("classifyCapabilityStatus — execution hard gate applies independent of score", () => {
  it("never returns 'operational' or 'implemented' when implementationScore >= 40 and executionScore === 0, no matter how high the overall score is", () => {
    const { candidate, aggregate } = realisticCandidateAndAggregate();
    const readiness = makeReadiness({ score: 99, implementationScore: 80, executionScore: 0, verificationScore: 80 });
    const status = classifyCapabilityStatus(candidate, aggregate, readiness);
    expect(status).not.toBe("operational");
    expect(status).not.toBe("implemented");
    // Falls through to the ordinary score-threshold ladder instead of being hard-blocked entirely.
    expect(status).toBe("partial");
  });

  it("does not apply the execution hard gate when implementationScore is below 40 (real code, no execution yet, is 'scaffolded'/'planned' territory, not a blocked 'implemented')", () => {
    const { candidate, aggregate } = realisticCandidateAndAggregate();
    const readiness = makeReadiness({ score: 30, implementationScore: 30, executionScore: 0, verificationScore: 0 });
    expect(classifyCapabilityStatus(candidate, aggregate, readiness)).toBe("experimental");
  });
});
