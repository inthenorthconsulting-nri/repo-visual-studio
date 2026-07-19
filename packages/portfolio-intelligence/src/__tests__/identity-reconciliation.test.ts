import { describe, expect, it } from "vitest";
import {
  buildPortfolioProduct,
  buildPortfolioProducts,
  classifyPrimaryRole,
  classifySecondaryRoles,
  detectReconciliationSignals,
  resolveCanonicalProductIds,
} from "../identity-reconciliation.js";
import { portfolioProductId } from "../ids.js";
import { makeCapabilityModel, makePortfolioConfigProduct, makePortfolioProduct, makePortfolioProductIntake, makeProductIdentityModel } from "./fixtures.js";

describe("resolveCanonicalProductIds", () => {
  it("resolves a product with no alias_of to itself", () => {
    const products = [makePortfolioConfigProduct({ id: "governance-cli" }), makePortfolioConfigProduct({ id: "ops-cli", artifact_root: "./artifacts/ops-cli" })];
    const canonical = resolveCanonicalProductIds(products);
    expect(canonical.get("governance-cli")).toBe("governance-cli");
    expect(canonical.get("ops-cli")).toBe("ops-cli");
  });

  it("resolves a direct alias_of to its declared root", () => {
    const products = [
      makePortfolioConfigProduct({ id: "governance-cli" }),
      makePortfolioConfigProduct({ id: "governance-cli-legacy", artifact_root: "./artifacts/governance-cli-legacy", alias_of: "governance-cli" }),
    ];
    const canonical = resolveCanonicalProductIds(products);
    expect(canonical.get("governance-cli-legacy")).toBe("governance-cli");
    expect(canonical.get("governance-cli")).toBe("governance-cli");
  });

  it("resolves a chained alias_of (C -> B -> A) to the ultimate root A", () => {
    const products = [
      makePortfolioConfigProduct({ id: "product-a" }),
      makePortfolioConfigProduct({ id: "product-b", artifact_root: "./artifacts/product-b", alias_of: "product-a" }),
      makePortfolioConfigProduct({ id: "product-c", artifact_root: "./artifacts/product-c", alias_of: "product-b" }),
    ];
    const canonical = resolveCanonicalProductIds(products);
    expect(canonical.get("product-c")).toBe("product-a");
    expect(canonical.get("product-b")).toBe("product-a");
    expect(canonical.get("product-a")).toBe("product-a");
  });
});

describe("classifyPrimaryRole", () => {
  it("maps governance_platform to governance_system", () => {
    expect(classifyPrimaryRole("governance_platform", [])).toBe("governance_system");
  });

  it.each([
    ["migration_platform", "migration_system"],
    ["developer_tool", "developer_tool"],
    ["library", "shared_library"],
    ["framework", "shared_library"],
    ["integration_platform", "integration_layer"],
    ["data_product", "domain_product"],
    ["control_plane", "control_plane"],
    ["automation_platform", "operations_system"],
    ["observability_platform", "reliability_system"],
    ["reliability_platform", "reliability_system"],
    ["operations_platform", "operations_system"],
  ] as const)("maps %s to %s", (archetype, expected) => {
    expect(classifyPrimaryRole(archetype, [])).toBe(expected);
  });

  it("maps an 'unknown' archetype whose capability domain id contains a presentation keyword (e.g. 'visualization') to presentation_system — the one role with no direct archetype analog", () => {
    expect(classifyPrimaryRole("unknown", ["capintel:domain:data-visualization"])).toBe("presentation_system");
  });

  it("does not classify as presentation_system when the archetype is unknown but no domain id contains a presentation keyword", () => {
    expect(classifyPrimaryRole("unknown", ["capintel:domain:widget-operations"])).toBe("unknown");
  });

  it("does not classify as presentation_system when a presentation keyword is present but the archetype is not unknown", () => {
    expect(classifyPrimaryRole("governance_platform", ["capintel:domain:data-visualization"])).toBe("governance_system");
  });
});

describe("classifySecondaryRoles", () => {
  it("derives secondary roles from secondary archetypes, excluding the primary and 'unknown'", () => {
    const roles = classifySecondaryRoles("governance_system", ["developer_tool"], []);
    expect(roles).toEqual(["developer_tool"]);
  });

  it("excludes a secondary archetype whose role equals the primary role", () => {
    // automation_platform and operations_platform both map to operations_system.
    const roles = classifySecondaryRoles("operations_system", ["automation_platform"], []);
    expect(roles).toEqual([]);
  });

  it("excludes secondary archetypes that resolve to 'unknown'", () => {
    const roles = classifySecondaryRoles("governance_system", ["unknown"], []);
    expect(roles).toEqual([]);
  });

  it("adds presentation_system when a capability domain id suggests presentation and it is not already the primary role", () => {
    const roles = classifySecondaryRoles("governance_system", [], ["capintel:domain:storytelling-hub"]);
    expect(roles).toContain("presentation_system");
  });

  it("does not add presentation_system a second time when it is already the primary role", () => {
    const roles = classifySecondaryRoles("presentation_system", [], ["capintel:domain:narrative-hub"]);
    expect(roles).not.toContain("presentation_system");
  });

  it("caps secondary roles at 2 entries, sorted alphabetically", () => {
    const roles = classifySecondaryRoles("governance_system", ["developer_tool", "migration_platform", "control_plane"], []);
    expect(roles.length).toBeLessThanOrEqual(2);
    expect(roles).toEqual([...roles].sort((a, b) => a.localeCompare(b)));
  });
});

