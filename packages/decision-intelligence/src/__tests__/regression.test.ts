import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../snapshot.js";
import { diffDecisions } from "../diff.js";
import { assessDecisionSnapshotCompatibility } from "../compatibility.js";
import { detectDecisionIdentityIssues, type ResolvedDecisionSourceRecord } from "../identity.js";
import { buildDecisionSupersession } from "../supersession.js";
import { buildDecisionConflicts } from "../conflicts.js";
import { buildDecisionDependencies, type DeclaredDependency } from "../dependencies.js";
import { classifyDecisionCriticality } from "../criticality.js";
import { buildDecisionImplementationStates } from "../implementation-state.js";
import { detectMissingImplementation } from "../missing-implementation.js";
import { detectMissingDecisions, type MissingDecisionRuleInput } from "../missing-decisions.js";
import { buildGovernanceLinks } from "../governance-links.js";
import { detectDecisionDrift, type DecisionDriftInputs, type DecisionDriftPreviousState } from "../decision-drift.js";
import { detectDecisionDebt, type DecisionDebtInputs } from "../decision-debt.js";
import { buildDecisionCoverage, type CoverageInputs } from "../coverage.js";
import { buildDecisionGovernanceContext } from "../governance-policy-extension.js";
import { classifyDecisionClaim, draftStandardDecisionClaims, type DecisionClaimContext } from "../claims.js";
import { buildDecisionPlan, type BuildDecisionPlanInput } from "../decision-plan.js";
import { buildDecisionNarrative, type BuildDecisionNarrativeInput } from "../narrative.js";
import { assessDecisionBlastRadius, type BlastRadiusInputs } from "../blast-radius.js";
import type { ArchitectureDecision, DecisionGovernanceStatus } from "../contracts.js";
import { architectureDecision, decisionAssumption, decisionLink, decisionSource, GENERATED_AT } from "./decision-fixtures.js";

function emptyCriticalityMap(decisions: ArchitectureDecision[]): Map<string, "standard"> {
  return new Map(decisions.map((d) => [d.id, "standard" as const]));
}

function emptyGovernanceMap(decisions: ArchitectureDecision[]): Map<string, DecisionGovernanceStatus | undefined> {
  return new Map(decisions.map((d) => [d.id, undefined]));
}

describe("regression: decision discovery and snapshot assembly", () => {
  it("no decisions present -- snapshot is empty and the plan degrades to the hero + validation scenes only", () => {
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-empty", generatedAt: GENERATED_AT, decisions: [], sourceIssues: [] });
    expect(snapshot.decisions).toEqual([]);

    const narrative = buildDecisionNarrative({ snapshot, implementationStates: [], assumptions: [], conflicts: [], supersessionIssues: [], coverage: [], debtFindings: [], drift: [], generatedAt: GENERATED_AT });
    const plan = buildDecisionPlan({ snapshot, narrative, links: [], implementationStates: [], assumptions: [], supersessionIssues: [], supersessionChains: [], conflicts: [], coverage: [], drift: [], debtFindings: [], generatedAt: GENERATED_AT });

    const kinds = plan.scenes.map((s) => s.kind);
    expect(kinds).toContain("decision-hero");
    expect(kinds).not.toContain("decision-landscape");
    expect(kinds).not.toContain("decision-status");
  });

  it("a single valid ADR is discovered and classified into a snapshot", () => {
    const decision = architectureDecision({ id: "decision:adr-only", source: decisionSource({ source_type: "adr" }) });
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-single", generatedAt: GENERATED_AT, decisions: [decision], sourceIssues: [] });
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisions[0]!.source.source_type).toBe("adr");
  });

  it("mixed ADR and RFC sources coexist in one snapshot without conflict", () => {
    const adr = architectureDecision({ id: "decision:mixed-adr", source: decisionSource({ source_type: "adr" }) });
    const rfc = architectureDecision({ id: "decision:mixed-rfc", source: decisionSource({ source_type: "rfc" }) });
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-mixed", generatedAt: GENERATED_AT, decisions: [adr, rfc], sourceIssues: [] });
    expect(snapshot.decisions.map((d) => d.source.source_type).sort()).toEqual(["adr", "rfc"]);
    expect(snapshot.compatibility).toBe("unavailable");
  });

  it("duplicate decision id (exact) is reported by detectDecisionIdentityIssues, not silently merged", () => {
    const records: ResolvedDecisionSourceRecord[] = [
      { id: "decision:dup-exact", repo_relative_path: "docs/adr/0010-a.md", content_digest: "d1", evidence_refs: [] },
      { id: "decision:dup-exact", repo_relative_path: "docs/adr/0010-b.md", content_digest: "d2", evidence_refs: [] },
    ];
    const issues = detectDecisionIdentityIssues(records);
    expect(issues.map((i) => i.kind)).toContain("multiple_files_claim_one_id");
  });
});

