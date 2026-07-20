import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { buildPolicyId, buildRuleId } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport, DecisionGovernanceContext } from "@rvs/governance-intelligence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDecisionAnalysis } from "../commands/decisions-analyze.js";
import { runGovernanceCheck } from "../commands/governance-check.js";
import { runSnapshotCreate } from "../commands/snapshot-create.js";

// ---------------------------------------------------------------------------
// Milestone 8.1 item 7: true end-to-end tests proving the two named
// governance-integration workflows in-process (no subprocess spawning,
// matching decisions-cli.test.ts/governance-cli.test.ts's established
// convention), threading a real cached architecture-intelligence.json ->
// `snapshot create` -> `decisions analyze` -> `governance check --ci`
// pipeline exactly as a real repository would run it.
//
// Workflow A ("architecture-change-missing-decision"): a component is added
// between two snapshots with no decision covering it, and a
// `missing_decision_rules` entry names it -- `require_decision_for_change`
// must fail and `governance check --ci` must exit 1.
//
// Workflow B ("accepted-decision-with-contradicted-assumption"): an accepted
// ADR declares a "[contradicted]" assumption -- decision drift analysis must
// place that decision in `decisions_requiring_review_for_drift`,
// `forbid_contradicted_assumption` must fail, and `governance check --ci`
// must exit 1. This needs no architecture change at all (see
// policy-evaluator.ts's evaluateForbidContradictedAssumption, which reads
// decisionChanges.decisions_with_contradicted_assumptions directly with no
// domain-diff scan).
// ---------------------------------------------------------------------------

function makeLogger(): Logger & { infos: string[]; warns: string[]; errors: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    warns,
    errors,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
    error: (m: string) => errors.push(m),
    debug: () => {},
  };
}

function writeArchitecture(repoRoot: string, content: unknown): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"), JSON.stringify(content));
}

// `snapshot create` refuses a partial snapshot unless every domain
// (architecture/capability/product) is cached (snapshot-create.ts's "missing
// domain(s)" guard) -- capability/product content is irrelevant to either
// workflow, so both are cached once as empty objects, matching
// governance-cli.test.ts's own precedent (writeCachedArtifact(repoRoot,
// "architecture-intelligence.json", {})).
function writeUnusedDomainFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/cache/capability-model.json"), JSON.stringify({}));
  writeFileSync(resolve(repoRoot, ".rvs/cache/product-identity-model.json"), JSON.stringify({}));
}

function writeGovernanceConfig(repoRoot: string, policyYaml: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/policies"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/governance.yml"), "schema_version: 1\npolicies:\n  - .rvs/policies/decision-governance.yml\n");
  writeFileSync(resolve(repoRoot, ".rvs/policies/decision-governance.yml"), policyYaml);
}

const REQUIRE_DECISION_FOR_CHANGE_POLICY = `schema_version: 1
name: Decision Governance Policy
rules:
  - id: require-decision-for-change
    title: Require decision for change
    description: Every changed component must be linked to a decision.
    kind: require_decision_for_change
    condition:
      kind: require_decision_for_change
    severity: blocking
    enabled: true
`;

const FORBID_CONTRADICTED_ASSUMPTION_POLICY = `schema_version: 1
name: Decision Governance Policy
rules:
  - id: forbid-contradicted-assumption
    title: Forbid contradicted assumptions
    description: No accepted decision may carry a contradicted assumption.
    kind: forbid_contradicted_assumption
    condition:
      kind: forbid_contradicted_assumption
    severity: blocking
    enabled: true
`;

// Policies have no explicit top-level `id:` above, so policy-loader.ts's
// loadPolicyFiles falls back to the policy's `name` as the policy key
// (PolicyFileSchema's own doc comment: "id(policyKey) or name") -- findings'
// `rule_id` is `buildRuleId(buildPolicyId(policyKey), rule.id)`, never the
// bare rule `id:` from the YAML.
const DECISION_GOVERNANCE_POLICY_ID = buildPolicyId("Decision Governance Policy");
const REQUIRE_DECISION_FOR_CHANGE_RULE_ID = buildRuleId(DECISION_GOVERNANCE_POLICY_ID, "require-decision-for-change");
const FORBID_CONTRADICTED_ASSUMPTION_RULE_ID = buildRuleId(DECISION_GOVERNANCE_POLICY_ID, "forbid-contradicted-assumption");