describe("buildPortfolioProduct", () => {
  it("derives id from configId, capability counts from currentCapabilities/qualifiedCapabilities, and role from the identity's archetype, sorting the id lists regardless of the source artifact's order", () => {
    const intake = makePortfolioProductIntake({
      configId: "governance-cli",
      artifacts: {
        // Deliberately unsorted in the source artifact -- product-identity.json is read back
        // across a serialization boundary, so buildPortfolioProduct() must not trust that
        // whatever produced it upheld @rvs/product-intelligence's own sort-before-write
        // convention (§4 determinism audit).
        productIdentity: makeProductIdentityModel(
          {},
          { displayName: "Governance CLI", archetype: "governance_platform", currentCapabilities: ["capintel:capability:widget-sync", "capintel:capability:widget-audit"], qualifiedCapabilities: ["capintel:capability:widget-report"] },
        ),
        capabilityModel: makeCapabilityModel(),
      },
    });

    const product = buildPortfolioProduct(intake);

    expect(product.id).toBe(portfolioProductId("governance-cli"));
    expect(product.displayName).toBe("Governance CLI");
    expect(product.primaryArchetype).toBe("governance_platform");
    expect(product.primaryRole).toBe("governance_system");
    expect(product.currentCapabilityIds).toEqual(["capintel:capability:widget-audit", "capintel:capability:widget-sync"]);
    expect(product.qualifiedCapabilityIds).toEqual(["capintel:capability:widget-report"]);
    expect(product.currentCapabilityCount).toBe(2);
    expect(product.qualifiedCapabilityCount).toBe(1);
    expect(product.source.configId).toBe("governance-cli");
    expect(product.source.compatibility).toBe("compatible");
  });

  it("carries source generation timestamps through from the underlying artifacts", () => {
    const defaultIdentityModel = makeProductIdentityModel();
    const defaultCapabilityModel = makeCapabilityModel();
    const intake = makePortfolioProductIntake({
      artifacts: {
        productIdentity: makeProductIdentityModel({ generationMetadata: { ...defaultIdentityModel.generationMetadata, generated_at: "2026-01-01T00:00:00.000Z" } }),
        capabilityModel: makeCapabilityModel({ generationMetadata: { ...defaultCapabilityModel.generationMetadata, generated_at: "2026-02-02T00:00:00.000Z" } }),
      },
    });
    const product = buildPortfolioProduct(intake);
    expect(product.source.sourceProductIdentityGeneratedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(product.source.sourceCapabilityModelGeneratedAt).toBe("2026-02-02T00:00:00.000Z");
  });
});

describe("buildPortfolioProducts", () => {
  it("builds and sorts products by id", () => {
    const intakeB = makePortfolioProductIntake({ configId: "zzz-product" });
    const intakeA = makePortfolioProductIntake({ configId: "aaa-product" });
    const products = buildPortfolioProducts([intakeB, intakeA]);
    expect(products.map((p) => p.id)).toEqual([portfolioProductId("aaa-product"), portfolioProductId("zzz-product")]);
    expect(products).toEqual([...products].sort((a, b) => a.id.localeCompare(b.id)));
  });
});

describe("detectReconciliationSignals", () => {
  it("flags duplicate_display_name when two products share a normalized display name", () => {
    const a = makePortfolioProduct({ displayName: "Governance CLI", source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const b = makePortfolioProduct({ displayName: "  governance cli  ", primaryArchetype: "operations_platform", primaryRole: "operations_system", source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const signals = detectReconciliationSignals([a, b]);
    const dup = signals.find((s) => s.kind === "duplicate_display_name");
    expect(dup).toBeDefined();
    expect(dup!.productIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("flags identical_primary_archetype when two products share a primary archetype", () => {
    const a = makePortfolioProduct({ displayName: "Governance CLI", primaryArchetype: "governance_platform", source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const b = makePortfolioProduct({ displayName: "Compliance Suite", primaryArchetype: "governance_platform", source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const signals = detectReconciliationSignals([a, b]);
    const dup = signals.find((s) => s.kind === "identical_primary_archetype");
    expect(dup).toBeDefined();
    expect(dup!.productIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("does not treat two products both archetyped 'unknown' as sharing a primary archetype", () => {
    const a = makePortfolioProduct({ displayName: "Product A", primaryArchetype: "unknown", primaryRole: "unknown", source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const b = makePortfolioProduct({ displayName: "Product B", primaryArchetype: "unknown", primaryRole: "unknown", source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const signals = detectReconciliationSignals([a, b]);
    expect(signals.find((s) => s.kind === "identical_primary_archetype")).toBeUndefined();
  });

  it("emits no signals when display names and primary archetypes are both distinct", () => {
    const a = makePortfolioProduct({ displayName: "Governance CLI", primaryArchetype: "governance_platform", source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const b = makePortfolioProduct({ displayName: "Ops Dashboard", primaryArchetype: "operations_platform", primaryRole: "operations_system", source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const signals = detectReconciliationSignals([a, b]);
    expect(signals).toEqual([]);
  });
});