describe("regression: supersession", () => {
  it("a valid 2-decision supersession chain is reported as a single valid chain, oldest first", () => {
    const oldDecision = architectureDecision({ id: "decision:sup-old", decision_status: "superseded", superseded_by: ["decision:sup-new"] });
    const newDecision = architectureDecision({ id: "decision:sup-new", decision_status: "accepted", supersedes: ["decision:sup-old"] });
    const evidenceMap = new Map([[oldDecision.id, oldDecision.evidence_refs], [newDecision.id, newDecision.evidence_refs]]);

    const { issues, chains } = buildDecisionSupersession([oldDecision, newDecision], evidenceMap);

    expect(issues).toEqual([]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.is_valid).toBe(true);
    expect(chains[0]!.decision_ids_in_order).toEqual(["decision:sup-old", "decision:sup-new"]);
  });

  it("a cyclic (invalid) supersession chain is flagged with a supersession_cycle issue and marks its chain invalid", () => {
    const a = architectureDecision({ id: "decision:cyc-a", decision_status: "accepted", supersedes: ["decision:cyc-b"], superseded_by: ["decision:cyc-b"] });
    const b = architectureDecision({ id: "decision:cyc-b", decision_status: "accepted", supersedes: ["decision:cyc-a"], superseded_by: ["decision:cyc-a"] });
    const evidenceMap = new Map([[a.id, a.evidence_refs], [b.id, b.evidence_refs]]);

    const { issues } = buildDecisionSupersession([a, b], evidenceMap);

    expect(issues.map((i) => i.kind)).toContain("supersession_cycle");
  });

  it("a missing supersession target is flagged, and detectDecisionDrift emits supersession_target_removed for it", () => {
    const orphan = architectureDecision({ id: "decision:missing-target", decision_status: "accepted", supersedes: ["decision:does-not-exist"] });
    const evidenceMap = new Map([[orphan.id, orphan.evidence_refs]]);

    const { issues } = buildDecisionSupersession([orphan], evidenceMap);
    expect(issues.map((i) => i.kind)).toContain("missing_target");

    const inputs: DecisionDriftInputs = {
      decisions: [orphan],
      assumptions: [],
      links: [],
      conflicts: [],
      supersessionIssues: issues,
      sourceIssues: [],
      criticalityByDecisionId: emptyCriticalityMap([orphan]),
      implementationStatusByDecisionId: new Map([[orphan.id, "not_started"]]),
      governanceStatusByDecisionId: emptyGovernanceMap([orphan]),
    };
    const drift = detectDecisionDrift(inputs);
    expect(drift.map((d) => d.cause)).toContain("supersession_target_removed");
  });

  it("multiple active superseders claiming the same target is flagged as multiple_active_superseders", () => {
    const target = architectureDecision({ id: "decision:multi-target", decision_status: "superseded" });
    const superseder1 = architectureDecision({ id: "decision:multi-1", decision_status: "accepted", supersedes: ["decision:multi-target"] });
    const superseder2 = architectureDecision({ id: "decision:multi-2", decision_status: "accepted", supersedes: ["decision:multi-target"] });
    const evidenceMap = new Map([target, superseder1, superseder2].map((d) => [d.id, d.evidence_refs]));

    const { issues } = buildDecisionSupersession([target, superseder1, superseder2], evidenceMap);
    expect(issues.map((i) => i.kind)).toContain("multiple_active_superseders");
  });
});

