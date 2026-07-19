import { CAPABILITY_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/capability-intelligence";
import { PRODUCT_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/product-intelligence";
import type { PortfolioCompatibilityStatus, PortfolioProductArtifacts, PortfolioProductInputIssue } from "./contracts.js";

/**
 * §6: the 8-step intake/compatibility process, minus artifact loading itself
 * (intake.ts's responsibility) — this module only judges an already-loaded
 * bundle. Never continues silently with an incompatible product: every
 * status other than "compatible"/"compatible_with_warnings" must cause the
 * caller to exclude the product unless --allow-partial-portfolio is set.
 */
export function assessCompatibility(artifacts: PortfolioProductArtifacts): { status: PortfolioCompatibilityStatus; issues: PortfolioProductInputIssue[] } {
  const issues: PortfolioProductInputIssue[] = [];

  if (!artifacts.productIdentity) {
    issues.push({ code: "required-input-missing", artifact: "product-identity.json", message: "product-identity.json was not found in the artifact root." });
  }
  if (!artifacts.capabilityModel) {
    issues.push({ code: "required-input-missing", artifact: "capability-model.json", message: "capability-model.json was not found in the artifact root." });
  }
  if (issues.length > 0) {
    return { status: "missing_required_artifact", issues };
  }

  const identity = artifacts.productIdentity!;
  const capabilityModel = artifacts.capabilityModel!;

  if (identity.schemaVersion !== PRODUCT_INTELLIGENCE_SCHEMA_VERSION) {
    issues.push({
      code: "input-generated-by-unsupported-schema-version",
      artifact: "product-identity.json",
      message: `product-identity.json schema_version ${identity.schemaVersion} is not supported (expected ${PRODUCT_INTELLIGENCE_SCHEMA_VERSION}).`,
    });
  }
  if (capabilityModel.schemaVersion !== CAPABILITY_INTELLIGENCE_SCHEMA_VERSION) {
    issues.push({
      code: "input-generated-by-unsupported-schema-version",
      artifact: "capability-model.json",
      message: `capability-model.json schema_version ${capabilityModel.schemaVersion} is not supported (expected ${CAPABILITY_INTELLIGENCE_SCHEMA_VERSION}).`,
    });
  }
  if (issues.length > 0) {
    return { status: "unsupported_schema", issues };
  }

  // Identity consistency (§6 step 4): the ProductIdentityModel's own
  // currentCapabilities/qualifiedCapabilities id lists must intersect the
  // CapabilityModel's included/qualified capability ids — if none match,
  // the two artifacts almost certainly describe different repositories
  // (e.g. one artifact root accidentally mixes two products' cache files).
  const capabilityIds = new Set([...capabilityModel.includedCapabilities.map((c) => c.id), ...capabilityModel.qualifiedCapabilities.map((c) => c.id)]);
  const identityCapabilityIds = [...identity.identity.currentCapabilities, ...identity.identity.qualifiedCapabilities];
  if (identityCapabilityIds.length > 0 && !identityCapabilityIds.some((id) => capabilityIds.has(id))) {
    issues.push({
      code: "input-incompatible",
      artifact: "product-identity.json",
      message: "product-identity.json references no capability ids present in capability-model.json — the two artifacts appear to describe different products.",
    });
    return { status: "identity_mismatch", issues };
  }

  // Staleness (§6 step 6): product-identity synthesis stamps the exact
  // generated_at of the CapabilityModel it was derived from — if that no
  // longer matches the CapabilityModel actually present, the artifact set
  // is a mixed-generation set (one artifact regenerated, the other not).
  if (identity.generationMetadata.source_capability_model_generated_at !== capabilityModel.generationMetadata.generated_at) {
    issues.push({
      code: "input-stale",
      artifact: "product-identity.json",
      message: "product-identity.json was generated from a different capability-model.json generation than the one present in this artifact root.",
    });
    return { status: "stale_artifact_set", issues };
  }

  return { status: "compatible", issues };
}