describe("Workflow A: architecture-change-missing-decision -> governance check exit code", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-e2e-missing-decision-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("fails require_decision_for_change and exits 1 under --ci when a changed component has zero covering decision links", async () => {
    const logger = makeLogger();
    writeUnusedDomainFixtures(repoRoot);

    // "before": no component:api-gateway.
    writeArchitecture(repoRoot, { components: [] });
    await runSnapshotCreate(repoRoot, { name: "before" }, logger);

    // "after": component:api-gateway is added.
    writeArchitecture(repoRoot, { components: [{ id: "component:api-gateway", kind: "service", label: "API Gateway" }] });
    await runSnapshotCreate(repoRoot, { name: "after" }, logger);

    // No decision documents at all -- missing-decisions.ts's coverage check
    // (zero DecisionLinks) means the configured affected_entity_id is
    // automatically uncovered; no ADR fixture is required.
    mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".rvs/decisions.yml"),
      "schema_version: 1\nsources:\n  - path: docs/decisions\n    type: adr\nmissing_decision_rules:\n  - rule_kind: runtime_entrypoint_change_without_decision\n    affected_entity_ids:\n      - component:api-gateway\n",
    );
    const analyzeLogger = makeLogger();
    const analyzeResult = await runDecisionAnalysis(repoRoot, analyzeLogger);
    expect(analyzeResult.snapshot.decisions).toHaveLength(0);

    const context = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/decisions/decision-governance-context.json"), "utf8")) as DecisionGovernanceContext;
    expect(context.changes_missing_decision).toEqual(["component:api-gateway"]);

    writeGovernanceConfig(repoRoot, REQUIRE_DECISION_FOR_CHANGE_POLICY);

    const checkLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceCheck(repoRoot, { from: "before", to: "after", ci: true }, checkLogger)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(checkLogger.errors.some((m) => m.includes("Governance check failed under --ci"))).toBe(true);
    process.exitCode = undefined;

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const finding = report.findings.find((f) => f.rule_id === REQUIRE_DECISION_FOR_CHANGE_RULE_ID);
    expect(finding?.result).toBe("fail");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.affected_entity_ids).toContain("component:api-gateway");
    expect(report.decision_changes).toEqual(context);
  });

  it("passes (does not exit 1) when the changed component IS covered by an accepted decision link", async () => {
    const logger = makeLogger();
    writeUnusedDomainFixtures(repoRoot);

    writeArchitecture(repoRoot, { components: [] });
    await runSnapshotCreate(repoRoot, { name: "before" }, logger);
    writeArchitecture(repoRoot, { components: [{ id: "component:api-gateway", kind: "service", label: "API Gateway" }] });
    await runSnapshotCreate(repoRoot, { name: "after" }, logger);

    mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".rvs/decisions.yml"),
      "schema_version: 1\nsources:\n  - path: docs/decisions\n    type: adr\nmissing_decision_rules:\n  - rule_kind: runtime_entrypoint_change_without_decision\n    affected_entity_ids:\n      - component:api-gateway\n",
    );
    mkdirSync(resolve(repoRoot, "docs/decisions"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "docs/decisions/0001-api-gateway.md"),
      `---
id: ADR-0001
status: accepted
links:
  - type: governs
    domain: architecture
    target: component:api-gateway
---

# Introduce the API gateway

## Decision

We will introduce an API gateway component.
`,
    );
    const analyzeLogger = makeLogger();
    await runDecisionAnalysis(repoRoot, analyzeLogger);

    const context = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/decisions/decision-governance-context.json"), "utf8")) as DecisionGovernanceContext;
    expect(context.changes_missing_decision).toEqual([]);

    writeGovernanceConfig(repoRoot, REQUIRE_DECISION_FOR_CHANGE_POLICY);

    const checkLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceCheck(repoRoot, { from: "before", to: "after", ci: true }, checkLogger)).resolves.toBeUndefined();
    expect(process.exitCode).toBeUndefined();

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const finding = report.findings.find((f) => f.rule_id === REQUIRE_DECISION_FOR_CHANGE_RULE_ID);
    expect(finding?.result).toBe("pass");
  });
});