describe("regression: implementation and missing-implementation", () => {
  it("an accepted decision that has become fully implemented (decision_status: implemented) with a resolved implements link reports status implemented", () => {
    const decision = architectureDecision({ id: "decision:impl-full", decision_status: "implemented" });
    const link = decisionLink({ decision_id: decision.id, link_type: "implements", target_domain: "architecture", target_id: "component:x", resolution: "resolved" });

    const states = buildDecisionImplementationStates([decision], [link], { hasUpstreamEvidence: true });
    expect(states[0]!.status).toBe("implemented");
    expect(detectMissingImplementation(states)).toEqual([]);
  });

  it("an accepted decision with no implementation evidence reports not_started and surfaces as implementation_missing", () => {
    const decision = architectureDecision({ id: "decision:impl-missing", decision_status: "accepted" });
    const states = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    expect(states[0]!.status).toBe("not_started");

    const findings = detectMissingImplementation(states);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe("implementation_missing");
  });

  it("that same accepted-without-implementation decision produces an accepted_without_implementation debt finding", () => {
    const decision = architectureDecision({ id: "decision:impl-debt", decision_status: "accepted" });
    const states = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });

    const debt = detectDecisionDebt({
      decisions: [decision],
      implementationStates: states,
      drift: [],
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      assumptions: [],
      sourceIssues: [],
      links: [],
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      now: GENERATED_AT,
    });

    expect(debt.map((f) => f.category)).toContain("accepted_without_implementation");
  });

  it("no upstream evidence at all (hasUpstreamEvidence: false) yields unverifiable, never a silently-assumed not_started", () => {
    const decision = architectureDecision({ id: "decision:impl-unverifiable", decision_status: "accepted" });
    const states = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: false });
    expect(states[0]!.status).toBe("unverifiable");
  });
});

describe("regression: assumptions, conflicts, and drift", () => {
  it("a contradicted assumption produces both an assumption_contradicted drift entry and a contradicted_assumption_unaddressed debt finding", () => {
    const decision = architectureDecision({ id: "decision:contradicted", decision_status: "accepted" });
    const assumption = decisionAssumption({ decision_id: decision.id, state: "contradicted" });

    const driftInputs: DecisionDriftInputs = {
      decisions: [decision],
      assumptions: [assumption],
      links: [],
      conflicts: [],
      supersessionIssues: [],
      sourceIssues: [],
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      implementationStatusByDecisionId: new Map([[decision.id, "not_started"]]),
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
    };
    const drift = detectDecisionDrift(driftInputs);
    expect(drift.map((d) => d.cause)).toContain("assumption_contradicted");

    const debt = detectDecisionDebt({
      decisions: [decision],
      implementationStates: [],
      drift: [],
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      assumptions: [assumption],
      sourceIssues: [],
      links: [],
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      now: GENERATED_AT,
    });
    expect(debt.map((f) => f.category)).toContain("contradicted_assumption_unaddressed");
  });

  it("an active decision reciprocally superseded by another active decision is a confirmed active_and_superseded_simultaneously conflict", () => {
    const superseded = architectureDecision({ id: "decision:active-superseded", decision_status: "accepted", superseded_by: ["decision:active-superseder"] });
    const superseder = architectureDecision({ id: "decision:active-superseder", decision_status: "accepted", supersedes: ["decision:active-superseded"] });
    const evidenceMap = new Map([superseded, superseder].map((d) => [d.id, d.evidence_refs]));

    const conflicts = buildDecisionConflicts([superseded, superseder], [], [], evidenceMap);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("active_and_superseded_simultaneously");
    expect(conflicts[0]!.status).toBe("confirmed");
  });

  it("an accepted decision that depends_on a rejected decision is a confirmed accepted_depends_on_rejected conflict", () => {
    const accepted = architectureDecision({ id: "decision:dep-accepted", decision_status: "accepted" });
    const rejected = architectureDecision({ id: "decision:dep-rejected", decision_status: "rejected" });
    const evidenceMap = new Map([accepted, rejected].map((d) => [d.id, d.evidence_refs]));
    const declared = new Map<string, DeclaredDependency[]>([[accepted.id, [{ type: "depends_on", target: rejected.id }]]]);
    const { dependencies } = buildDecisionDependencies([accepted, rejected], declared, evidenceMap);

    const conflicts = buildDecisionConflicts([accepted, rejected], [], dependencies, evidenceMap);
    expect(conflicts.map((c) => c.kind)).toContain("accepted_depends_on_rejected");
  });
});

