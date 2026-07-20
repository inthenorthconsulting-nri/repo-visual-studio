import { describe, expect, it } from "vitest";
import { buildGovernanceLinks, extractExceptions } from "../governance-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";
import type { DecisionStatus } from "../contracts.js";

const NOW = "2026-07-10T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

describe("extractExceptions", () => {
  it("returns [] when governancePolicy is null or not an object", () => {
    expect(extractExceptions(null)).toEqual([]);
    expect(extractExceptions("a string")).toEqual([]);
    expect(extractExceptions(42)).toEqual([]);
  });

  it("returns [] when the exceptions field is missing or not an array", () => {
    expect(extractExceptions({})).toEqual([]);
    expect(extractExceptions({ exceptions: "not-an-array" })).toEqual([]);
  });

  it("filters out non-object entries but keeps well-formed ones", () => {
    const exceptions = extractExceptions({ exceptions: ["a-string", null, { policy_id: "p1", rule_id: "r1" }] });
    expect(exceptions).toEqual([{ policy_id: "p1", rule_id: "r1" }]);
  });
});

describe("buildGovernanceLinks: input gating", () => {
  it("returns [] when the policy has no exceptions array", () => {
    expect(buildGovernanceLinks([architectureDecision()], {}, NOW)).toEqual([]);
  });

  it("returns [] when exceptions is an empty array", () => {
    expect(buildGovernanceLinks([architectureDecision()], { exceptions: [] }, NOW)).toEqual([]);
  });
});

describe("buildGovernanceLinks: decision_ref must already exist -- this module never creates or edits an exception", () => {
  it("produces no link at all for an exception missing decision_ref", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1" }] };
    expect(buildGovernanceLinks([architectureDecision()], policy, NOW)).toEqual([]);
  });

  it("produces no link at all for an exception with a non-string decision_ref", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: 42 }] };
    expect(buildGovernanceLinks([architectureDecision()], policy, NOW)).toEqual([]);
  });

  it("produces no link at all for an exception with a blank decision_ref", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "   " }] };
    expect(buildGovernanceLinks([architectureDecision()], policy, NOW)).toEqual([]);
  });

  it("never mutates the governancePolicy object it was given", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope: undefined, expiry: undefined }] };
    const before = JSON.parse(JSON.stringify(policy));
    const decision = architectureDecision({ id: "decision:test-1" });
    buildGovernanceLinks([decision], policy, NOW);
    expect(policy).toEqual(before);
  });

  it("returns DecisionLink records only -- never anything resembling a mutated/new exception object", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links).toHaveLength(1);
    expect(links[0]).not.toHaveProperty("policy_id");
    expect(links[0]).not.toHaveProperty("scope");
    expect(links[0]).not.toHaveProperty("expiry");
  });
});

describe("buildGovernanceLinks: decision_ref does not match any discovered decision", () => {
  it("produces an unresolved link keyed by the ref, kept in output, with no evidence", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:missing" }] };
    const links = buildGovernanceLinks([architectureDecision({ id: "decision:test-1" })], policy, NOW);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].decision_id).toBe("decision:missing");
    expect(links[0].link_type).toBe("excepts");
    expect(links[0].target_domain).toBe("governance");
    expect(links[0].target_id).toBeUndefined();
    expect(links[0].evidence_refs).toEqual([]);
    expect(links[0].id).toBe(buildLinkId("decision:missing", "excepts", "p1:r1"));
    expect(links[0].detail).toContain("does not match any discovered decision");
  });

  it("builds the exception key from policy_id/rule_id, defaulting missing parts to empty string", () => {
    const policy = { exceptions: [{ decision_ref: "decision:missing" }] };
    const links = buildGovernanceLinks([], policy, NOW);
    expect(links[0].id).toBe(buildLinkId("decision:missing", "excepts", ":"));
  });
});

