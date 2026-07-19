import { describe, expect, it } from "vitest";
import { aggregateCandidateEvidence } from "../evidence.js";
import { makeCapabilityCandidate, makeCapabilityEvidence } from "./fixtures.js";

describe("aggregateCandidateEvidence", () => {
  it("sums evidence strength across all items", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { strength: 5 }), makeCapabilityEvidence("implementation", { strength: 4 })],
    });
    expect(aggregateCandidateEvidence(candidate).totalStrength).toBe(9);
  });

  it("buckets evidence by type and sets the matching has* flags", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation"), makeCapabilityEvidence("test")],
    });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.hasWorkflow).toBe(true);
    expect(aggregate.hasImplementation).toBe(true);
    expect(aggregate.hasTest).toBe(true);
    expect(aggregate.hasDeployment).toBe(false);
    expect(aggregate.byType.workflow).toHaveLength(1);
  });

  it("classifies a documentation-only candidate correctly (no structural evidence at all)", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.isDocumentationOnly).toBe(true);
    expect(aggregate.isExampleOnly).toBe(false);
  });

  it("does not classify a candidate with any structural evidence as documentation-only, even alongside documentation evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("documentation"), makeCapabilityEvidence("implementation")] });
    expect(aggregateCandidateEvidence(candidate).isDocumentationOnly).toBe(false);
  });

  it("classifies an example-only candidate correctly", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("example")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(aggregate.isExampleOnly).toBe(true);
    expect(aggregate.isDocumentationOnly).toBe(true);
  });

  it("a candidate with zero evidence is not documentation-only (nothing to be documentation-only about)", () => {
    const candidate = makeCapabilityCandidate({ evidence: [] });
    expect(aggregateCandidateEvidence(candidate).isDocumentationOnly).toBe(false);
  });

  it("meetsStrongConfirmation requires execution + implementation + test, or workflow + implementation + configuration", () => {
    const strongByTest = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("runtime_entrypoint"), makeCapabilityEvidence("implementation"), makeCapabilityEvidence("test")],
    });
    expect(aggregateCandidateEvidence(strongByTest).meetsStrongConfirmation).toBe(true);

    const strongByConfiguration = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation"), makeCapabilityEvidence("configuration")],
    });
    expect(aggregateCandidateEvidence(strongByConfiguration).meetsStrongConfirmation).toBe(true);
  });

  it("a single strong evidence item alone never meets strong confirmation", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow")] });
    expect(aggregateCandidateEvidence(candidate).meetsStrongConfirmation).toBe(false);
  });

  it("meetsPartialConfirmation requires implementation + test with no execution evidence", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("test")] });
    expect(aggregateCandidateEvidence(candidate).meetsPartialConfirmation).toBe(true);
  });

  it("meetsPartialConfirmation is false once execution evidence is present (that's strong, not partial, territory)", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("test"), makeCapabilityEvidence("workflow")],
    });
    expect(aggregateCandidateEvidence(candidate).meetsPartialConfirmation).toBe(false);
  });

  it("flags contradictory evidence: a confirmed deprecated marker coexisting with confirmed structural evidence", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("deprecated_marker", { confidence: "suggested" })],
    });
    expect(aggregateCandidateEvidence(candidate).isContradictory).toBe(true);
  });

  it("does not flag contradictory evidence when the deprecated marker is the only confirmed-looking evidence", () => {
    const candidate = makeCapabilityCandidate({
      evidence: [makeCapabilityEvidence("workflow", { confidence: "suggested" }), makeCapabilityEvidence("deprecated_marker", { confidence: "confirmed" })],
    });
    expect(aggregateCandidateEvidence(candidate).isContradictory).toBe(false);
  });

  it("does not flag contradictory evidence when there is no deprecated marker at all", () => {
    const candidate = makeCapabilityCandidate({ evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
    expect(aggregateCandidateEvidence(candidate).isContradictory).toBe(false);
  });
});