describe("regression: missing decisions and governance-relevant coverage", () => {
  it("a change affecting an entity with no covering accepted decision is reported as a missing-decision finding", () => {
    const rule: MissingDecisionRuleInput = { rule_kind: "runtime_entrypoint_change_without_decision", affected_entity_ids: ["component:critical-entrypoint"] };
    const findings = detectMissingDecisions([rule], [], new Map(), []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule_kind).toBe("runtime_entrypoint_change_without_decision");
  });

  it("that same finding is absent once an accepted decision has a resolved link to the entity", () => {
    const decision = architectureDecision({ id: "decision:covers-entrypoint", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "governs", target_domain: "architecture", target_id: "component:critical-entrypoint", resolution: "resolved" });
    const rule: MissingDecisionRuleInput = { rule_kind: "runtime_entrypoint_change_without_decision", affected_entity_ids: ["component:critical-entrypoint"] };
    const statusById = new Map([[decision.id, decision.decision_status]]);
    const findings = detectMissingDecisions([rule], [link], statusById, []);
    expect(findings).toEqual([]);
  });

  it("a baseline replacement without a covering decision is reported via baseline_replacement_without_decision", () => {
    const rule: MissingDecisionRuleInput = { rule_kind: "baseline_replacement_without_decision", affected_entity_ids: ["architecture:baseline-v2"] };
    const findings = detectMissingDecisions([rule], [], new Map(), []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule_kind).toBe("baseline_replacement_without_decision");
  });

  it("missing-decision findings feed buildDecisionGovernanceContext's changes_missing_decision echo", () => {
    const rule: MissingDecisionRuleInput = { rule_kind: "policy_exception_without_decision", affected_entity_ids: ["governance:policy-1"] };
    const findings = detectMissingDecisions([rule], [], new Map(), []);
    const context = buildDecisionGovernanceContext({ missingDecisionFindings: findings, assumptions: [], conflicts: [], governanceLinks: [], drift: [] });
    expect(context.changes_missing_decision).toEqual(["governance:policy-1"]);
  });
});

