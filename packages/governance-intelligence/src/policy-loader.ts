import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import type { EvidenceRef, GovernanceException, GovernancePolicy, GovernanceRule } from "./contracts.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { buildPolicyId, buildRuleId } from "./ids.js";

// ---------------------------------------------------------------------------
// loadPolicyFile / loadPolicyFiles -- Zod-validated loader for
// `.rvs/policies/*.yml`. Each file is ONE GovernancePolicy-shaped YAML
// document. Every rule's `condition` is validated with `.strict()` against
// the EXACT field set its matching GovernanceRuleKind declares in
// contracts.ts -- a condition object carrying a field that belongs to a
// DIFFERENT kind (e.g. a `forbid_component_removal` condition that also sets
// `minimum_status`) is rejected outright, since a malformed or maliciously
// crafted policy file is untrusted input (spec §47) that must fail loudly
// rather than silently drop/ignore the unrecognized field.
//
// Two id conventions coexist deliberately and must never be confused:
//   - "key" (this file's vocabulary): the SHORT string a policy/rule/
//     exception carries in the YAML source (`id`/`name` for the policy,
//     `id` for each rule, `rule_id` for each exception) -- author-facing,
//     not guaranteed globally unique on its own.
//   - "id" (contracts.ts's vocabulary): the FULL, namespaced, globally
//     unique string produced by ids.ts's buildPolicyId/buildRuleId from a
//     key. This loader is the ONLY place a rule "key" is ever turned into a
//     rule "id" -- it never invents a second id-building scheme of its own.
// ---------------------------------------------------------------------------

const EVIDENCE_SOURCE_ARTIFACTS = ["architecture", "capability", "product", "portfolio", "repository"] as const;
const GOVERNANCE_SEVERITIES = ["blocking", "review_required", "advisory", "informational"] as const;
const GOVERNANCE_COMPATIBILITY_STATUSES = ["compatible", "compatible_with_warnings", "partial", "incompatible"] as const;

const EvidenceRefSchema = z
  .object({
    path: z.string().min(1),
    lines: z.string().min(1).optional(),
    source_artifact: z.enum(EVIDENCE_SOURCE_ARTIFACTS),
  })
  .strict();

// ---------------------------------------------------------------------------
// Per-kind condition schemas -- one per GovernanceRuleKind, each `.strict()`
// so unknown/misplaced fields are rejected. Field sets are copied verbatim
// from contracts.ts's per-kind condition interfaces.
// ---------------------------------------------------------------------------

const ForbidComponentRemovalConditionSchema = z
  .object({
    kind: z.literal("forbid_component_removal"),
    component_id_pattern: z.string().min(1).optional(),
    component_type: z.string().min(1).optional(),
  })
  .strict();

