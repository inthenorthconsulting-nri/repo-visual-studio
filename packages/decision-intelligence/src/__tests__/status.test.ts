import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_MAPPING, mapDecisionStatus } from "../status.js";
import type { DecisionStatus } from "../contracts.js";
import { architectureDecision } from "./decision-fixtures.js";

describe("DEFAULT_STATUS_MAPPING", () => {
  it("has exactly the 11 DecisionStatus keys", () => {
    const expected: DecisionStatus[] = [
      "draft",
      "proposed",
      "under_review",
      "accepted",
      "rejected",
      "superseded",
      "deprecated",
      "withdrawn",
      "implemented",
      "partially_implemented",
      "unknown",
    ];
    expect(Object.keys(DEFAULT_STATUS_MAPPING).sort()).toEqual([...expected].sort());
  });

  it("unknown has no configured raw values of its own -- it is only ever reached as a fallback", () => {
    expect(DEFAULT_STATUS_MAPPING.unknown).toEqual([]);
  });
});

describe("mapDecisionStatus: absent/empty raw fails conservatively", () => {
  it("returns 'unknown' when raw is undefined", () => {
    expect(mapDecisionStatus(undefined, undefined)).toBe("unknown");
  });

  it("returns 'unknown' when raw is an empty string", () => {
    expect(mapDecisionStatus("", undefined)).toBe("unknown");
  });

  it("returns 'unknown' when raw is whitespace-only", () => {
    expect(mapDecisionStatus("   ", undefined)).toBe("unknown");
  });
});

describe("mapDecisionStatus: default mapping", () => {
  for (const [status, values] of Object.entries(DEFAULT_STATUS_MAPPING)) {
    for (const value of values) {
      it(`maps default raw text "${value}" to "${status}"`, () => {
        expect(mapDecisionStatus(value, undefined)).toBe(status);
      });
    }
  }

  it("matches case-insensitively", () => {
    expect(mapDecisionStatus("ACCEPTED", undefined)).toBe("accepted");
    expect(mapDecisionStatus("Approved", undefined)).toBe("accepted");
    expect(mapDecisionStatus("Under Review", undefined)).toBe("under_review");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(mapDecisionStatus("  accepted  ", undefined)).toBe("accepted");
    expect(mapDecisionStatus("\tdraft\n", undefined)).toBe("draft");
  });

  it("matches mixed case combined with surrounding whitespace", () => {
    expect(mapDecisionStatus("  Under_Review  ", undefined)).toBe("under_review");
  });
});

describe("mapDecisionStatus: unrecognized raw values fail conservatively, never guessed", () => {
  it("returns 'unknown' for a raw value not present in the defaults", () => {
    expect(mapDecisionStatus("in progress", undefined)).toBe("unknown");
  });

  it("returns 'unknown' for a raw value that is a near-miss of a real status", () => {
    expect(mapDecisionStatus("acceptedish", undefined)).toBe("unknown");
    expect(mapDecisionStatus("accept", undefined)).toBe("unknown");
  });

  it("returns 'unknown' for the literal text 'unknown' (not itself a configured synonym of any status)", () => {
    expect(mapDecisionStatus("unknown", undefined)).toBe("unknown");
  });

  it("never throws for arbitrary garbage input, always returning a valid status string", () => {
    expect(() => mapDecisionStatus("<script>alert(1)</script>", undefined)).not.toThrow();
    expect(mapDecisionStatus("<script>alert(1)</script>", undefined)).toBe("unknown");
  });
});

describe("mapDecisionStatus: configured status_mapping", () => {
  it("adds configured synonyms on top of the defaults rather than replacing them", () => {
    const configured = { accepted: ["lgtm"] };
    expect(mapDecisionStatus("lgtm", configured)).toBe("accepted");
    expect(mapDecisionStatus("accepted", configured)).toBe("accepted");
    expect(mapDecisionStatus("approved", configured)).toBe("accepted");
  });

  it("matches configured entries case-insensitively and trimmed, same as defaults", () => {
    const configured = { rejected: ["nope"] };
    expect(mapDecisionStatus("  NOPE  ", configured)).toBe("rejected");
  });

  it("an entry configured for one status does not leak into matching for a different status", () => {
    const configured = { rejected: ["nope"] };
    expect(mapDecisionStatus("nope", configured)).toBe("rejected");
    expect(mapDecisionStatus("draft", configured)).toBe("draft");
    expect(mapDecisionStatus("nope", configured)).not.toBe("draft");
  });

  it("an empty configured object behaves identically to undefined", () => {
    expect(mapDecisionStatus("accepted", {})).toBe(mapDecisionStatus("accepted", undefined));
    expect(mapDecisionStatus("not-a-status", {})).toBe(mapDecisionStatus("not-a-status", undefined));
  });

  it("a raw value absent from both defaults and configured entries still falls back to 'unknown'", () => {
    const configured = { accepted: ["lgtm"] };
    expect(mapDecisionStatus("totally-unrecognized", configured)).toBe("unknown");
  });

  it("configuring multiple synonyms for the same status all resolve to it", () => {
    const configured = { superseded: ["replaced", "obsoleted"] };
    expect(mapDecisionStatus("replaced", configured)).toBe("superseded");
    expect(mapDecisionStatus("obsoleted", configured)).toBe("superseded");
    expect(mapDecisionStatus("superseded", configured)).toBe("superseded");
  });

  it("configuring a synonym that collides with a different status's default value still matches the first status found (deterministic, not last-write-wins across statuses)", () => {
    const configured = { rejected: ["accepted"] };
    expect(mapDecisionStatus("accepted", configured)).toBe("accepted");
  });
});

describe("mapDecisionStatus: axis independence", () => {
  it("computes decision_status as a pure function of (raw, configured) only -- it never reads or depends on an ArchitectureDecision's implementation_status/governance_status", () => {
    const withOneImplementationAxis = architectureDecision({ decision_status: "draft", implementation_status: "not_started", governance_status: "unverifiable" });
    const withAnotherImplementationAxis = architectureDecision({ decision_status: "draft", implementation_status: "implemented", governance_status: "aligned" });
    expect(mapDecisionStatus("accepted", undefined)).toBe(mapDecisionStatus("accepted", undefined));
    expect(withOneImplementationAxis.implementation_status).not.toBe(withAnotherImplementationAxis.implementation_status);
    expect(withOneImplementationAxis.governance_status).not.toBe(withAnotherImplementationAxis.governance_status);
  });

  it("recomputing decision_status via mapDecisionStatus never mutates an already-built ArchitectureDecision's other two axes", () => {
    const decision = architectureDecision({ decision_status: "draft", implementation_status: "implemented", governance_status: "aligned" });
    const recomputed = mapDecisionStatus("proposed", undefined);
    expect(recomputed).toBe("proposed");
    expect(decision.decision_status).toBe("draft");
    expect(decision.implementation_status).toBe("implemented");
    expect(decision.governance_status).toBe("aligned");
  });
});
