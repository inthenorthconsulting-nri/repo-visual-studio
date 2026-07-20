import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../policy-evaluator.js";
import type {
  ArchitectureChangeSet,
  BlastRadiusAssessment,
  CapabilityChangeSet,
  GovernanceChangeClassification,
  GovernanceChangeEntry,
  GovernanceCompatibilityStatus,
  GovernanceException,
  GovernancePolicy,
  GovernanceRule,
  GovernanceRuleCondition,
  GovernanceSeverity,
  PortfolioChangeSet,
  ProductChangeSet,
} from "../contracts.js";
import { buildPolicyId, buildRuleId } from "../ids.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-01T00:00:00.000Z";

function classification(overrides: Partial<GovernanceChangeClassification> = {}): GovernanceChangeClassification {
  return {
    domain: "architecture",
    materiality: "material",
    confidence: "confirmed",
    governance_severity: "informational",
    compatibility_impact: "compatible",
    evidence_impact: "preserved",
    runtime_impact: "none",
    consumer_impact: "isolated",
    portfolio_impact: "none",
    ...overrides,
  };
}

let entrySeq = 0;
function entry(overrides: Partial<GovernanceChangeEntry> = {}): GovernanceChangeEntry {
  entrySeq += 1;
  return {
    id: overrides.id ?? `governance:change:test:${entrySeq}`,
    domain_path: overrides.domain_path ?? "components",
    entity_id: overrides.entity_id ?? `entity-${entrySeq}`,
    entity_label: overrides.entity_label ?? `entity-${entrySeq}`,
    type: overrides.type ?? "added",
    compatibility: overrides.compatibility ?? "compatible",
    lineage: overrides.lineage ?? "preserved",
    classification: overrides.classification ?? classification(),
    detail: overrides.detail ?? "Entry changed.",
    evidence_refs: overrides.evidence_refs ?? [],
  };
}