const RequireRuntimeEntrypointConditionSchema = z
  .object({
    kind: z.literal("require_runtime_entrypoint"),
    entrypoint_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireCapabilityStatusAtLeastConditionSchema = z
  .object({
    kind: z.literal("require_capability_status_at_least"),
    capability_id_pattern: z.string().min(1).optional(),
    minimum_status: z.string().min(1),
  })
  .strict();

const ForbidOperationalToPlannedRegressionConditionSchema = z
  .object({
    kind: z.literal("forbid_operational_to_planned_regression"),
    capability_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireEvidenceTypeConditionSchema = z
  .object({
    kind: z.literal("require_evidence_type"),
    entity_id_pattern: z.string().min(1).optional(),
    required_evidence_source: z.enum(EVIDENCE_SOURCE_ARTIFACTS),
  })
  .strict();

const ForbidDependencyRemovalConditionSchema = z
  .object({
    kind: z.literal("forbid_dependency_removal"),
    dependency_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireSharedContractForDependencyConditionSchema = z
  .object({
    kind: z.literal("require_shared_contract_for_dependency"),
    dependency_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const ForbidApprovedClaimWithoutLineageConditionSchema = z
  .object({
    kind: z.literal("forbid_approved_claim_without_lineage"),
    claim_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireProductRoleConditionSchema = z
  .object({
    kind: z.literal("require_product_role"),
    product_id_pattern: z.string().min(1).optional(),
    required_role: z.string().min(1),
  })
  .strict();

const LimitUnresolvedRelationshipsConditionSchema = z
  .object({
    kind: z.literal("limit_unresolved_relationships"),
    max_unresolved: z.number().int().nonnegative(),
  })
  .strict();

const RequireCompatibleSnapshotConditionSchema = z
  .object({
    kind: z.literal("require_compatible_snapshot"),
    minimum_status: z.enum(GOVERNANCE_COMPATIBILITY_STATUSES),
  })
  .strict();

// ---------------------------------------------------------------------------
// §36-38 decision-aware condition schemas. Field sets copied verbatim from
// contracts.ts's per-kind condition interfaces, same as every schema above.
// ---------------------------------------------------------------------------

const RequireDecisionForChangeConditionSchema = z
  .object({
    kind: z.literal("require_decision_for_change"),
    entity_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireAcceptedDecisionConditionSchema = z
  .object({
    kind: z.literal("require_accepted_decision"),
    entity_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireDecisionImplementationConditionSchema = z
  .object({
    kind: z.literal("require_decision_implementation"),
    entity_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const ForbidContradictedAssumptionConditionSchema = z
  .object({
    kind: z.literal("forbid_contradicted_assumption"),
    decision_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const ForbidActiveSupersededDecisionConditionSchema = z
  .object({
    kind: z.literal("forbid_active_superseded_decision"),
    decision_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireDecisionEvidenceConditionSchema = z
  .object({
    kind: z.literal("require_decision_evidence"),
    entity_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireDecisionForPolicyExceptionConditionSchema = z
  .object({
    kind: z.literal("require_decision_for_policy_exception"),
    rule_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const RequireDecisionForBaselineReplacementConditionSchema = z
  .object({
    kind: z.literal("require_decision_for_baseline_replacement"),
  })
  .strict();

const LimitUnresolvedDecisionConflictsConditionSchema = z
  .object({
    kind: z.literal("limit_unresolved_decision_conflicts"),
    max_unresolved: z.number().int().nonnegative(),
  })
  .strict();

const RequireDecisionReviewForDriftConditionSchema = z
  .object({
    kind: z.literal("require_decision_review_for_drift"),
    decision_id_pattern: z.string().min(1).optional(),
  })
  .strict();

const GovernanceRuleConditionSchema = z.discriminatedUnion("kind", [
  ForbidComponentRemovalConditionSchema,
  RequireRuntimeEntrypointConditionSchema,
  RequireCapabilityStatusAtLeastConditionSchema,
  ForbidOperationalToPlannedRegressionConditionSchema,
  RequireEvidenceTypeConditionSchema,
  ForbidDependencyRemovalConditionSchema,
  RequireSharedContractForDependencyConditionSchema,
  ForbidApprovedClaimWithoutLineageConditionSchema,
  RequireProductRoleConditionSchema,
  LimitUnresolvedRelationshipsConditionSchema,
  RequireCompatibleSnapshotConditionSchema,
  RequireDecisionForChangeConditionSchema,
  RequireAcceptedDecisionConditionSchema,
  RequireDecisionImplementationConditionSchema,
  ForbidContradictedAssumptionConditionSchema,
  ForbidActiveSupersededDecisionConditionSchema,
  RequireDecisionEvidenceConditionSchema,
  RequireDecisionForPolicyExceptionConditionSchema,
  RequireDecisionForBaselineReplacementConditionSchema,
  LimitUnresolvedDecisionConflictsConditionSchema,
  RequireDecisionReviewForDriftConditionSchema,
]);

const GOVERNANCE_RULE_KINDS = [
  "forbid_component_removal",
  "require_runtime_entrypoint",
  "require_capability_status_at_least",
  "forbid_operational_to_planned_regression",
  "require_evidence_type",
  "forbid_dependency_removal",
  "require_shared_contract_for_dependency",
  "forbid_approved_claim_without_lineage",
  "require_product_role",
  "limit_unresolved_relationships",
  "require_compatible_snapshot",
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
] as const;

const PolicyFileRuleSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(GOVERNANCE_RULE_KINDS),
    condition: GovernanceRuleConditionSchema,
    severity: z.enum(GOVERNANCE_SEVERITIES),
    enabled: z.boolean(),
    evidence_requirement: z.enum(EVIDENCE_SOURCE_ARTIFACTS).optional(),
    effective_from: z.string().min(1).optional(),
    owner_ref: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.kind !== rule.condition.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rule "${rule.id}": kind "${rule.kind}" does not match condition.kind "${rule.condition.kind}".`,
        path: ["condition", "kind"],
      });
    }
  });

const PolicyFileExceptionSchema = z
  .object({
    // References a rule's short `id` (its key) declared elsewhere in this
    // same file -- resolved to the rule's full rule_id at load time below.
    rule_id: z.string().min(1),
    scope: z.string().min(1).optional(),
    reason: z.string().min(1),
    approval_reference: z.string().min(1),
    expiry: z.string().min(1).optional(),
    // §38: optional pointer to a decision-intelligence ArchitectureDecision
    // id. Carried through verbatim -- see contracts.ts's GovernanceException
    // doc comment for why this package never validates it itself.
    decision_ref: z.string().min(1).optional(),
    evidence_refs: z.array(EvidenceRefSchema).default([]),
  })
  .strict();

export const PolicyFileSchema = z
  .object({
    schema_version: z.literal(1),
    // Policy key: `id` when present, else `name` (brief: "id(policyKey) or
    // name"). At least one of the two must be present.
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    rules: z.array(PolicyFileRuleSchema).min(1),
    exceptions: z.array(PolicyFileExceptionSchema).default([]),
    evidence_refs: z.array(EvidenceRefSchema).default([]),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seenRuleKeys = new Set<string>();
    file.rules.forEach((rule, index) => {
      if (seenRuleKeys.has(rule.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate rule id "${rule.id}".`, path: ["rules", index, "id"] });
      }
      seenRuleKeys.add(rule.id);
    });
    file.exceptions.forEach((exception, index) => {
      if (!seenRuleKeys.has(exception.rule_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `exception references unknown rule id "${exception.rule_id}".`, path: ["exceptions", index, "rule_id"] });
      }
    });
  });

export type PolicyFile = z.infer<typeof PolicyFileSchema>;

function sortRules(rules: GovernanceRule[]): GovernanceRule[] {
  return [...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortExceptions(exceptions: GovernanceException[]): GovernanceException[] {
  return [...exceptions].sort((a, b) => {
    if (a.policy_id !== b.policy_id) return a.policy_id < b.policy_id ? -1 : 1;
    if (a.rule_id !== b.rule_id) return a.rule_id < b.rule_id ? -1 : 1;
    const scopeA = a.scope ?? "";
    const scopeB = b.scope ?? "";
    return scopeA < scopeB ? -1 : scopeA > scopeB ? 1 : 0;
  });
}

/**
 * Loads, parses, and validates one `.rvs/policies/*.yml` file into a fully
 * id-resolved, sorted `GovernancePolicy`. `generatedAt` is caller-supplied
 * (never `Date.now()`/`new Date()` internally, matching snapshot.ts's
 * `BuildIntelligenceSnapshotInput.generatedAt` convention) so this package's
 * output stays a pure function of its inputs.
 */
export function loadPolicyFile(filePath: string, generatedAt: string): GovernancePolicy {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Invalid policy file ${filePath}: not valid YAML (${err instanceof Error ? err.message : String(err)}).`);
  }

  const result = PolicyFileSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid policy file ${filePath}: ${details}`);
  }
  const parsed = result.data;

  const policyKey = parsed.id ?? parsed.name;
  const policyId = buildPolicyId(policyKey);

  const ruleIdByKey = new Map<string, string>();
  const rules: GovernanceRule[] = parsed.rules.map((rule) => {
    const ruleId = buildRuleId(policyId, rule.id);
    ruleIdByKey.set(rule.id, ruleId);
    return {
      id: ruleId,
      title: rule.title,
      description: rule.description,
      kind: rule.kind,
      condition: rule.condition,
      severity: rule.severity,
      enabled: rule.enabled,
      evidence_requirement: rule.evidence_requirement,
      effective_from: rule.effective_from,
      owner_ref: rule.owner_ref,
    };
  });

  const exceptions: GovernanceException[] = parsed.exceptions.map((exception) => {
    // Schema-level superRefine above already guarantees this key resolves.
    const ruleId = ruleIdByKey.get(exception.rule_id)!;
    return {
      policy_id: policyId,
      rule_id: ruleId,
      scope: exception.scope,
      reason: exception.reason,
      approval_reference: exception.approval_reference,
      expiry: exception.expiry,
      decision_ref: exception.decision_ref,
      evidence_refs: exception.evidence_refs as EvidenceRef[],
    };
  });

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: policyId,
    name: parsed.name,
    rules: sortRules(rules),
    exceptions: sortExceptions(exceptions),
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(parsed.evidence_refs as EvidenceRef[])),
    generation: { generated_at: generatedAt },
  };
}

/**
 * Loads every path in `filePaths`, collecting ALL validation failures
 * (rather than stopping at the first) so a caller sees every broken policy
 * file in one pass -- matching the CLI-failure-clarity requirement that a
 * multi-file config error names every offending file, not just the first
 * one encountered.
 */
export function loadPolicyFiles(filePaths: string[], generatedAt: string): GovernancePolicy[] {
  const policies: GovernancePolicy[] = [];
  const errors: string[] = [];
  for (const filePath of filePaths) {
    try {
      policies.push(loadPolicyFile(filePath, generatedAt));
    } catch (err) {
      errors.push(`  ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Failed to load ${errors.length} governance policy file(s):\n${errors.join("\n")}`);
  }
  return policies;
}
