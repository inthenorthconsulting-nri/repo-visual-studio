import { describe, expect, it } from "vitest";
import { aggregateCandidateEvidence } from "../evidence.js";
import { assessCapabilityMaturity } from "../maturity.js";
import { makeCapabilityCandidate, makeCapabilityEvidence } from "./fixtures.js";

function maturityFor(candidate: ReturnType<typeof makeCapabilityCandidate>) {
  return assessCapabilityMaturity(candidate, aggregateCandidateEvidence(candidate));
}

describe("scoreImplementation (via assessCapabilityMaturity)", () => {
  it("is zero when the candidate is documentation-only, even with many documentation items", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation"), makeCapabilityEvidence("documentation", { sourcePath: "docs/x.md" })] });
    expect(maturityFor(candidate).implementation).toBe(0);
  });

  it("is zero when there is no implementation, configuration, workflow, or runtime-entrypoint evidence at all", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("test")] });
    expect(maturityFor(candidate).implementation).toBe(0);
  });

  it("rewards implementation, configuration, schema, and an execution signal together", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("configuration"), makeCapabilityEvidence("schema"), makeCapabilityEvidence("workflow")],
    });
    // 45 (implementation) + 15 (configuration) + 10 (schema) + 25 (workflow) + min(1*3, 15) (item bonus) = 98
    expect(maturityFor(candidate).implementation).toBe(98);
  });

  it("penalizes scaffold/stub/placeholder/not-implemented incomplete signals by 25 points each", () => {
    const candidate = makeCapabilityCandidate({
      matchedIncompleteSignals: ["scaffold", "stub"],
      evidence: [makeCapabilityEvidence("implementation")],
    });
    // base 45, no execution signal, minus 2*25 = -50 -> clamped to 0
    expect(maturityFor(candidate).implementation).toBe(0);
  });

  it("a single scaffold signal only partially erodes an otherwise-strong implementation score", () => {
    const candidate = makeCapabilityCandidate({
      matchedIncompleteSignals: ["placeholder"],
      evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("workflow")],
    });
    // 45 + 25 + min(1*3, 15) - 25 = 48
    expect(maturityFor(candidate).implementation).toBe(48);
  });

  it("penalizes a deprecated marker by 30 points", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("workflow"), makeCapabilityEvidence("deprecated_marker")],
    });
    // 45 + 25 + min(1*3, 15) - 30 = 43
    expect(maturityFor(candidate).implementation).toBe(43);
  });

  it("caps the per-implementation-item count bonus at 15 points", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [
        makeCapabilityEvidence("implementation", { sourcePath: "a.ts" }),
        makeCapabilityEvidence("implementation", { sourcePath: "b.ts" }),
        makeCapabilityEvidence("implementation", { sourcePath: "c.ts" }),
        makeCapabilityEvidence("implementation", { sourcePath: "d.ts" }),
        makeCapabilityEvidence("implementation", { sourcePath: "e.ts" }),
        makeCapabilityEvidence("implementation", { sourcePath: "f.ts" }),
        makeCapabilityEvidence("workflow"),
      ],
    });
    // 45 (implementation) + 25 (workflow) + min(6*3, 15) = 45 + 25 + 15 = 85
    expect(maturityFor(candidate).implementation).toBe(85);
  });
});

describe("scoreExecution (via assessCapabilityMaturity)", () => {
  it("is zero with no runtime entrypoint, workflow, deployment, or release evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    expect(maturityFor(candidate).execution).toBe(0);
  });

  it("sums runtime entrypoint, workflow, deployment, and release contributions, clamped to 100", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("runtime_entrypoint"), makeCapabilityEvidence("workflow"), makeCapabilityEvidence("deployment"), makeCapabilityEvidence("release")],
    });
    expect(maturityFor(candidate).execution).toBe(100); // 55+55+30+15=155 clamped
  });

  it("a deprecated marker reduces the execution score by 40", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("deployment"), makeCapabilityEvidence("deprecated_marker")] });
    expect(maturityFor(candidate).execution).toBe(0); // 30 - 40 clamped to 0
  });
});

describe("scoreVerification (via assessCapabilityMaturity)", () => {
  it("is zero with no test evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    expect(maturityFor(candidate).verification).toBe(0);
  });

  it("weighs a strong test (strength >= 4) more than a weak one", () => {
    const strong = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("test", { strength: 4 })] });
    const weak = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("test", { strength: 1 })] });
    expect(maturityFor(strong).verification).toBe(55);
    expect(maturityFor(weak).verification).toBe(25);
  });

  it("clamps a large number of strong tests to 100", () => {
    const candidate = makeCapabilityCandidate({
      evidence: Array.from({ length: 5 }, (_, i) => makeCapabilityEvidence("test", { strength: 4, sourcePath: `test-${i}.ts` })),
    });
    expect(maturityFor(candidate).verification).toBe(100);
  });
});

describe("scoreDocumentation (via assessCapabilityMaturity)", () => {
  it("is zero with no documentation evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    expect(maturityFor(candidate).documentation).toBe(0);
  });

  it("scores higher when documentation coexists with implementation/workflow support than when it stands alone", () => {
    const supported = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation"), makeCapabilityEvidence("implementation")] });
    const unsupported = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation")] });
    expect(maturityFor(supported).documentation).toBeGreaterThan(maturityFor(unsupported).documentation);
  });
});

describe("scoreAdoption (via assessCapabilityMaturity)", () => {
  it("is zero with no usage, release, or deployment evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    expect(maturityFor(candidate).adoption).toBe(0);
  });

  it("sums usage and release contributions; deployment evidence does not count toward adoption (it already scores execution)", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("usage"), makeCapabilityEvidence("release"), makeCapabilityEvidence("deployment")] });
    expect(maturityFor(candidate).adoption).toBe(90); // 60+30, deployment excluded
  });
});

describe("hard-gate blockers and qualifiers", () => {
  it("blocks when implementation is real but there is no execution path at all", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("configuration")] });
    const maturity = maturityFor(candidate);
    expect(maturity.implementation).toBeGreaterThanOrEqual(40);
    expect(maturity.execution).toBe(0);
    expect(maturity.blockers.some((b) => /no execution path/i.test(b))).toBe(true);
  });

  it("qualifies (does not block) when implementation is real but there is no test evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("workflow")] });
    const maturity = maturityFor(candidate);
    expect(maturity.qualifiers.some((q) => /no automated test evidence/i.test(q))).toBe(true);
    expect(maturity.blockers).toEqual([]);
  });

  it("blocks on contradictory evidence", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("deprecated_marker", { confidence: "suggested" })],
    });
    expect(maturityFor(candidate).blockers.some((b) => /contradictory/i.test(b))).toBe(true);
  });

  it("blocks on documentation-only evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation")] });
    expect(maturityFor(candidate).blockers.some((b) => /only documentation evidence/i.test(b))).toBe(true);
  });

  it("qualifies an external-runtime-dependent candidate with zero adoption evidence, without requiring adoption evidence for all repository types", () => {
    const candidate = makeCapabilityCandidate({ isExternalRuntimeDependent: true, evidence: [makeCapabilityEvidence("deployment")] });
    const maturity = maturityFor(candidate);
    expect(maturity.adoption).toBe(0);
    expect(maturity.qualifiers.some((q) => /external runtime/i.test(q))).toBe(true);
    // Crucially: this is a qualifier, not a blocker — lacking adoption evidence must not hard-block inclusion.
    expect(maturity.blockers).toEqual([]);
  });
});
