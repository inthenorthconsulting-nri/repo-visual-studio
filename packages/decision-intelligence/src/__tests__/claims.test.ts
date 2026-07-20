import { describe, expect, it } from "vitest";
import { classifyDecisionClaim, draftStandardDecisionClaims, type DecisionClaimContext } from "../claims.js";
import { buildClaimId } from "../ids.js";
import { architectureDecision, decisionAssumption, decisionClaimDraft, decisionConflict, decisionLink, decisionSupersessionIssue } from "./decision-fixtures.js";

function baseContext(overrides: Partial<DecisionClaimContext> = {}): DecisionClaimContext {
  const decision = architectureDecision({ id: "decision:test-1" });
  return {
    decisionsById: new Map([[decision.id, decision]]),
    assumptions: [],
    conflicts: [],
    supersessionIssues: [],
    links: [],
    snapshotCompatibility: "complete",
    ...overrides,
  };
}

describe("classifyDecisionClaim: unconditional structural gates", () => {
  it("partial_snapshot: rejects any claim when snapshotCompatibility is 'partial'", () => {
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ snapshotCompatibility: "partial" }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("partial_snapshot");
  });

  it("incompatible_upstream_artifact: rejects any claim when snapshotCompatibility is 'unavailable'", () => {
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ snapshotCompatibility: "unavailable" }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("incompatible_upstream_artifact");
  });

  it("missing_decision_evidence: rejects when neither the decision nor the draft carries any evidence", () => {
    const decision = architectureDecision({ id: "decision:test-1", evidence_refs: [] });
    const result = classifyDecisionClaim(decisionClaimDraft({ subject_decision_id: decision.id, evidence_refs: [] }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("missing_decision_evidence");
  });

  it("broken_supersession: rejects when the subject decision is named in a supersession issue", () => {
    const issue = decisionSupersessionIssue({ decision_ids: ["decision:test-1"] });
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ supersessionIssues: [issue] }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("broken_supersession");
  });

  it("contradicted_assumption: rejects when an assumption of the subject decision is contradicted", () => {
    const assumption = decisionAssumption({ decision_id: "decision:test-1", state: "contradicted" });
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ assumptions: [assumption] }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("contradicted_assumption");
  });

  it("unresolved_conflict: rejects when a non-resolved conflict names the subject decision", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:test-1", "decision:test-2"], status: "confirmed" });
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ conflicts: [conflict] }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toContain("unresolved_conflict");
  });

  it("does not treat a resolved conflict naming the subject decision as an unresolved_conflict gate hit", () => {
    const conflict = decisionConflict({ decision_ids: ["decision:test-1", "decision:test-2"], status: "resolved" });
    const result = classifyDecisionClaim(decisionClaimDraft({ evidence_refs: [{ path: "x", source_artifact: "decision" }] }), baseContext({ conflicts: [conflict] }));
    expect(result.rejection_codes).not.toContain("unresolved_conflict");
  });

  it("collects multiple independent gate codes at once rather than short-circuiting on the first", () => {
    const assumption = decisionAssumption({ decision_id: "decision:test-1", state: "contradicted" });
    const conflict = decisionConflict({ decision_ids: ["decision:test-1", "decision:test-2"], status: "confirmed" });
    const decision = architectureDecision({ id: "decision:test-1", evidence_refs: [] });
    const result = classifyDecisionClaim(decisionClaimDraft({ subject_decision_id: decision.id, evidence_refs: [] }), baseContext({ decisionsById: new Map([[decision.id, decision]]), assumptions: [assumption], conflicts: [conflict] }));
    expect(result.rejection_codes).toEqual(["contradicted_assumption", "missing_decision_evidence", "unresolved_conflict"]);
  });
});

