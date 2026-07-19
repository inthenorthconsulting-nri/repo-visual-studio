import { describe, expect, it } from "vitest";
import { aggregateCandidateEvidence } from "../evidence.js";
import { decideCapabilityInclusion } from "../inclusion-policy.js";
import { makeCapabilityCandidate, makeCapabilityEvidence, makeReadiness } from "./fixtures.js";

/**
 * decideCapabilityInclusion() is exercised directly with hand-built
 * (candidate, aggregate, status, readiness) tuples throughout this file —
 * status is a parameter of the function, so these tests can target each
 * branch precisely without having to first reverse-engineer a readiness
 * score that would classify to that exact status via readiness.ts.
 */

describe("decideCapabilityInclusion — gap routing takes priority over everything else", () => {
  it("routes to gap_only whenever the candidate carries a gapStatement, regardless of status", () => {
    const candidate = makeCapabilityCandidate({ gapStatement: { value: "No disaster-recovery runbook exists.", inference: "confirmed", evidence: [{ path: "README.md" }] } });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness());
    expect(decision.inclusion).toBe("gap_only");
    expect(decision.reasonCodes).toEqual([]);
  });
});

describe("decideCapabilityInclusion — contradictory evidence overrides status entirely", () => {
  it("excludes with UNRESOLVED_CONTRADICTORY_EVIDENCE when evidence is contradictory, even for an otherwise-strong status", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("deprecated_marker", { confidence: "suggested" })],
    });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.isContradictory).toBe(true);
    const decision = decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["UNRESOLVED_CONTRADICTORY_EVIDENCE"]);
    expect(decision.confidence).toBe("unresolved");
  });
});

describe("decideCapabilityInclusion — one branch per CapabilityExclusionReasonCode reachable from current inclusion policy", () => {
  it("DEPRECATED_CAPABILITY: status 'deprecated' is always excluded", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("deprecated_marker")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "deprecated", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["DEPRECATED_CAPABILITY"]);
  });

  it("ABANDONED_CAPABILITY: status 'abandoned' is always excluded", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "abandoned", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["ABANDONED_CAPABILITY"]);
  });

  it("INSUFFICIENT_IMPLEMENTATION_EVIDENCE: status 'unknown' is always excluded, with unresolved confidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "unknown", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"]);
    expect(decision.confidence).toBe("unresolved");
  });

  it("INSUFFICIENT_IMPLEMENTATION_EVIDENCE: status 'experimental' is always excluded", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "experimental", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"]);
  });

  it("INSUFFICIENT_IMPLEMENTATION_EVIDENCE: status 'partial' with zero implementation score is excluded", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 0 }));
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"]);
  });

  it("PLANNED_NOT_IMPLEMENTED: status 'planned' with a roadmap-keyword signal routes to roadmap_only, never plain exclude or include", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["planned"], evidence: [makeCapabilityEvidence("documentation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "planned", makeReadiness());
    expect(decision.inclusion).toBe("roadmap_only");
    expect(decision.reasonCodes).toEqual(["PLANNED_NOT_IMPLEMENTED"]);
  });

  it("PLANNED_NOT_IMPLEMENTED: an explicit candidate.roadmapStatement also routes to roadmap_only", () => {
    const candidate = makeCapabilityCandidate({ roadmapStatement: { value: "Multi-region support is planned for a future release.", inference: "confirmed", evidence: [{ path: "README.md" }] } });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "planned", makeReadiness());
    expect(decision.inclusion).toBe("roadmap_only");
  });

  it("DOCUMENTATION_ONLY: status 'planned' without a genuine roadmap-keyword signal (e.g. only a 'todo' marker) is excluded, not promoted to roadmap", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["todo"], evidence: [makeCapabilityEvidence("documentation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "planned", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["DOCUMENTATION_ONLY"]);
  });

  it("SCAFFOLD_ONLY: status 'scaffolded' is always excluded", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "scaffolded", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["SCAFFOLD_ONLY"]);
  });

  it("TEST_ONLY: status 'partial' with test evidence and no implementation/workflow/runtime-entrypoint evidence is excluded — verification alone never proves implementation", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("test")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.hasTest).toBe(true);
    expect(aggregate.hasImplementation).toBe(false);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 5 }));
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["TEST_ONLY"]);
  });

  it("EXTERNAL_RUNTIME_REQUIRED: an otherwise-complete external-runtime-dependent capability is qualified, not fully included, when it has zero adoption evidence", () => {
    const candidate = makeCapabilityCandidate({ isExternalRuntimeDependent: true, evidence: [makeCapabilityEvidence("deployment")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness({ blockers: [], adoptionScore: 0 }));
    expect(decision.inclusion).toBe("include_with_qualification");
    expect(decision.reasonCodes).toEqual(["EXTERNAL_RUNTIME_REQUIRED"]);
  });

  it("EXAMPLE_ONLY: status 'unknown' driven by example-only evidence (no roadmap signal) is excluded with the more precise example-only code, not the generic insufficient-evidence code", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("example")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.isExampleOnly).toBe(true);
    const decision = decideCapabilityInclusion(candidate, aggregate, "unknown", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["EXAMPLE_ONLY"]);
    expect(decision.confidence).toBe("unresolved");
  });

  it("EXAMPLE_ONLY: status 'planned' driven by example-only evidence with no roadmap-keyword signal is excluded as EXAMPLE_ONLY rather than DOCUMENTATION_ONLY", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("example")], matchedIncompleteSignals: ["example only"] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.isExampleOnly).toBe(true);
    const decision = decideCapabilityInclusion(candidate, aggregate, "planned", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["EXAMPLE_ONLY"]);
  });

  it("PLACEHOLDER_IMPLEMENTATION: status 'partial' where placeholder/stub-style signals crush a real implementation score to zero", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["placeholder", "stub"], evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.hasImplementation).toBe(true);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 0 }));
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["PLACEHOLDER_IMPLEMENTATION"]);
  });

  it("INSUFFICIENT_IMPLEMENTATION_EVIDENCE still applies (not PLACEHOLDER_IMPLEMENTATION) when implementation score is zero with no placeholder-style signal", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 0 }));
    expect(decision.reasonCodes).toEqual(["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"]);
  });

  it("DISABLED_CAPABILITY: status 'deprecated' with an explicit 'disabled' signal and no 'deprecated'/'archived' signal uses the more precise disabled code", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["disabled"], evidence: [makeCapabilityEvidence("deprecated_marker")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "deprecated", makeReadiness());
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["DISABLED_CAPABILITY"]);
  });

  it("DEPRECATED_CAPABILITY still applies when a 'disabled' signal coexists with a 'deprecated'/'archived' signal", () => {
    const candidate = makeCapabilityCandidate({ matchedIncompleteSignals: ["disabled", "deprecated"], evidence: [makeCapabilityEvidence("deprecated_marker")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "deprecated", makeReadiness());
    expect(decision.reasonCodes).toEqual(["DEPRECATED_CAPABILITY"]);
  });

  it("NO_EXECUTION_PATH: status 'scaffolded' with real implementation evidence blocked only by a missing execution path is excluded with the precise code, not SCAFFOLD_ONLY", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "scaffolded", makeReadiness({ implementationScore: 45, executionScore: 0 }));
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["NO_EXECUTION_PATH"]);
  });

  it("NO_EXECUTION_PATH: status 'experimental' with real implementation evidence blocked only by a missing execution path is excluded with the precise code, not INSUFFICIENT_IMPLEMENTATION_EVIDENCE", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "experimental", makeReadiness({ implementationScore: 60, executionScore: 0 }));
    expect(decision.inclusion).toBe("exclude");
    expect(decision.reasonCodes).toEqual(["NO_EXECUTION_PATH"]);
  });

  it("NO_EXECUTION_PATH: status 'partial' with real implementation evidence and no execution path is qualified (not fully excluded) but carries the precise code", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 60, executionScore: 0 }));
    expect(decision.inclusion).toBe("include_with_qualification");
    expect(decision.reasonCodes).toEqual(["NO_EXECUTION_PATH"]);
  });

  it("NO_EXECUTION_PATH: an implemented/operational candidate qualified due to a blocker whose readiness carries zero execution score also carries the precise code", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "operational", makeReadiness({ blockers: ["Real implementation evidence exists, but no execution path was found."], executionScore: 0 }));
    expect(decision.inclusion).toBe("include_with_qualification");
    expect(decision.reasonCodes).toEqual(["NO_EXECUTION_PATH"]);
  });
});