describe("Workflow B: accepted-decision-with-contradicted-assumption -> drift -> governance finding -> CI result", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-e2e-contradicted-assumption-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("surfaces drift for the contradicted assumption, fails forbid_contradicted_assumption, and exits 1 under --ci -- with no architecture change at all", async () => {
    const logger = makeLogger();
    writeUnusedDomainFixtures(repoRoot);

    // Identical "before"/"after" snapshots -- proves this workflow is
    // independent of any architecture domain diff.
    writeArchitecture(repoRoot, { components: [] });
    await runSnapshotCreate(repoRoot, { name: "before" }, logger);
    await runSnapshotCreate(repoRoot, { name: "after" }, logger);

    mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/decisions.yml"), "schema_version: 1\nsources:\n  - path: docs/decisions\n    type: adr\n");
    mkdirSync(resolve(repoRoot, "docs/decisions"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "docs/decisions/0001-vendor-api.md"),
      `---
id: ADR-0001
status: accepted
assumptions:
  - "[contradicted] The vendor API remains stable."
---

# Depend on the vendor payments API

## Decision

We will depend on the vendor payments API for settlement.
`,
    );
    const analyzeLogger = makeLogger();
    const analyzeResult = await runDecisionAnalysis(repoRoot, analyzeLogger);
    expect(analyzeResult.snapshot.decisions).toHaveLength(1);
    expect(analyzeResult.snapshot.decisions[0].decision_status).toBe("accepted");

    const cacheDir = resolve(repoRoot, ".rvs/cache/decisions");
    const drift = JSON.parse(readFileSync(resolve(cacheDir, "drift.json"), "utf8")) as Array<{ decision_id: string; severity: string; cause: string }>;
    expect(drift.some((d) => d.decision_id === "decision:ADR-0001" && d.severity !== "informational" && d.severity !== "advisory")).toBe(true);

    const context = JSON.parse(readFileSync(resolve(cacheDir, "decision-governance-context.json"), "utf8")) as DecisionGovernanceContext;
    expect(context.decisions_with_contradicted_assumptions).toEqual(["decision:ADR-0001"]);

    writeGovernanceConfig(repoRoot, FORBID_CONTRADICTED_ASSUMPTION_POLICY);

    const checkLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceCheck(repoRoot, { from: "before", to: "after", ci: true }, checkLogger)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(checkLogger.errors.some((m) => m.includes("Governance check failed under --ci"))).toBe(true);
    process.exitCode = undefined;

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const finding = report.findings.find((f) => f.rule_id === FORBID_CONTRADICTED_ASSUMPTION_RULE_ID);
    expect(finding?.result).toBe("fail");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.affected_entity_ids).toContain("decision:ADR-0001");
  });

  it("passes (does not exit 1) when the accepted decision's assumptions are all confirmed, not contradicted", async () => {
    const logger = makeLogger();
    writeUnusedDomainFixtures(repoRoot);
    writeArchitecture(repoRoot, { components: [] });
    await runSnapshotCreate(repoRoot, { name: "before" }, logger);
    await runSnapshotCreate(repoRoot, { name: "after" }, logger);

    mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/decisions.yml"), "schema_version: 1\nsources:\n  - path: docs/decisions\n    type: adr\n");
    mkdirSync(resolve(repoRoot, "docs/decisions"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "docs/decisions/0001-vendor-api.md"),
      `---
id: ADR-0001
status: accepted
assumptions:
  - "[confirmed] The vendor API remains stable."
---

# Depend on the vendor payments API

## Decision

We will depend on the vendor payments API for settlement.
`,
    );
    const analyzeLogger = makeLogger();
    await runDecisionAnalysis(repoRoot, analyzeLogger);

    const context = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/decisions/decision-governance-context.json"), "utf8")) as DecisionGovernanceContext;
    expect(context.decisions_with_contradicted_assumptions).toEqual([]);

    writeGovernanceConfig(repoRoot, FORBID_CONTRADICTED_ASSUMPTION_POLICY);

    const checkLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceCheck(repoRoot, { from: "before", to: "after", ci: true }, checkLogger)).resolves.toBeUndefined();
    expect(process.exitCode).toBeUndefined();

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const finding = report.findings.find((f) => f.rule_id === FORBID_CONTRADICTED_ASSUMPTION_RULE_ID);
    expect(finding?.result).toBe("pass");
  });
});
