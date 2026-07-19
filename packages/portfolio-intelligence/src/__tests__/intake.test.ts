import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

    it("reports input-invalid (not an uncaught exception) and treats the artifact as absent when product-identity.json contains malformed JSON", () => {
      const capabilityModel = makeCapabilityModel();
      const artifactRoot = writeArtifactRoot(repoRoot, "corrupt-product", { capabilityModel });
      writeFileSync(join(repoRoot, "artifacts", "corrupt-product", "product-identity.json"), "{ not valid json !!", "utf8");

      let intake: PortfolioProductIntake | undefined;
      expect(() => {
        intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "corrupt-product", artifact_root: artifactRoot }));
      }).not.toThrow();

      expect(intake!.artifacts.productIdentity).toBeUndefined();
      expect(intake!.artifacts.capabilityModel).toEqual(capabilityModel);
      expect(intake!.issues).toContainEqual(expect.objectContaining({ code: "input-invalid", artifact: "product-identity.json" }));
      // A corrupt required artifact still ultimately reads as "missing" to assessCompatibility, so the
      // product is excluded the same way an entirely-absent artifact would be -- never silently continued.
      expect(intake!.compatibility).toBe("missing_required_artifact");
      expect(isCompatible(intake!)).toBe(false);
    });

    it("reports input-invalid (not an uncaught exception) and treats the artifact as absent when capability-model.json contains malformed JSON", () => {
      const productIdentity = makeProductIdentityModel();
      const artifactRoot = writeArtifactRoot(repoRoot, "corrupt-product-2", { productIdentity });
      mkdirSync(join(repoRoot, "artifacts", "corrupt-product-2"), { recursive: true });
      writeFileSync(join(repoRoot, "artifacts", "corrupt-product-2", "capability-model.json"), "not json at all", "utf8");

      let intake: PortfolioProductIntake | undefined;
      expect(() => {
        intake = intakeProduct(repoRoot, makePortfolioConfigProduct({ id: "corrupt-product-2", artifact_root: artifactRoot }));
      }).not.toThrow();

      expect(intake!.artifacts.capabilityModel).toBeUndefined();
      expect(intake!.issues).toContainEqual(expect.objectContaining({ code: "input-invalid", artifact: "capability-model.json" }));
      expect(intake!.compatibility).toBe("missing_required_artifact");
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

    it("does not let one product's malformed JSON artifact crash intake for the rest of the batch", () => {
      writeArtifactRoot(repoRoot, "healthy-a", { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() });
      const corruptRoot = writeArtifactRoot(repoRoot, "corrupt-b", { capabilityModel: makeCapabilityModel() });
      writeFileSync(join(repoRoot, "artifacts", "corrupt-b", "product-identity.json"), "{{{ garbage", "utf8");
      writeArtifactRoot(repoRoot, "healthy-c", { productIdentity: makeProductIdentityModel(), capabilityModel: makeCapabilityModel() });

      let intakes: PortfolioProductIntake[] = [];
      expect(() => {
        intakes = intakePortfolioProducts(repoRoot, [
          makePortfolioConfigProduct({ id: "healthy-a", artifact_root: "./artifacts/healthy-a" }),
          makePortfolioConfigProduct({ id: "corrupt-b", artifact_root: corruptRoot }),
          makePortfolioConfigProduct({ id: "healthy-c", artifact_root: "./artifacts/healthy-c" }),
        ]);
      }).not.toThrow();

      expect(intakes.map((i) => i.configId)).toEqual(["corrupt-b", "healthy-a", "healthy-c"]);
      expect(isCompatible(intakes.find((i) => i.configId === "healthy-a")!)).toBe(true);
      expect(isCompatible(intakes.find((i) => i.configId === "healthy-c")!)).toBe(true);
      const corrupt = intakes.find((i) => i.configId === "corrupt-b")!;
      expect(corrupt.compatibility).toBe("missing_required_artifact");
      expect(corrupt.issues).toContainEqual(expect.objectContaining({ code: "input-invalid", artifact: "product-identity.json" }));
    });
  });

  describe("isCompatible / PORTFOLIO_COMPATIBLE_STATUSES", () => {
    it("PORTFOLIO_COMPATIBLE_STATUSES contains exactly compatible and compatible_with_warnings", () => {
      expect(PORTFOLIO_COMPATIBLE_STATUSES).toEqual(new Set(["compatible", "compatible_with_warnings"]));
    });

    it.each<PortfolioCompatibilityStatus>(["compatible", "compatible_with_warnings"])("returns true for %s", (status) => {
      expect(isCompatible(makeIntake(status))).toBe(true);
    });

    it.each<PortfolioCompatibilityStatus>(["missing_required_artifact", "unsupported_schema", "identity_mismatch", "stale_artifact_set"])("returns false for %s", (status) => {
      expect(isCompatible(makeIntake(status))).toBe(false);
    });
  });
});
