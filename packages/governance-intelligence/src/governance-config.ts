import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { GovernanceSeverity } from "./contracts.js";

// ---------------------------------------------------------------------------
// loadGovernanceConfig -- mirrors @rvs/portfolio-intelligence/src/
// product-registry.ts's loadPortfolioConfig() pattern exactly: `.rvs/
// governance.yml` is OPTIONAL (undefined when absent, never thrown for
// "file doesn't exist"), YAML parse failures and schema-validation failures
// both throw a single flat-sentence Error (never a raw multi-line ZodError
// dump), and validation is entirely Zod-driven since this file's content is
// untrusted input straight from the repository the caller is scanning (spec
// §47) -- never eval'd, never dynamically require'd.
// ---------------------------------------------------------------------------

const GOVERNANCE_SEVERITIES = ["blocking", "review_required", "advisory", "informational"] as const satisfies readonly GovernanceSeverity[];

export const GovernanceConfigSchema = z
  .object({
    schema_version: z.literal(1),
    baseline: z
      .object({
        snapshot: z.string().min(1),
      })
      .strict()
      .optional(),
    comparison: z
      .object({
        fail_on: z.array(z.enum(GOVERNANCE_SEVERITIES)).optional(),
        warn_on: z.array(z.enum(GOVERNANCE_SEVERITIES)).optional(),
      })
      .strict()
      .optional(),
    policies: z.array(z.string().min(1)).optional(),
  })
  .strict();

export interface GovernanceConfig {
  schema_version: 1;
  baseline?: { snapshot: string };
  comparison?: { fail_on?: GovernanceSeverity[]; warn_on?: GovernanceSeverity[] };
  policies?: string[];
}

export const GOVERNANCE_CONFIG_RELATIVE_PATH = ".rvs/governance.yml";

export function governanceConfigPath(repoRoot: string): string {
  return resolve(repoRoot, GOVERNANCE_CONFIG_RELATIVE_PATH);
}

/**
 * Loads and validates `.rvs/governance.yml`. Returns `undefined` when the
 * file does not exist (optional-file semantics, matching
 * loadPortfolioConfig()/loadProductConfig()'s established convention) --
 * never throws for "file absent". Throws a clear, single-sentence Error for
 * malformed YAML or a schema violation (including an unrecognized severity
 * value in `fail_on`/`warn_on`, since those arrays are untrusted YAML input
 * that must be rejected loudly rather than silently coerced).
 */
export function loadGovernanceConfig(repoRoot: string): GovernanceConfig | undefined {
  const path = governanceConfigPath(repoRoot);
  if (!existsSync(path)) return undefined;

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Invalid ${GOVERNANCE_CONFIG_RELATIVE_PATH}: not valid YAML (${err instanceof Error ? err.message : String(err)}).`);
  }

  const result = GovernanceConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ${GOVERNANCE_CONFIG_RELATIVE_PATH}: ${details}`);
  }
  return result.data as GovernanceConfig;
}