describe("buildGovernanceLinks: decision status compatibility", () => {
  const compatible: DecisionStatus[] = ["accepted", "implemented", "partially_implemented"];
  const incompatible: DecisionStatus[] = ["draft", "proposed", "under_review", "rejected", "superseded", "deprecated", "withdrawn", "unknown"];

  for (const status of compatible) {
    it(`resolves when decision_status is "${status}" (with no other disqualifying factor)`, () => {
      const decision = architectureDecision({ id: "decision:test-1", decision_status: status });
      const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" }] };
      const links = buildGovernanceLinks([decision], policy, NOW);
      expect(links[0].resolution).toBe("resolved");
    });
  }

  for (const status of incompatible) {
    it(`is incompatible when decision_status is "${status}"`, () => {
      const decision = architectureDecision({ id: "decision:test-1", decision_status: status });
      const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" }] };
      const links = buildGovernanceLinks([decision], policy, NOW);
      expect(links[0].resolution).toBe("incompatible");
      expect(links[0].detail).toContain(`decision status "${status}" cannot back an exception`);
    });
  }
});

describe("buildGovernanceLinks: expiry", () => {
  it("is not expired when expiry is absent", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
  });

  it("is not expired when expiry is not a string (type guard)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", expiry: 12345 }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
  });

  it("is incompatible when expiry is a past date relative to now", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", expiry: PAST }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("incompatible");
    expect(links[0].detail).toContain("the exception has expired");
  });

  it("resolves when expiry is a future date relative to now", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", expiry: FUTURE }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
  });
});

describe("buildGovernanceLinks: scope matching", () => {
  it("matches when scope is absent, non-string, or blank", () => {
    for (const scope of [undefined, "", "   ", 42]) {
      const decision = architectureDecision({ id: "decision:test-1" });
      const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope }] };
      const links = buildGovernanceLinks([decision], policy, NOW);
      expect(links[0].resolution).toBe("resolved");
    }
  });

  it("matches when the scope regex matches the decision id", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope: "^decision:test-1$" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
  });

  it("matches when the scope regex matches the decision's scope field", () => {
    const decision = architectureDecision({ id: "decision:test-1", scope: "component" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope: "^component$" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
  });

  it("is incompatible when the scope regex matches neither the decision id nor its scope field", () => {
    const decision = architectureDecision({ id: "decision:test-1", scope: "component" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope: "^portfolio$" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("incompatible");
    expect(links[0].detail).toContain("the exception's scope does not match this decision");
  });

  it("is incompatible (never assumed a match) when the scope is an invalid regular expression", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", scope: "(unterminated" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("incompatible");
    expect(links[0].detail).toContain("scope does not match");
  });
});

describe("buildGovernanceLinks: combined incompatibility reasons", () => {
  it("joins multiple simultaneous disqualifying reasons with 'and'", () => {
    const decision = architectureDecision({ id: "decision:test-1", decision_status: "draft" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1", expiry: PAST, scope: "^nomatch$" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("incompatible");
    expect(links[0].detail).toContain("decision status \"draft\" cannot back an exception");
    expect(links[0].detail).toContain("the exception has expired");
    expect(links[0].detail).toContain("the exception's scope does not match this decision");
    expect(links[0].detail).toContain(" and ");
  });
});

describe("buildGovernanceLinks: resolved output shape", () => {
  it("produces a resolved link with targetId = exceptionKey, decision_id = decision.id, and the decision's evidence_refs", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ id: "decision:test-1", evidence_refs: refs });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" }] };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("p1:r1");
    expect(links[0].decision_id).toBe("decision:test-1");
    expect(links[0].link_type).toBe("excepts");
    expect(links[0].target_domain).toBe("governance");
    expect(links[0].evidence_refs).toBe(refs);
    expect(links[0].id).toBe(buildLinkId("decision:test-1", "excepts", "p1:r1"));
    expect(links[0].detail).toBe('Decision "decision:test-1" supports governance exception "p1:r1".');
  });
});

describe("buildGovernanceLinks: multiple exceptions", () => {
  it("processes each exception independently and keeps every resulting link, including unresolved ones", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const policy = {
      exceptions: [
        { policy_id: "p1", rule_id: "r1", decision_ref: "decision:test-1" },
        { policy_id: "p2", rule_id: "r2", decision_ref: "decision:unknown" },
        { policy_id: "p3", rule_id: "r3" },
      ],
    };
    const links = buildGovernanceLinks([decision], policy, NOW);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.resolution).sort()).toEqual(["resolved", "unresolved"]);
  });
});