function architectureChangeSet(changes: GovernanceChangeEntry[], compatibility: GovernanceCompatibilityStatus = "compatible"): ArchitectureChangeSet {
  return { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
function capabilityChangeSet(changes: GovernanceChangeEntry[], compatibility: GovernanceCompatibilityStatus = "compatible"): CapabilityChangeSet {
  return { schema_version: 1, id: "changeset:capability", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
function productChangeSet(changes: GovernanceChangeEntry[], compatibility: GovernanceCompatibilityStatus = "compatible"): ProductChangeSet {
  return { schema_version: 1, id: "changeset:product", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}
function portfolioChangeSet(changes: GovernanceChangeEntry[], compatibility: GovernanceCompatibilityStatus = "compatible"): PortfolioChangeSet {
  return { schema_version: 1, id: "changeset:portfolio", source_snapshot_id: "source", target_snapshot_id: "target", compatibility, changes, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function emptyBlastRadius(): BlastRadiusAssessment {
  return { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function rule(kind: GovernanceRuleCondition["kind"], condition: GovernanceRuleCondition, overrides: Partial<GovernanceRule> = {}): GovernanceRule {
  const policyId = buildPolicyId("test-policy");
  return {
    id: buildRuleId(policyId, overrides.id ?? kind),
    title: overrides.title ?? kind,
    description: overrides.description ?? `Rule for ${kind}`,
    kind,
    condition,
    severity: overrides.severity ?? "review_required",
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

function policy(rules: GovernanceRule[], exceptions: GovernanceException[] = []): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("test-policy"), name: "Test Policy", rules, exceptions, evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

interface EvalArgs {
  policy: GovernancePolicy;
  architectureChanges?: ArchitectureChangeSet;
  capabilityChanges?: CapabilityChangeSet;
  productChanges?: ProductChangeSet;
  portfolioChanges?: PortfolioChangeSet;
  blastRadius?: BlastRadiusAssessment;
  targetCompatibility?: GovernanceCompatibilityStatus;
  now?: string;
}

function runEval(args: EvalArgs) {
  return evaluatePolicy({
    policy: args.policy,
    sourceSnapshotId: "source",
    targetSnapshotId: "target",
    architectureChanges: args.architectureChanges ?? architectureChangeSet([]),
    capabilityChanges: args.capabilityChanges ?? capabilityChangeSet([]),
    productChanges: args.productChanges ?? productChangeSet([]),
    portfolioChanges: args.portfolioChanges,
    blastRadius: args.blastRadius ?? emptyBlastRadius(),
    targetCompatibility: args.targetCompatibility ?? "compatible",
    generatedAt: GENERATED_AT,
    now: args.now ?? NOW,
  });
}

describe("evaluatePolicy: forbid_component_removal", () => {
  it("fails when a component in scope was removed", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:.*" }, { severity: "blocking" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed", classification: classification({ governance_severity: "advisory" }) })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].result).toBe("fail");
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("passes when components in scope were not removed", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:.*" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "modified" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].result).toBe("pass");
  });

  it("is not_applicable when no component matches scope", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:.*" });
    const result = runEval({ policy: policy([r]) });
    expect(result.findings[0].result).toBe("not_applicable");
  });
});

describe("evaluatePolicy: require_runtime_entrypoint", () => {
  it("fails when a runtime entrypoint was removed", () => {
    const r = rule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" });
    const changes = architectureChangeSet([entry({ domain_path: "components.component:api.implementation.entryPoints", entity_id: "component:api:main", type: "removed" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when entrypoints in scope are unchanged/added", () => {
    const r = rule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" });
    const changes = architectureChangeSet([entry({ domain_path: "components.component:api.implementation.entryPoints", entity_id: "component:api:main", type: "added" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: require_capability_status_at_least", () => {
  it("fails when a capability's bucket is below the minimum status", () => {
    const r = rule("require_capability_status_at_least", { kind: "require_capability_status_at_least", minimum_status: "qualifiedCapabilities" });
    const changes = capabilityChangeSet([entry({ domain_path: "gapCapabilities", entity_id: "capability:x", type: "modified" })]);
    const result = runEval({ policy: policy([r]), capabilityChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when a capability's bucket meets the minimum status", () => {
    const r = rule("require_capability_status_at_least", { kind: "require_capability_status_at_least", minimum_status: "qualifiedCapabilities" });
    const changes = capabilityChangeSet([entry({ domain_path: "includedCapabilities", entity_id: "capability:x", type: "modified" })]);
    const result = runEval({ policy: policy([r]), capabilityChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });

  it("is unverifiable when minimum_status is not a recognized bucket", () => {
    const r = rule("require_capability_status_at_least", { kind: "require_capability_status_at_least", minimum_status: "operational" });
    const changes = capabilityChangeSet([entry({ domain_path: "includedCapabilities", entity_id: "capability:x", type: "modified" })]);
    const result = runEval({ policy: policy([r]), capabilityChanges: changes });
    expect(result.findings[0].result).toBe("unverifiable");
  });
});

describe("evaluatePolicy: forbid_operational_to_planned_regression", () => {
  it("fails when a capability was reclassified", () => {
    const r = rule("forbid_operational_to_planned_regression", { kind: "forbid_operational_to_planned_regression" });
    const changes = capabilityChangeSet([entry({ domain_path: "roadmapCapabilities", entity_id: "capability:x", type: "reclassified", detail: 'status regressed from "operational" to "planned"' })]);
    const result = runEval({ policy: policy([r]), capabilityChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when no capability was reclassified", () => {
    const r = rule("forbid_operational_to_planned_regression", { kind: "forbid_operational_to_planned_regression" });
    const changes = capabilityChangeSet([entry({ domain_path: "includedCapabilities", entity_id: "capability:x", type: "unchanged" })]);
    const result = runEval({ policy: policy([r]), capabilityChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: require_evidence_type", () => {
  it("fails when an entity in scope lacks evidence from the required source", () => {
    const r = rule("require_evidence_type", { kind: "require_evidence_type", required_evidence_source: "portfolio" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:db", type: "modified", evidence_refs: [{ path: "src/db.ts", source_artifact: "architecture" }] })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings.some((f) => f.result === "fail")).toBe(true);
  });

  it("passes when every entity in scope carries evidence from the required source", () => {
    const r = rule("require_evidence_type", { kind: "require_evidence_type", required_evidence_source: "portfolio" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:db", type: "modified", evidence_refs: [{ path: "portfolio.yml", source_artifact: "portfolio" }] })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: forbid_dependency_removal", () => {
  it("fails when a dependency in scope was removed", () => {
    const r = rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:postgres", type: "removed" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when dependencies in scope are unchanged", () => {
    const r = rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:postgres", type: "unchanged" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: require_shared_contract_for_dependency", () => {
  it("fails when a dependency lacks portfolio-sourced evidence", () => {
    const r = rule("require_shared_contract_for_dependency", { kind: "require_shared_contract_for_dependency" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:billing-api", type: "modified", evidence_refs: [{ path: "src/billing.ts", source_artifact: "architecture" }] })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes, portfolioChanges: portfolioChangeSet([]) });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when a dependency carries portfolio-sourced evidence", () => {
    const r = rule("require_shared_contract_for_dependency", { kind: "require_shared_contract_for_dependency" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:billing-api", type: "modified", evidence_refs: [{ path: "portfolio.yml", source_artifact: "portfolio" }] })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes, portfolioChanges: portfolioChangeSet([]) });
    expect(result.findings[0].result).toBe("pass");
  });

  it("is unverifiable when no portfolio change set is available at all", () => {
    const r = rule("require_shared_contract_for_dependency", { kind: "require_shared_contract_for_dependency" });
    const changes = architectureChangeSet([entry({ domain_path: "dependencies", entity_id: "dependency:billing-api", type: "modified" })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("unverifiable");
  });
});

describe("evaluatePolicy: forbid_approved_claim_without_lineage", () => {
  it("fails when a claim-bearing entity's lineage is broken", () => {
    const r = rule("forbid_approved_claim_without_lineage", { kind: "forbid_approved_claim_without_lineage" });
    const changes = productChangeSet([entry({ domain_path: "identity.valuePillars", entity_id: "pillar:speed", type: "modified", lineage: "broken" })]);
    const result = runEval({ policy: policy([r]), productChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when claim-bearing entities retain lineage", () => {
    const r = rule("forbid_approved_claim_without_lineage", { kind: "forbid_approved_claim_without_lineage" });
    const changes = productChangeSet([entry({ domain_path: "identity.differentiators", entity_id: "diff:1", type: "modified", lineage: "preserved" })]);
    const result = runEval({ policy: policy([r]), productChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: require_product_role", () => {
  it("fails when a product in scope was removed from the portfolio", () => {
    const r = rule("require_product_role", { kind: "require_product_role", required_role: "core" });
    const changes = portfolioChangeSet([entry({ domain_path: "products", entity_id: "product:widget", type: "removed" })]);
    const result = runEval({ policy: policy([r]), portfolioChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes (presence-only) when the product remains in the portfolio", () => {
    const r = rule("require_product_role", { kind: "require_product_role", required_role: "core" });
    const changes = portfolioChangeSet([entry({ domain_path: "products", entity_id: "product:widget", type: "unchanged" })]);
    const result = runEval({ policy: policy([r]), portfolioChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });

  it("is not_applicable when there is no portfolio change set", () => {
    const r = rule("require_product_role", { kind: "require_product_role", required_role: "core" });
    const result = runEval({ policy: policy([r]) });
    expect(result.findings[0].result).toBe("not_applicable");
  });
});

describe("evaluatePolicy: limit_unresolved_relationships", () => {
  it("fails when unresolved relationships exceed the configured maximum", () => {
    const r = rule("limit_unresolved_relationships", { kind: "limit_unresolved_relationships", max_unresolved: 1 });
    const changes = portfolioChangeSet([
      entry({ domain_path: "unresolvedRelationships", entity_id: "rel:1", type: "added" }),
      entry({ domain_path: "unresolvedRelationships", entity_id: "rel:2", type: "added" }),
    ]);
    const result = runEval({ policy: policy([r]), portfolioChanges: changes });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when unresolved relationships are within the configured maximum", () => {
    const r = rule("limit_unresolved_relationships", { kind: "limit_unresolved_relationships", max_unresolved: 5 });
    const changes = portfolioChangeSet([entry({ domain_path: "unresolvedRelationships", entity_id: "rel:1", type: "added" })]);
    const result = runEval({ policy: policy([r]), portfolioChanges: changes });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: require_compatible_snapshot", () => {
  it("fails when target compatibility is below the required minimum", () => {
    const r = rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "compatible" });
    const result = runEval({ policy: policy([r]), targetCompatibility: "partial" });
    expect(result.findings[0].result).toBe("fail");
  });

  it("passes when target compatibility meets the required minimum", () => {
    const r = rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "partial" });
    const result = runEval({ policy: policy([r]), targetCompatibility: "compatible" });
    expect(result.findings[0].result).toBe("pass");
  });
});

describe("evaluatePolicy: cross-cutting behaviors", () => {
  it("returns an explicit 'unverifiable' finding (never a silent pass) when the relevant change set's compatibility is partial", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "unchanged" })], "partial");
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].result).toBe("unverifiable");
  });

  it("returns 'unverifiable' (not a silent pass) when the change set's compatibility is incompatible", () => {
    const r = rule("forbid_dependency_removal", { kind: "forbid_dependency_removal" });
    const changes = architectureChangeSet([], "incompatible");
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].result).toBe("unverifiable");
  });

  it("floors finding severity at the underlying change's intrinsic governance_severity, never lowering below it", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { severity: "advisory" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed", classification: classification({ governance_severity: "blocking" }) })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("never lowers rule severity even when the change's intrinsic severity is weaker", () => {
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { severity: "blocking" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed", classification: classification({ governance_severity: "informational" }) })]);
    const result = runEval({ policy: policy([r]), architectureChanges: changes });
    expect(result.findings[0].severity).toBe("blocking");
  });

  it("applies a valid, non-expired, correctly scoped exception (result becomes 'excepted')", () => {
    const policyId = buildPolicyId("test-policy");
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { severity: "blocking" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:legacy-api", type: "removed" })]);
    const exception: GovernanceException = { policy_id: policyId, rule_id: r.id, scope: "component:legacy-.*", reason: "Planned decommission.", approval_reference: "APPROVAL-1", expiry: "2026-12-31T00:00:00.000Z", evidence_refs: [] };
    const result = runEval({ policy: policy([r], [exception]), architectureChanges: changes, now: NOW });
    expect(result.findings[0].result).toBe("excepted");
    expect(result.findings[0].excepted).toBe(true);
    expect(result.findings[0].exception).toEqual(exception);
  });

  it("does NOT apply an expired exception (finding remains 'fail')", () => {
    const policyId = buildPolicyId("test-policy");
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { severity: "blocking" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:legacy-api", type: "removed" })]);
    const exception: GovernanceException = { policy_id: policyId, rule_id: r.id, scope: "component:legacy-.*", reason: "Expired.", approval_reference: "APPROVAL-1", expiry: "2026-01-01T00:00:00.000Z", evidence_refs: [] };
    const result = runEval({ policy: policy([r], [exception]), architectureChanges: changes, now: NOW });
    expect(result.findings[0].result).toBe("fail");
    expect(result.findings[0].excepted).toBe(false);
  });

  it("does NOT apply an exception whose scope does not match the finding's affected entity", () => {
    const policyId = buildPolicyId("test-policy");
    const r = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { severity: "blocking" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:other-service", type: "removed" })]);
    const exception: GovernanceException = { policy_id: policyId, rule_id: r.id, scope: "component:legacy-.*", reason: "Not applicable.", approval_reference: "APPROVAL-1", evidence_refs: [] };
    const result = runEval({ policy: policy([r], [exception]), architectureChanges: changes, now: NOW });
    expect(result.findings[0].result).toBe("fail");
    expect(result.findings[0].excepted).toBe(false);
  });

  it("produces zero findings for a disabled rule", () => {
    const enabledRule = rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "compatible" }, { id: "enabled-rule" });
    const disabledRule = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { id: "disabled-rule", enabled: false });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed" })]);
    const result = runEval({ policy: policy([enabledRule, disabledRule]), architectureChanges: changes, targetCompatibility: "compatible" });
    expect(result.findings.every((f) => f.rule_id !== disabledRule.id)).toBe(true);
    expect(result.findings).toHaveLength(1);
  });

  it("is fully deterministic: evaluating the same input twice produces byte-identical JSON output (excluding generation)", () => {
    const r1 = rule("forbid_component_removal", { kind: "forbid_component_removal" }, { id: "r1" });
    const r2 = rule("require_compatible_snapshot", { kind: "require_compatible_snapshot", minimum_status: "compatible" }, { id: "r2" });
    const changes = architectureChangeSet([entry({ domain_path: "components", entity_id: "component:api", type: "removed" }), entry({ domain_path: "components", entity_id: "component:notifier", type: "added" })]);
    const args: EvalArgs = { policy: policy([r1, r2]), architectureChanges: changes, targetCompatibility: "compatible" };

    const first = runEval(args);
    const second = runEval(args);
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });

  it("sorts findings by severity rank then id", () => {
    const blockingRule = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:blocking.*" }, { id: "blocking-rule", severity: "blocking" });
    const advisoryRule = rule("forbid_component_removal", { kind: "forbid_component_removal", component_id_pattern: "component:advisory.*" }, { id: "advisory-rule", severity: "advisory" });
    const changes = architectureChangeSet([
      entry({ domain_path: "components", entity_id: "component:advisory-x", type: "removed" }),
      entry({ domain_path: "components", entity_id: "component:blocking-x", type: "removed" }),
    ]);
    const result = runEval({ policy: policy([advisoryRule, blockingRule]), architectureChanges: changes });
    expect(result.findings[0].severity).toBe("blocking");
    expect(result.findings[1].severity).toBe("advisory");
  });
});