describe("decideCapabilityInclusion — conservative-by-default: 'include' is reachable only through a clean implemented/operational path", () => {
  it("qualifies rather than fully includes when readiness carries any blocker, even at status 'operational'", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "operational", makeReadiness({ blockers: ["No automated test evidence was found."] }));
    expect(decision.inclusion).toBe("include_with_qualification");
  });

  it("fully includes only when status is implemented/operational, there are no blockers, and adoption is not a gating concern", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness({ blockers: [] }));
    expect(decision.inclusion).toBe("include");
    expect(decision.reasonCodes).toEqual([]);
  });

  it("status 'partial' with real implementation evidence and no test-only conflict is qualified, never a plain 'include'", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    const decision = decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 60 }));
    expect(decision.inclusion).toBe("include_with_qualification");
  });
});

describe("decideCapabilityInclusion — confidence derivation", () => {
  it("is 'confirmed' with two-or-more confirmed evidence items backed by structural evidence", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("implementation", { confidence: "confirmed" })],
    });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness()).confidence).toBe("confirmed");
  });

  it("is 'derived' with exactly one confirmed structural evidence item", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("documentation", { confidence: "suggested" })],
    });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(decideCapabilityInclusion(candidate, aggregate, "implemented", makeReadiness()).confidence).toBe("derived");
  });

  it("is 'suggested' when no confirmed structural evidence exists but a suggested item does", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation", { confidence: "suggested" })] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 10 })).confidence).toBe("suggested");
  });

  it("is 'unresolved' when evidence exists but is neither confirmed-structural nor suggested", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation", { confidence: "derived" })] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(decideCapabilityInclusion(candidate, aggregate, "partial", makeReadiness({ implementationScore: 10 })).confidence).toBe("unresolved");
  });

  it("is always 'unresolved' when status is 'unknown', regardless of evidence confidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" })] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(decideCapabilityInclusion(candidate, aggregate, "unknown", makeReadiness()).confidence).toBe("unresolved");
  });
});
