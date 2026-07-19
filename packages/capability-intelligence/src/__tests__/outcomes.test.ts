import { describe, expect, it } from "vitest";
import { aggregateCandidateEvidence } from "../evidence.js";
import { deriveCapabilityOutcome } from "../outcomes.js";
import { makeCapabilityCandidate, makeCapabilityEvidence, stmt } from "./fixtures.js";

describe("deriveCapabilityOutcome — inference gate", () => {
  it("returns undefined when the source statement is only 'suggested', not confirmed/derived", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("Synchronizes widget inventory across regions.", "suggested") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });

  it("returns undefined when the source statement is 'unresolved'", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("Synchronizes widget inventory across regions.", "unresolved") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });

  it("accepts a 'derived' source statement, not only 'confirmed'", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("Synchronizes widget inventory across regions on a fixed schedule.", "derived") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("Synchronizes widget inventory across regions on a fixed schedule.");
  });
});

describe("deriveCapabilityOutcome — source selection", () => {
  it("prefers candidate.outcome over candidate.purpose when both are present", () => {
    const candidate = makeCapabilityCandidate({
      purpose: stmt("Synchronizes widget inventory across regions."),
      outcome: stmt("Reduces manual widget reconciliation effort for the operations team."),
    });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("Reduces manual widget reconciliation effort for the operations team.");
  });

  it("falls back to candidate.purpose when candidate.outcome is absent", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("Synchronizes widget inventory across regions."), outcome: undefined });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("Synchronizes widget inventory across regions.");
  });
});

describe("deriveCapabilityOutcome — empty/noise text yields no outcome", () => {
  it("returns undefined when the compressed claim is empty (e.g. the text is pure Markdown table noise)", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("| --- | --- |\n| --- | --- |") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });
});

describe("deriveCapabilityOutcome — generic marketing filler is rejected", () => {
  it("returns undefined for a generic 'improves efficiency' style claim", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("This capability improves efficiency across the organization.") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });

  it("returns undefined for a generic 'streamlines workflows' style claim", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("It streamlines workflows for every team that adopts it.") });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });
});

describe("deriveCapabilityOutcome — unsupported production/scale claims are rejected", () => {
  it("returns undefined for a 'used in production' claim when there is no release/deployment/usage evidence", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("This widget sync path is used in production today."), evidence: [makeCapabilityEvidence("implementation")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBeUndefined();
  });

  it("keeps a 'used in production' claim when usage evidence backs it up", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("This widget sync path is used in production today."), evidence: [makeCapabilityEvidence("usage")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("This widget sync path is used in production today.");
  });

  it("keeps a 'used in production' claim when deployment evidence backs it up", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("This widget sync path runs in production."), evidence: [makeCapabilityEvidence("deployment")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("This widget sync path runs in production.");
  });

  it("keeps a 'used in production' claim when release evidence backs it up", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("This widget sync path runs in production."), evidence: [makeCapabilityEvidence("release")] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("This widget sync path runs in production.");
  });

  it("does not gate ordinary claims that never mention production/scale, even with zero production evidence", () => {
    const candidate = makeCapabilityCandidate({ purpose: stmt("Synchronizes widget inventory across regions on a fixed schedule."), evidence: [] });
    const aggregate = aggregateCandidateEvidence(candidate);
    expect(deriveCapabilityOutcome(candidate, aggregate)).toBe("Synchronizes widget inventory across regions on a fixed schedule.");
  });
});
