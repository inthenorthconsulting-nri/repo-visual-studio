import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { intakePortfolioProducts, intakeProduct, isCompatible, PORTFOLIO_COMPATIBLE_STATUSES } from "../intake.js";
import type { PortfolioCompatibilityStatus, PortfolioProductIntake } from "../contracts.js";
import { makeCapabilityModel, makePortfolioConfigProduct, makeProductIdentityModel, writeArtifactRoot } from "./fixtures.js";

function makeIntake(compatibility: PortfolioCompatibilityStatus): PortfolioProductIntake {
  return { configId: "x", artifactRoot: "./artifacts/x", artifacts: {}, compatibility, issues: [] };
}

describe("intake", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-portfolio-intake-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  describe("intakeProduct", () => {
    it("reads a self-consistent product-identity.json + capability-model.json pair from disk and reports compatible/compatible_with_warnings", () => {
      const capabilityModel = makeCapabilityModel();
      const productIdentity = makeProductIdentityModel();
      const artifactRoot = writeArtifactRoot(repoRoot, "widget-cli", { productIdentity, capabilityModel });

      const intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "widget-cli", artifact_root: artifactRoot }));

      expect(intake.configId).toBe("widget-cli");
      expect(["compatible", "compatible_with_warnings"]).toContain(intake.compatibility);
      expect(intake.artifacts.productIdentity).toEqual(productIdentity);
      expect(intake.artifacts.capabilityModel).toEqual(capabilityModel);
    });

    it("records optional-input-unavailable issues for every missing optional artifact but still reports the product compatible", () => {
      const capabilityModel = makeCapabilityModel();
      const productIdentity = makeProductIdentityModel();
      const artifactRoot = writeArtifactRoot(repoRoot, "widget-cli", { productIdentity, capabilityModel });

      const intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "widget-cli", artifact_root: artifactRoot }));

      const optionalIssues = intake.issues.filter((i) => i.code === "optional-input-unavailable");
      expect(optionalIssues.map((i) => i.artifact).sort()).toEqual(["architecture-intelligence.json", "repository-model.json", "showcase-claims.json", "showcase-plan.json"]);
      // Optional-artifact absence alone must not block compatibility — it only ever demotes compatible -> compatible_with_warnings, never to an incompatible status.
      expect(isCompatible(intake)).toBe(true);
      expect(intake.compatibility).toBe("compatible_with_warnings");
    });

    it("reports missing_required_artifact for an artifact root with no files at all", () => {
      const artifactRoot = writeArtifactRoot(repoRoot, "empty-product", {});

      const intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "empty-product", artifact_root: artifactRoot }));

      expect(intake.compatibility).toBe("missing_required_artifact");
      expect(intake.artifacts.productIdentity).toBeUndefined();
      expect(intake.artifacts.capabilityModel).toBeUndefined();
      expect(intake.issues.some((i) => i.code === "required-input-missing" && i.artifact === "product-identity.json")).toBe(true);
      expect(intake.issues.some((i) => i.code === "required-input-missing" && i.artifact === "capability-model.json")).toBe(true);
      expect(isCompatible(intake)).toBe(false);
    });

    it("reports missing_required_artifact when the artifact_root directory does not exist on disk at all", () => {
      const intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "nonexistent", artifact_root: "./artifacts/nonexistent" }));
      expect(intake.compatibility).toBe("missing_required_artifact");
      expect(isCompatible(intake)).toBe(false);
    });

    it("reports only capability-model.json missing when just that file is absent", () => {
      const productIdentity = makeProductIdentityModel();
      const artifactRoot = writeArtifactRoot(repoRoot, "half-product", { productIdentity });

      const intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "half-product", artifact_root: artifactRoot }));

      expect(intake.compatibility).toBe("missing_required_artifact");
      expect(intake.artifacts.productIdentity).toEqual(productIdentity);
      expect(intake.artifacts.capabilityModel).toBeUndefined();
      expect(intake.issues.filter((i) => i.code === "required-input-missing")).toHaveLength(1);
    });
  });

  describe("intakePortfolioProducts", () => {
    it("sorts the returned intakes by configId, independent of input/config order", () => {
      writeArtifactRoot(repoRoot, "zebra", { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() });
      writeArtifactRoot(repoRoot, "alpha", { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() });
      writeArtifactRoot(repoRoot, "mid", { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() });

      const intakes = intakePortfolioProducts(repoRoot, [
        makePortfolioConfigProduct({ id: "zebra", artifact_root: "./artifacts/zebra" }),
        makePortfolioConfigProduct({ id: "alpha", artifact_root: "./artifacts/alpha" }),
        makePortfolioConfigProduct({ id: "mid", artifact_root: "./artifacts/mid" }),
      ]);

      expect(intakes.map((i) => i.configId)).toEqual(["alpha", "mid", "zebra"]);
    });
  });

  describe("isCompatible / PORTFOLIO_COMPATIBLE_STATUSES", () => {
    it("PORTFOLIO_COMPATIBLE_STATUSES contains exactly compatible and compatible_with_warnings", () => {
      expect(PORTFOLIO_COMPATIBLE_STATUSES).toEqual(new Set(["compatible", "compatible_with_warnings"]));
    });

    it.each<PortfolioCompatibilityStatus>(["compatible", "compatible_with_warnings"])("returns true for %s", (status) => {
      expect(isCompatible(makeIntake(status))).toBe(true);
    });

    it.each<PortfolioCompatibilityStatus>(["incompatible", "missing_required_artifact", "unsupported_schema", "identity_mismatch", "stale_artifact_set"])("returns false for %s", (status) => {
      expect(isCompatible(makeIntake(status))).toBe(false);
    });
  });
});
