import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { PortfolioConfig } from "./contracts.js";

// §5: `.rvs/portfolio.yml` identifies products and their artifact locations
// only — it never defines capabilities, relationships, or maturity by hand.
// Optional the same way `.rvs/product.yml` is optional (§27 precedent):
// loadPortfolioConfig() returns undefined when the file doesn't exist, and
// callers (the CLI) are responsible for requiring it before running
// `rvs synthesize portfolio`, since portfolio synthesis has no single-repo
// fallback the way product-identity synthesis does.

const PortfolioConfigProductSchema = z.object({
  id: z.string().min(1),
  artifact_root: z.string().min(1),
  alias_of: z.string().min(1).optional(),
});

const PortfolioConfigApprovedRelationshipSchema = z.object({
  product_a: z.string().min(1),
  product_b: z.string().min(1),
  relationship: z.enum([
    "shared_capability",
    "complementary_capability",
    "overlapping_capability",
    "upstream_dependency",
    "downstream_dependency",
    "shared_platform",
    "shared_contract",
    "shared_actor",
    "shared_workflow",
    "alternative_implementation",
    "unresolved",
  ]),
  note: z.string().optional(),
});

export const PortfolioConfigSchema = z.object({
  schema_version: z.literal(1),
  portfolio: z.object({
    id: z.string().min(1),
    display_name: z.string().min(1),
  }),
  products: z.array(PortfolioConfigProductSchema).min(1),
  audiences: z.array(z.string()).optional(),
  approved_relationships: z.array(PortfolioConfigApprovedRelationshipSchema).optional(),
  disallowed_claims: z.array(z.string()).optional(),
  runtime_claims: z.array(z.string()).optional(),
});

export const PORTFOLIO_CONFIG_RELATIVE_PATH = ".rvs/portfolio.yml";

export interface PortfolioConfigValidationError {
  message: string;
  field?: string;
}

/**
 * Structural rules the Zod shape alone cannot express (§5): duplicate
 * product ids must fail, a product may not point to an artifact root
 * another product already claims (without going through the explicit
 * `alias_of` field), and every artifact_root directory must exist.
 * Product/config ordering is deliberately not validated here — §5 requires
 * config ordering to never affect output ordering, which is enforced by
 * every downstream module sorting its own output, not by rejecting a
 * particular input order.
 */
// Local filesystem paths only — a scheme prefix (http://, ssh://, git://,
// ...) would silently be resolved as a relative path segment by `resolve()`
// rather than fetched, so this is a fail-fast misconfiguration check, not a
// real network boundary: this package never fetches or executes anything
// from an artifact_root, it only ever `readFileSync`s two known JSON
// filenames from it (intake.ts).
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

// Duplicate roots are compared through `fs.realpathSync` (not just the
// resolved path string) so a symlinked artifact_root that ultimately points
// at the same directory as another product's root is caught the same way a
// duplicate relative path would be — without this, two config entries could
// silently double-count one product's artifacts under two product ids.
function realArtifactRoot(resolvedRoot: string): string {
  try {
    return realpathSync(resolvedRoot);
  } catch {
    return resolvedRoot;
  }
}

export function validatePortfolioConfig(config: PortfolioConfig, repoRoot: string): PortfolioConfigValidationError[] {
  const errors: PortfolioConfigValidationError[] = [];
  const seenIds = new Set<string>();
  const rootToId = new Map<string, string>();

  for (const product of config.products) {
    if (seenIds.has(product.id)) {
      errors.push({ field: "products", message: `Duplicate product id "${product.id}".` });
    }
    seenIds.add(product.id);

    if (URL_SCHEME_PATTERN.test(product.artifact_root)) {
      errors.push({ field: "products", message: `Product "${product.id}" artifact_root "${product.artifact_root}" must be a local filesystem path, not a remote URL.` });
      continue;
    }

    const resolvedRoot = resolve(repoRoot, product.artifact_root);
    if (!existsSync(resolvedRoot)) {
      errors.push({ field: "products", message: `Product "${product.id}" artifact_root "${product.artifact_root}" does not exist.` });
      continue;
    }

    const realRoot = realArtifactRoot(resolvedRoot);
    if (!product.alias_of) {
      const existingId = rootToId.get(realRoot);
      if (existingId && existingId !== product.id) {
        errors.push({
          field: "products",
          message: `Product "${product.id}" points to the same artifact_root as "${existingId}" without an explicit alias_of.`,
        });
      }
      rootToId.set(realRoot, product.id);
    } else if (!seenIds.has(product.alias_of) && !config.products.some((p) => p.id === product.alias_of)) {
      errors.push({ field: "products", message: `Product "${product.id}" has alias_of "${product.alias_of}", which is not a declared product id.` });
    }
  }

  return errors;
}

export function portfolioConfigPath(repoRoot: string): string {
  return resolve(repoRoot, PORTFOLIO_CONFIG_RELATIVE_PATH);
}

export function loadPortfolioConfig(repoRoot: string): PortfolioConfig | undefined {
  const path = portfolioConfigPath(repoRoot);
  if (!existsSync(path)) return undefined;

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Invalid ${PORTFOLIO_CONFIG_RELATIVE_PATH}: not valid YAML (${err instanceof Error ? err.message : String(err)}).`);
  }

  // A raw ZodError's own .message is a multi-line JSON dump — every other
  // "Invalid .rvs/portfolio.yml: ..." error in this module (below, and in
  // validatePortfolioConfig) is one flat sentence, so this reduces
  // schema_version mismatches, missing fields, and unknown-shape config down
  // to the same single-line, stack-trace-free style (CLI errors are surfaced
  // via `err.message` alone — see packages/cli/src/bin.ts's top-level catch).
  const result = PortfolioConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ${PORTFOLIO_CONFIG_RELATIVE_PATH}: ${details}`);
  }
  const parsed = result.data as PortfolioConfig;

  const errors = validatePortfolioConfig(parsed, repoRoot);
  if (errors.length > 0) {
    throw new Error(`Invalid ${PORTFOLIO_CONFIG_RELATIVE_PATH}: ${errors.map((e) => e.message).join(" ")}`);
  }
  return parsed;
}