describe("regression: governance-backed exceptions", () => {
  it("a decision-backed governance exception that has not expired resolves the link", () => {
    const decision = architectureDecision({ id: "decision:exception-valid", decision_status: "accepted" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1", decision_ref: decision.id, expiry: "2030-01-01T00:00:00.000Z" }] };
    const links = buildGovernanceLinks([decision], policy, GENERATED_AT);
    expect(links).toHaveLength(1);
    expect(links[0]!.resolution).toBe("resolved");
  });

  it("a decision-backed governance exception past its expiry is incompatible, not silently resolved", () => {
    const decision = architectureDecision({ id: "decision:exception-expired", decision_status: "accepted" });
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r2", decision_ref: decision.id, expiry: "2020-01-01T00:00:00.000Z" }] };
    const links = buildGovernanceLinks([decision], policy, GENERATED_AT);
    expect(links).toHaveLength(1);
    expect(links[0]!.resolution).toBe("incompatible");
    expect(links[0]!.detail).toContain("expired");
  });

  it("expired-exception decisions feed a policy_exception_expired drift entry and an expired_policy_exception debt finding when the caller flags them", () => {
    const decision = architectureDecision({ id: "decision:exception-expired-debt", decision_status: "accepted" });
    const expiredIds = new Set([decision.id]);

    const driftInputs: DecisionDriftInputs = {
      decisions: [decision],
      assumptions: [],
      links: [],
      conflicts: [],
      supersessionIssues: [],
      sourceIssues: [],
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      implementationStatusByDecisionId: new Map([[decision.id, "not_started"]]),
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      policyExceptionExpiredDecisionIds: expiredIds,
    };
    expect(detectDecisionDrift(driftInputs).map((d) => d.cause)).toContain("policy_exception_expired");

    const debt = detectDecisionDebt({
      decisions: [decision],
      implementationStates: [],
      drift: [],
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      assumptions: [],
      sourceIssues: [],
      links: [],
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      now: GENERATED_AT,
      policyExceptionExpiredDecisionIds: expiredIds,
    });
    expect(debt.map((f) => f.category)).toContain("expired_policy_exception");
  });
});

describe("regression: drift and debt across two snapshots", () => {
  it("implementation regressing from implemented to not_started between two snapshots is reported as implementation_regressed drift", () => {
    const decision = architectureDecision({ id: "decision:regressed", decision_status: "accepted" });
    const previous: DecisionDriftPreviousState = {
      linkResolutionById: new Map(),
      implementationStatusByDecisionId: new Map([[decision.id, "implemented"]]),
      governanceStatusByDecisionId: new Map(),
      conflictIds: new Set(),
      criticalityByDecisionId: new Map(),
    };
    const inputs: DecisionDriftInputs = {
      decisions: [decision],
      assumptions: [],
      links: [],
      conflicts: [],
      supersessionIssues: [],
      sourceIssues: [],
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      implementationStatusByDecisionId: new Map([[decision.id, "not_started"]]),
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      previous,
    };
    const drift = detectDecisionDrift(inputs);
    expect(drift.map((d) => d.cause)).toContain("implementation_regressed");
  });

  it("a decision-debt finding that no longer recurs on a follow-up run models 'resolved between snapshots' -- resolution_state itself never flips, since this module is stateless", () => {
    const decision = architectureDecision({ id: "decision:debt-then-fixed", decision_status: "accepted" });
    const statesBefore = buildDecisionImplementationStates([decision], [], { hasUpstreamEvidence: true });
    const debtBefore = detectDecisionDebt({
      decisions: [decision],
      implementationStates: statesBefore,
      drift: [],
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      assumptions: [],
      sourceIssues: [],
      links: [],
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap([decision]),
      criticalityByDecisionId: emptyCriticalityMap([decision]),
      now: GENERATED_AT,
    });
    expect(debtBefore.map((f) => f.category)).toContain("accepted_without_implementation");
    expect(debtBefore.every((f) => f.resolution_state === "open")).toBe(true);

    const link = decisionLink({ decision_id: decision.id, link_type: "implements", target_domain: "architecture", target_id: "component:fixed", resolution: "resolved" });
    const implementedDecision = { ...decision, decision_status: "implemented" as const };
    const statesAfter = buildDecisionImplementationStates([implementedDecision], [link], { hasUpstreamEvidence: true });
    const debtAfter = detectDecisionDebt({
      decisions: [implementedDecision],
      implementationStates: statesAfter,
      drift: [],
      conflicts: [],
      supersessionIssues: [],
      missingDecisionFindings: [],
      assumptions: [],
      sourceIssues: [],
      links: [],
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap([implementedDecision]),
      criticalityByDecisionId: emptyCriticalityMap([implementedDecision]),
      now: GENERATED_AT,
    });
    expect(debtAfter.map((f) => f.category)).not.toContain("accepted_without_implementation");
  });
});

describe("regression: product/portfolio-linked decisions and upstream compatibility", () => {
  it("a decision with a resolved product-domain link is counted in the products coverage dimension", () => {
    const decision = architectureDecision({ id: "decision:product-linked", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "governs", target_domain: "product", target_id: "product:checkout", resolution: "resolved" });
    const coverageInputs: CoverageInputs = { productSnapshot: { id: "product:checkout" } };
    const coverage = buildDecisionCoverage([link], coverageInputs, decision.evidence_refs);
    const productMetric = coverage.find((m) => m.dimension === "products");
    expect(productMetric?.numerator).toBe(1);
  });

  it("a decision with a resolved portfolio-domain link is 'portfolio_wide' blast radius", () => {
    const decision = architectureDecision({ id: "decision:portfolio-linked", decision_status: "accepted" });
    const link = decisionLink({ decision_id: decision.id, link_type: "affects", target_domain: "portfolio", target_id: "portfolio:core", resolution: "resolved" });
    const inputs: BlastRadiusInputs = { decisions: [decision], links: [link], dependencies: [], sourceIssues: [], linksAvailable: true, dependenciesAvailable: true };
    const assessment = assessDecisionBlastRadius(inputs);
    expect(assessment[0]!.level).toBe("portfolio_wide");
  });

  it("a schema_version mismatch between two snapshots is an incompatible upstream artifact comparison", () => {
    const decision = architectureDecision({ id: "decision:schema-mismatch", decision_status: "accepted" });
    const source = buildDecisionSnapshot({ repositoryId: "repo-schema", generatedAt: GENERATED_AT, decisions: [decision], sourceIssues: [] });
    const target = { ...buildDecisionSnapshot({ repositoryId: "repo-schema", generatedAt: GENERATED_AT, decisions: [decision], sourceIssues: [] }), schema_version: 2 as unknown as 1 };
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("incompatible");
  });

  it("a partial upstream artifact context is reported as an advisory reason but stays 'compatible'", () => {
    const decision = architectureDecision({ id: "decision:partial-upstream", decision_status: "accepted" });
    const source = buildDecisionSnapshot({ repositoryId: "repo-partial", generatedAt: GENERATED_AT, decisions: [decision], sourceIssues: [], upstreamCompatibility: "partial" });
    const target = buildDecisionSnapshot({ repositoryId: "repo-partial", generatedAt: GENERATED_AT, decisions: [decision], sourceIssues: [], upstreamCompatibility: "complete", upstreamSnapshot: { snapshot_id: "arch:snap-1", digest: "digest-x", schema_version: 1 } });
    const result = assessDecisionSnapshotCompatibility(source, target);
    expect(result.status).toBe("compatible");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("regression: claims", () => {
  it("draftStandardDecisionClaims produces exactly 5 drafts, and a fully-clean accepted decision approves decision_approved", () => {
    const decision = architectureDecision({ id: "decision:claim-clean", decision_status: "accepted" });
    const drafts = draftStandardDecisionClaims(decision);
    expect(drafts).toHaveLength(5);

    const context: DecisionClaimContext = {
      decisionsById: new Map([[decision.id, decision]]),
      assumptions: [],
      conflicts: [],
      supersessionIssues: [],
      links: [],
      snapshotCompatibility: "complete",
    };
    const approvedDraft = drafts.find((d) => d.claim_type === "decision_approved")!;
    const claim = classifyDecisionClaim(approvedDraft, context);
    expect(claim.status).toBe("approved");
    expect(claim.rejection_codes).toEqual([]);
  });

  it("a decision_quality claim always rejects unconditionally, even for an otherwise clean decision", () => {
    const decision = architectureDecision({ id: "decision:claim-quality", decision_status: "accepted" });
    const context: DecisionClaimContext = {
      decisionsById: new Map([[decision.id, decision]]),
      assumptions: [],
      conflicts: [],
      supersessionIssues: [],
      links: [],
      snapshotCompatibility: "complete",
    };
    const claim = classifyDecisionClaim({ claim_type: "decision_quality", subject_decision_id: decision.id, statement: "This decision is high quality.", evidence_refs: [] }, context);
    expect(claim.status).toBe("rejected");
    expect(claim.rejection_codes).toContain("unsupported_quality_claim");
  });

  it("a claim against a decision with a contradicted assumption and an unresolved conflict collects both rejection codes", () => {
    const decision = architectureDecision({ id: "decision:claim-multi-reject", decision_status: "accepted" });
    const assumption = decisionAssumption({ decision_id: decision.id, state: "contradicted" });
    const context: DecisionClaimContext = {
      decisionsById: new Map([[decision.id, decision]]),
      assumptions: [assumption],
      conflicts: [{ id: "decision:conflict:1", decision_ids: [decision.id, "decision:other"], kind: "incompatible_required_states", status: "confirmed", detail: "conflict", evidence_refs: [] }],
      supersessionIssues: [],
      links: [],
      snapshotCompatibility: "complete",
    };
    const claim = classifyDecisionClaim({ claim_type: "assumptions_hold", subject_decision_id: decision.id, statement: "Assumptions hold.", evidence_refs: [] }, context);
    expect(claim.status).toBe("rejected");
    expect(claim.rejection_codes).toContain("contradicted_assumption");
    expect(claim.rejection_codes).toContain("unresolved_conflict");
  });
});

describe("regression: dependency cycles", () => {
  it("a blocking (depends_on) cycle among 3 decisions is classified blocking_flagged", () => {
    const a = architectureDecision({ id: "decision:blk-a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:blk-b", decision_status: "accepted" });
    const c = architectureDecision({ id: "decision:blk-c", decision_status: "accepted" });
    const evidenceMap = new Map([a, b, c].map((d) => [d.id, d.evidence_refs]));
    const declared = new Map<string, DeclaredDependency[]>([
      [a.id, [{ type: "depends_on", target: b.id }]],
      [b.id, [{ type: "depends_on", target: c.id }]],
      [c.id, [{ type: "depends_on", target: a.id }]],
    ]);
    const { cycles } = buildDecisionDependencies([a, b, c], declared, evidenceMap);
    expect(cycles.some((cy) => cy.classification === "blocking_flagged")).toBe(true);
  });

  it("a related_to-only cycle is informational_allowed, not blocking_flagged", () => {
    const a = architectureDecision({ id: "decision:info-a", decision_status: "accepted" });
    const b = architectureDecision({ id: "decision:info-b", decision_status: "accepted" });
    const evidenceMap = new Map([a, b].map((d) => [d.id, d.evidence_refs]));
    const declared = new Map<string, DeclaredDependency[]>([
      [a.id, [{ type: "related_to", target: b.id }]],
      [b.id, [{ type: "related_to", target: a.id }]],
    ]);
    const { cycles } = buildDecisionDependencies([a, b], declared, evidenceMap);
    expect(cycles.every((cy) => cy.classification === "informational_allowed")).toBe(true);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("regression: a larger multi-decision scenario end to end", () => {
  it("builds a snapshot, criticality, plan, and narrative together over 6 interrelated decisions without throwing", () => {
    const decisions = [
      architectureDecision({ id: "decision:multi-1", decision_status: "accepted", implementation_status: "implemented" }),
      architectureDecision({ id: "decision:multi-2", decision_status: "proposed", implementation_status: "not_started" }),
      architectureDecision({ id: "decision:multi-3", decision_status: "superseded", superseded_by: ["decision:multi-4"] }),
      architectureDecision({ id: "decision:multi-4", decision_status: "accepted", supersedes: ["decision:multi-3"] }),
      architectureDecision({ id: "decision:multi-5", decision_status: "rejected" }),
      architectureDecision({ id: "decision:multi-6", decision_status: "accepted" }),
    ];
    const links = [
      decisionLink({ decision_id: decisions[0]!.id, link_type: "governs", target_domain: "architecture", target_id: "component:core", resolution: "resolved" }),
      decisionLink({ decision_id: decisions[5]!.id, link_type: "affects", target_domain: "portfolio", target_id: "portfolio:core", resolution: "resolved" }),
    ];
    const assumptions = [decisionAssumption({ decision_id: decisions[0]!.id, state: "confirmed" })];
    const evidenceMap = new Map(decisions.map((d) => [d.id, d.evidence_refs]));

    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-multi", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const criticality = classifyDecisionCriticality(decisions, { signalsAvailable: true });
    const { issues: supersessionIssues, chains: supersessionChains } = buildDecisionSupersession(decisions, evidenceMap);
    const conflicts = buildDecisionConflicts(decisions, links, [], evidenceMap);
    const implementationStates = buildDecisionImplementationStates(decisions, links, { hasUpstreamEvidence: true });

    const driftInputs: DecisionDriftInputs = {
      decisions,
      assumptions,
      links,
      conflicts,
      supersessionIssues,
      sourceIssues: [],
      criticalityByDecisionId: new Map(criticality.map((c) => [c.decision_id, c.criticality])),
      implementationStatusByDecisionId: new Map(implementationStates.map((s) => [s.decision_id, s.status])),
      governanceStatusByDecisionId: emptyGovernanceMap(decisions),
    };
    const drift = detectDecisionDrift(driftInputs);

    const debt = detectDecisionDebt({
      decisions,
      implementationStates,
      drift,
      conflicts,
      supersessionIssues,
      missingDecisionFindings: [],
      assumptions,
      sourceIssues: [],
      links,
      dependencies: [],
      governanceStatusByDecisionId: emptyGovernanceMap(decisions),
      criticalityByDecisionId: new Map(criticality.map((c) => [c.decision_id, c.criticality])),
      now: GENERATED_AT,
    });

    const narrativeInput: BuildDecisionNarrativeInput = {
      snapshot,
      implementationStates,
      assumptions,
      conflicts,
      supersessionIssues,
      coverage: [],
      debtFindings: debt,
      drift,
      generatedAt: GENERATED_AT,
    };
    const narrative = buildDecisionNarrative(narrativeInput);
    expect(narrative.sections).toHaveLength(12);

    const planInput: BuildDecisionPlanInput = {
      snapshot,
      narrative,
      links,
      implementationStates,
      assumptions,
      supersessionIssues,
      supersessionChains,
      conflicts,
      coverage: [],
      drift,
      debtFindings: debt,
      generatedAt: GENERATED_AT,
    };
    const plan = buildDecisionPlan(planInput);
    expect(plan.scenes.length).toBeGreaterThan(0);
    const kinds = plan.scenes.map((s) => s.kind);
    expect(kinds).toEqual([...kinds].sort((x, y) => kinds.indexOf(x) - kinds.indexOf(y)));
    expect(new Set(plan.scenes.map((s) => s.scene_id)).size).toBe(plan.scenes.length);
  });
});
