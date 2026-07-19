import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ProductIdentityOverride } from "./contracts.js";
import { containsAbsoluteSuperiorityTerm, containsGenericMarketingTerm } from "./label.js";

// §27: `.rvs/product.yml` is optional — identity synthesis must produce a
// complete, valid ProductIdentity with no override file present at all.
export const ProductIdentityOverrideSchema = z.object({
  schema_version: z.literal(1),
  display_name: z.string().min(1).max(80).optional(),
  descriptor_override: z.string().min(1).max(120).optional(),
  purpose_override: z.string().min(1).max(400).optional(),
  primary_users: z.array(z.string().min(1)).max(3).optional(),
  approved_terms: z.array(z.string()).optional(),
  disallowed_terms: z.array(z.string()).optional(),
  runtime_claims: z.array(z.string().min(1)).optional(),
});

export const PRODUCT_OVERRIDE_RELATIVE_PATH = ".rvs/product.yml";

export interface ProductOverrideValidationError {
  message: string;
  field?: string;
}

/**
 * §27: an override cannot promote roadmap/excluded capabilities or
 * introduce unsupported marketing/comparative language — those constraints
 * cannot be expressed in the Zod shape alone (they depend on text content),
 * so this second pass runs after schema parsing and every failure here
 * makes the override invalid (never silently ignored, never silently
 * accepted). `approved_terms` narrowly lifts this check for a human-cleared
 * term, but only for the three fields the override already has direct
 * authority over (display_name/descriptor_override/purpose_override) — it
 * has no reach into evidence-derived value pillars, differentiators,
 * capabilities, or limitations (see validateProductIdentityModel's
 * disallowed_terms check, which those remain subject to).
 */
export function validateProductIdentityOverride(override: ProductIdentityOverride): ProductOverrideValidationError[] {
  const errors: ProductOverrideValidationError[] = [];
  const approvedTerms = new Set((override.approved_terms ?? []).map((t) => t.toLowerCase()));
  const textFields: [string, string | undefined][] = [
    ["display_name", override.display_name],
    ["descriptor_override", override.descriptor_override],
    ["purpose_override", override.purpose_override],
  ];
  for (const [field, value] of textFields) {
    if (!value) continue;
    const marketingTerm = containsGenericMarketingTerm(value);
    if (marketingTerm && !approvedTerms.has(marketingTerm)) errors.push({ field, message: `"${field}" contains unsupported marketing language: "${marketingTerm}".` });
    const absoluteTerm = containsAbsoluteSuperiorityTerm(value);
    if (absoluteTerm && !approvedTerms.has(absoluteTerm)) errors.push({ field, message: `"${field}" contains unsupported comparative language: "${absoluteTerm}".` });
  }
  return errors;
}

export function productOverridePath(repoRoot: string): string {
  return resolve(repoRoot, PRODUCT_OVERRIDE_RELATIVE_PATH);
}

/** Returns undefined when no override file exists — optionality is load-bearing, not an error path. */
export function loadProductIdentityOverride(repoRoot: string): ProductIdentityOverride | undefined {
  const path = productOverridePath(repoRoot);
  if (!existsSync(path)) return undefined;
  const raw = parseYaml(readFileSync(path, "utf8"));
  const parsed = ProductIdentityOverrideSchema.parse(raw);
  const errors = validateProductIdentityOverride(parsed);
  if (errors.length > 0) {
    throw new Error(`Invalid ${PRODUCT_OVERRIDE_RELATIVE_PATH}: ${errors.map((e) => e.message).join(" ")}`);
  }
  return parsed;
}