describe("classifyDecisionClaim: claim-type-specific checks", () => {
  it("decision_approved: approves when decision_status is accepted/implemented/partially_implemented", () => {
    for (const status of ["accepted", "implemented", "partially_implemented"] as const) {
      const decision = architectureDecision({ id: "decision:test-1", decision_status: status });
      const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_approved", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
      expect(result.rejection_codes).not.toContain("unsupported_approval_claim");
    }
  });

  it("decision_approved: unsupported_approval_claim when decision_status is not one of the accepted-family values", () => {
    const decision = architectureDecision({ id: "decision:test-1", decision_status: "draft" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_approved", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.rejection_codes).toContain("unsupported_approval_claim");
  });

  it("decision_implemented: unresolved_implementation_state when implementation_status is 'unverifiable'", () => {
    const decision = architectureDecision({ id: "decision:test-1", implementation_status: "unverifiable" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_implemented", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.rejection_codes).toContain("unresolved_implementation_state");
  });

  it("decision_implemented: unsupported_implementation_claim when implementation_status is anything but 'implemented' (and not unverifiable)", () => {
    const decision = architectureDecision({ id: "decision:test-1", implementation_status: "not_started" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_implemented", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.rejection_codes).toContain("unsupported_implementation_claim");
  });

  it("decision_implemented: approves when implementation_status is 'implemented'", () => {
    const decision = architectureDecision({ id: "decision:test-1", implementation_status: "implemented" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_implemented", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.rejection_codes).not.toContain("unsupported_implementation_claim");
    expect(result.rejection_codes).not.toContain("unresolved_implementation_state");
  });

  it("decision_quality: always rejects with unsupported_quality_claim, regardless of decision state", () => {
    const decision = architectureDecision({ id: "decision:test-1", decision_status: "accepted", implementation_status: "implemented" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_quality", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toEqual(["unsupported_quality_claim"]);
  });

  it("decision_safety: always rejects with unsupported_safety_claim, regardless of decision state", () => {
    const decision = architectureDecision({ id: "decision:test-1", decision_status: "accepted", implementation_status: "implemented" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "decision_safety", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.status).toBe("rejected");
    expect(result.rejection_codes).toEqual(["unsupported_safety_claim"]);
  });

  for (const [claimType, domain, code] of [
    ["architecture_linked", "architecture", "missing_architecture_link"],
    ["capability_linked", "capability", "missing_capability_link"],
    ["governance_linked", "governance", "missing_governance_link"],
  ] as const) {
    it(`${claimType}: rejects with ${code} when no resolved link to ${domain} exists`, () => {
      const decision = architectureDecision({ id: "decision:test-1" });
      const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: claimType, subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
      expect(result.rejection_codes).toContain(code);
    });

    it(`${claimType}: does not reject on link grounds when a resolved link to ${domain} exists`, () => {
      const decision = architectureDecision({ id: "decision:test-1" });
      const link = decisionLink({ decision_id: decision.id, target_domain: domain, resolution: "resolved" });
      const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: claimType, subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]), links: [link] }));
      expect(result.rejection_codes).not.toContain(code);
    });
  }

  it("an unrecognized claim_type passes through the gates but triggers no claim-type-specific rejection", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "some_unknown_claim_type", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.status).toBe("approved");
  });
});

describe("classifyDecisionClaim: approved vs. qualified", () => {
  it("approves a claim with zero collected codes and no soft signal", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "assumptions_hold", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.status).toBe("approved");
    expect(result.rejection_codes).toEqual([]);
  });

  it("qualifies (status only, no rejection codes) when the subject decision has a weakened assumption", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const assumption = decisionAssumption({ decision_id: decision.id, state: "weakened" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "assumptions_hold", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]), assumptions: [assumption] }));
    expect(result.status).toBe("qualified");
    expect(result.rejection_codes).toEqual([]);
  });

  it("qualifies when the subject decision has a partially_resolved link", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const link = decisionLink({ decision_id: decision.id, resolution: "partially_resolved" });
    const result = classifyDecisionClaim(decisionClaimDraft({ claim_type: "assumptions_hold", subject_decision_id: decision.id }), baseContext({ decisionsById: new Map([[decision.id, decision]]), links: [link] }));
    expect(result.status).toBe("qualified");
  });
});

describe("classifyDecisionClaim: id derivation and passthrough fields", () => {
  it("derives id via buildClaimId(claim_type, subject_decision_id)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const draft = decisionClaimDraft({ claim_type: "decision_approved", subject_decision_id: decision.id, statement: "Statement text." });
    const result = classifyDecisionClaim(draft, baseContext({ decisionsById: new Map([[decision.id, decision]]) }));
    expect(result.id).toBe(buildClaimId("decision_approved", decision.id));
    expect(result.statement).toBe("Statement text.");
    expect(result.claim_type).toBe("decision_approved");
    expect(result.subject_decision_id).toBe(decision.id);
  });
});

describe("draftStandardDecisionClaims", () => {
  it("generates exactly 5 fixed drafts, one per universally-applicable recognized claim type", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const drafts = draftStandardDecisionClaims(decision);
    expect(drafts).toHaveLength(5);
    expect(new Set(drafts.map((d) => d.claim_type))).toEqual(new Set(["decision_approved", "decision_implemented", "assumptions_hold", "no_unresolved_conflicts", "supersession_valid"]));
    expect(drafts.every((d) => d.subject_decision_id === decision.id)).toBe(true);
  });

  it("is deterministic: calling it twice over the same decision produces identical drafts", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const first = draftStandardDecisionClaims(decision);
    const second = draftStandardDecisionClaims(decision);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
