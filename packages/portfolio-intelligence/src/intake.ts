import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityModel } from "@rvs/product-intelligence";
import { assessCompatibility } from "./compatibility.js";
import type { PortfolioConfigProduct, PortfolioOptionalArtifact, PortfolioProductArtifacts, PortfolioProductInputIssue, PortfolioProductIntake } from "./contracts.js";

const OPTIONAL_ARTIFACTS: PortfolioOptionalArtifact[] = ["architecture-intelligence.json", "repository-model.json", "showcase-plan.json", "showcase-claims.json"];

function readJsonIfPresent<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * §2/§6: loads already-generated artifacts from a product's artifact root —
 * never re-scans a repository, never calls an external model. Optional
 * artifacts (architecture-intelligence.json, repository-model.json, etc.)
 * are recorded as present/absent but their content is not yet consumed by
 * any downstream module in this milestone; recording absence here keeps the
 * door open for a future module to opt into them without a second intake
 * pass, and satisfies §2's "do not silently skip" requirement for every
 * artifact class, not just the two required ones.
 */
export function intakeProduct(repoRoot: string, product: PortfolioConfigProduct): PortfolioProductIntake {
  const artifactRoot = resolve(repoRoot, product.artifact_root);
  const issues: PortfolioProductInputIssue[] = [];

  const artifacts: PortfolioProductArtifacts = {
    productIdentity: readJsonIfPresent<ProductIdentityModel>(resolve(artifactRoot, "product-identity.json")),
    capabilityModel: readJsonIfPresent<CapabilityModel>(resolve(artifactRoot, "capability-model.json")),
  };

  for (const optional of OPTIONAL_ARTIFACTS) {
    if (!existsSync(resolve(artifactRoot, optional))) {
      issues.push({ code: "optional-input-unavailable", artifact: optional, message: `${optional} was not found in the artifact root; enrichment from this artifact is skipped.` });
    }
  }

  const { status, issues: compatibilityIssues } = assessCompatibility(artifacts);
  const allIssues = [...issues, ...compatibilityIssues];
  const finalStatus = status === "compatible" && issues.length > 0 ? "compatible_with_warnings" : status;

  return {
    configId: product.id,
    artifactRoot: product.artifact_root,
    artifacts,
    compatibility: finalStatus,
    issues: allIssues,
  };
}

export function intakePortfolioProducts(repoRoot: string, products: PortfolioConfigProduct[]): PortfolioProductIntake[] {
  return products.map((product) => intakeProduct(repoRoot, product)).sort((a, b) => a.configId.localeCompare(b.configId));
}

export const PORTFOLIO_COMPATIBLE_STATUSES = new Set(["compatible", "compatible_with_warnings"]);

export function isCompatible(intake: PortfolioProductIntake): boolean {
  return PORTFOLIO_COMPATIBLE_STATUSES.has(intake.compatibility);
}
