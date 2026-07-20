import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// loadDecisionsConfig -- mirrors @rvs/governance-intelligence/src/
// governance-config.ts's loadGovernanceConfig() pattern exactly: `.rvs/
// decisions.yml` is OPTIONAL (undefined when absent, never thrown for
// "file doesn't exist"), YAML parse failures and schema-validation failures
// both throw a single flat-sentence Error (never a raw multi-line ZodError
// dump), and validation is entirely Zod-driven since this file's content is
// untrusted input straight from the repository being scanned -- never
// eval'd, never dynamically require'd.
// ---------------------------------------------------------------------------

const DECISION_SOURCE_TYPES = ["adr", "rfc", "design_decision", "decision_log"] as const;

const DecisionSourceConfigSchema = z
  .object({
    path: z.string().min(1),
    type: z.enum(DECISION_SOURCE_TYPES),
    include: z.array(z.string().min(1)).optional(),
  })
  .strict();

const MISSING_DECISION_RULE_KINDS = [
  "runtime_entrypoint_change_without_decision",
  "shared_contract_change_without_decision",
  "baseline_replacement_without_decision",
  "policy_exception_without_decision",
  "product_role_change_without_decision",
  "portfolio_relationship_change_without_decision",
] as const;

const MissingDecisionRuleConfigSchema = z
  .object({
    rule_kind: z.enum(MISSING_DECISION_RULE_KINDS),
    affected_entity_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();

const CriticalityConfigSchema = z
  .object({
    critical_decision_ids: z.array(z.string().min(1)).optional(),
    shared_contract_entity_ids: z.array(z.string().min(1)).optional(),
    runtime_entrypoint_entity_ids: z.array(z.string().min(1)).optional(),
    portfolio_dependency_entity_ids: z.array(z.string().min(1)).optional(),
    critical_capability_entity_ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

const DecisionsConfigSchema = z
  .object({
    schema_version: z.literal(1),
    sources: z.array(DecisionSourceConfigSchema).min(1),
    status_mapping: z.record(z.string(), z.array(z.string().min(1))).optional(),
    identity: z
      .object({
        prefer: z.array(z.enum(["configured_id", "frontmatter.id", "filename", "path", "content_digest"])).optional(),
      })
      .strict()
      .optional(),
    repository: z.object({ id: z.string().min(1) }).strict().optional(),
    missing_decision_rules: z.array(MissingDecisionRuleConfigSchema).optional(),
    criticality: CriticalityConfigSchema.optional(),
  })
  .strict();

export interface DecisionSourceConfig {
  path: string;
  type: "adr" | "rfc" | "design_decision" | "decision_log";
  include?: string[];
}

export type MissingDecisionRuleKindConfig =
  | "runtime_entrypoint_change_without_decision"
  | "shared_contract_change_without_decision"
  | "baseline_replacement_without_decision"
  | "policy_exception_without_decision"
  | "product_role_change_without_decision"
  | "portfolio_relationship_change_without_decision";

export interface MissingDecisionRuleConfig {
  rule_kind: MissingDecisionRuleKindConfig;
  affected_entity_ids: string[];
}

export interface CriticalityConfig {
  critical_decision_ids?: string[];
  shared_contract_entity_ids?: string[];
  runtime_entrypoint_entity_ids?: string[];
  portfolio_dependency_entity_ids?: string[];
  critical_capability_entity_ids?: string[];
}

export interface DecisionsConfig {
  schema_version: 1;
  sources: DecisionSourceConfig[];
  status_mapping?: Record<string, string[]>;
  identity?: { prefer?: string[] };
  repository?: { id: string };
  missing_decision_rules?: MissingDecisionRuleConfig[];
  criticality?: CriticalityConfig;
}

export const DECISIONS_CONFIG_RELATIVE_PATH = ".rvs/decisions.yml";

export function decisionsConfigPath(repoRoot: string): string {
  return resolve(repoRoot, DECISIONS_CONFIG_RELATIVE_PATH);
}

/**
 * Loads and validates `.rvs/decisions.yml`. Returns `undefined` when the
 * file does not exist (optional-file semantics) -- never throws for "file
 * absent". Throws a clear, single-sentence Error for malformed YAML or a
 * schema violation. Without this file, decision discovery has nothing to
 * scan and `rvs decisions analyze` reports zero decisions rather than
 * guessing at conventional paths.
 */
export function loadDecisionsConfig(repoRoot: string): DecisionsConfig | undefined {
  const path = decisionsConfigPath(repoRoot);
  if (!existsSync(path)) return undefined;

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Invalid ${DECISIONS_CONFIG_RELATIVE_PATH}: not valid YAML (${err instanceof Error ? err.message : String(err)}).`);
  }

  const result = DecisionsConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ${DECISIONS_CONFIG_RELATIVE_PATH}: ${details}`);
  }
  return result.data as DecisionsConfig;
}
