import { describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { capabilityRefKey, type ProductCapabilityRef } from "../capability-normalization.js";
import { classifyAllCapabilityPairs, classifyCapabilityPair } from "../capability-relationships.js";
import { makeCapability, makeCapabilityEvidence, makeCapabilityModel, makePortfolioProduct } from "./fixtures.js";

function ref(productId: string, configId: string, capability: ReturnType<typeof makeCapability>): ProductCapabilityRef {
  return { productId, configId, capability, qualified: false };
}

const productAId = "portfolio:product:product-a";
const productBId = "portfolio:product:product-b";

describe("classifyCapabilityPair", () => {
  it("throws when both capability refs come from the same product", () => {
    const a = ref(productAId, "product-a", makeCapability({ sourceLabel: "Widget Sync" }));
    const b = ref(productAId, "product-a", makeCapability({ sourceLabel: "Widget Sync 2" }));
    expect(() => classifyCapabilityPair(a, b, new Map())).toThrow();
  });

  it("classifies as 'shared' whenever normalization already grouped the pair under the same normalized capability id, regardless of score", () => {
    const a = ref(productAId, "product-a", makeCapability({ sourceLabel: "Widget Sync" }));
    const b = ref(productBId, "product-b", makeCapability({ sourceLabel: "Report Export", purpose: "Produces customer report exports." }));
    const refToCapabilityId = new Map<string, string>([
      [capabilityRefKey(a), "portfolio:capability:merged"],
      [capabilityRefKey(b), "portfolio:capability:merged"],
    ]);
    const result = classifyCapabilityPair(a, b, refToCapabilityId);
    expect(result.relationship).toBe("shared");
  });

  it("classifies as 'distinct' when the two capabilities share almost nothing (score below RELATED_FLOOR = 0.2)", () => {
    const a = ref(
      productAId,
      "product-a",
      makeCapability({
        sourceLabel: "Widget Sync",
        purpose: "Handles synchronization of widget state.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const b = ref(
      productBId,
      "product-b",
      makeCapability({
        sourceLabel: "Report Export",
        purpose: "Produces customer report exports.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Analyst"],
        workflows: ["report-generation"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("test")],
      }),
    );
    const result = classifyCapabilityPair(a, b, new Map());
    expect(result.score).toBeLessThan(0.2);
    expect(result.relationship).toBe("distinct");
  });

  it("classifies as 'unresolved' when score crosses SAME_CAPABILITY_THRESHOLD (0.5) via structural signals alone but nameOverlap is zero, failing the multi-signal gate", () => {
    const a = ref(
      productAId,
      "product-a",
      makeCapability({
        sourceLabel: "Widget Sync",
        purpose: "Handles synchronization of widget state.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        externalSystems: ["ExternalCRM"],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const b = ref(
      productBId,
      "product-b",
      makeCapability({
        sourceLabel: "Report Export",
        purpose: "Produces customer report exports.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        externalSystems: ["ExternalCRM"],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const result = classifyCapabilityPair(a, b, new Map());
    expect(result.signals.nameOverlap).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.relationship).toBe("unresolved");
  });

  it("classifies as 'alternative_implementation' when domains agree but each capability integrates with different, non-overlapping external systems", () => {
    const a = ref(
      productAId,
      "product-a",
      makeCapability({
        sourceLabel: "Widget Identity Sync",
        purpose: "Synchronizes widget identity records across systems.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["identity-lifecycle"],
        externalSystems: ["SystemX"],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const b = ref(
      productBId,
      "product-b",
      makeCapability({
        sourceLabel: "Widget Identity Sync",
        purpose: "Synchronizes widget identity records across systems.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Analyst"],
        workflows: ["report-generation"],
        externalSystems: ["SystemY"],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const result = classifyCapabilityPair(a, b, new Map());
    expect(result.signals.domainOverlap).toBeGreaterThan(0);
    expect(result.signals.externalSystemOverlap).toBe(0);
    expect(result.relationship).toBe("alternative_implementation");
  });

  it("classifies as 'complementary' when actors or workflows agree but capability naming/purpose is largely dissimilar (nameOverlap < 0.3), and no external-system conflict exists", () => {
    const a = ref(
      productAId,
      "product-a",
      makeCapability({
        sourceLabel: "Widget Provisioning",
        purpose: "Provisions new widget tenants for onboarding.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const b = ref(
      productBId,
      "product-b",
      makeCapability({
        sourceLabel: "Widget Decommissioning",
        purpose: "Retires stale widget tenants at end of life.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Operator"],
        workflows: ["decommission-flow"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const result = classifyCapabilityPair(a, b, new Map());
    expect(result.signals.nameOverlap).toBeLessThan(0.3);
    expect(result.signals.actorOverlap).toBeGreaterThan(0);
    expect(result.relationship).toBe("complementary");
  });

  it("classifies as 'overlapping' when score clears OVERLAPPING_FLOOR (0.35) with agreeing name/actor/domain signals but the pair does not clear the full 'same capability' gate", () => {
    const a = ref(
      productAId,
      "product-a",
      makeCapability({
        sourceLabel: "Widget Compliance Review",
        purpose: "Reviews widget compliance state for audit trails.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Compliance Officer"],
        workflows: ["compliance-review"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const b = ref(
      productBId,
      "product-b",
      makeCapability({
        sourceLabel: "Widget Compliance Audit",
        purpose: "Audits widget compliance state for review trails.",
        domainId: "capintel:domain:widget-operations",
        actors: ["Compliance Officer"],
        workflows: ["audit-pipeline"],
        externalSystems: [],
        evidence: [makeCapabilityEvidence("implementation")],
      }),
    );
    const result = classifyCapabilityPair(a, b, new Map());
    expect(result.score).toBeGreaterThanOrEqual(0.35);
    expect(result.signals.nameOverlap).toBeGreaterThanOrEqual(0.3);
    expect(result.signals.actorOverlap).toBeGreaterThan(0);
    expect(result.relationship).toBe("overlapping");
  });
});

describe("classifyAllCapabilityPairs", () => {
  function twoProducts() {
    const productA = makePortfolioProduct({ displayName: "Product A", source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const productB = makePortfolioProduct({ displayName: "Product B", source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    return { productA, productB };
  }

  it("never emits a 'shared' relationship — those are already represented by normalizePortfolioCapabilities", () => {
    const { productA, productB } = twoProducts();
    const capA = makeCapability({
      sourceLabel: "Widget Identity Sync",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
    });
    const capB = makeCapability({
      sourceLabel: "Widget Identity Sync",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
    });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB] });
    const productAWithCap = { ...productA, currentCapabilityIds: [capA.id] };
    const productBWithCap = { ...productB, currentCapabilityIds: [capB.id] };
    const capabilityModelsByProductId = new Map<string, CapabilityModel>([
      [productAWithCap.id, modelA],
      [productBWithCap.id, modelB],
    ]);
    const refToCapabilityId = new Map<string, string>([
      [`${productAWithCap.id}::${capA.id}`, "portfolio:capability:merged"],
      [`${productBWithCap.id}::${capB.id}`, "portfolio:capability:merged"],
    ]);

    const results = classifyAllCapabilityPairs([productAWithCap, productBWithCap], capabilityModelsByProductId, refToCapabilityId, { includeDistinct: true });

    expect(results.every((r) => r.relationship !== "shared")).toBe(true);
  });

  it("includes 'distinct' pairs only when options.includeDistinct is true", () => {
    const { productA, productB } = twoProducts();
    const capA = makeCapability({
      sourceLabel: "Widget Sync",
      purpose: "Handles synchronization of widget state.",
      domainId: "capintel:domain:widget-operations",
      actors: ["Operator"],
      workflows: ["widget-lifecycle"],
      externalSystems: [],
      evidence: [makeCapabilityEvidence("implementation")],
    });
    const capB = makeCapability({
      sourceLabel: "Report Export",
      purpose: "Produces customer report exports.",
      domainId: "capintel:domain:widget-operations",
      actors: ["Analyst"],
      workflows: ["report-generation"],
      externalSystems: [],
      evidence: [makeCapabilityEvidence("test")],
    });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB] });
    const productAWithCap = { ...productA, currentCapabilityIds: [capA.id] };
    const productBWithCap = { ...productB, currentCapabilityIds: [capB.id] };
    const capabilityModelsByProductId = new Map<string, CapabilityModel>([
      [productAWithCap.id, modelA],
      [productBWithCap.id, modelB],
    ]);

    const withoutDistinct = classifyAllCapabilityPairs([productAWithCap, productBWithCap], capabilityModelsByProductId, new Map());
    expect(withoutDistinct.some((r) => r.relationship === "distinct")).toBe(false);

    const withDistinct = classifyAllCapabilityPairs([productAWithCap, productBWithCap], capabilityModelsByProductId, new Map(), { includeDistinct: true });
    expect(withDistinct.some((r) => r.relationship === "distinct")).toBe(true);
  });

  it("never compares two capabilities from the same product and returns results sorted by productA/productB/capabilityA/capabilityB ids", () => {
    const { productA, productB } = twoProducts();
    const capA1 = makeCapability({ sourceLabel: "Widget Provisioning", purpose: "Provisions new widget tenants.", actors: ["Operator"], workflows: ["widget-lifecycle"] });
    const capA2 = makeCapability({ sourceLabel: "Widget Decommissioning", purpose: "Retires widget tenants.", actors: ["Operator"], workflows: ["decommission-flow"] });
    const capB1 = makeCapability({ sourceLabel: "Report Export", purpose: "Produces customer report exports.", actors: ["Analyst"], workflows: ["report-generation"] });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA1, capA2] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB1] });
    const productAWithCaps = { ...productA, currentCapabilityIds: [capA1.id, capA2.id] };
    const productBWithCaps = { ...productB, currentCapabilityIds: [capB1.id] };
    const capabilityModelsByProductId = new Map<string, CapabilityModel>([
      [productAWithCaps.id, modelA],
      [productBWithCaps.id, modelB],
    ]);

    const results = classifyAllCapabilityPairs([productAWithCaps, productBWithCaps], capabilityModelsByProductId, new Map(), { includeDistinct: true });

    // capA1 and capA2 are in the same product, so no pairing between them should ever appear.
    expect(results.some((r) => r.productAId === r.productBId)).toBe(false);
    const sorted = [...results].sort(
      (a, b) => a.productAId.localeCompare(b.productAId) || a.productBId.localeCompare(b.productBId) || a.capabilityAId.localeCompare(b.capabilityAId) || a.capabilityBId.localeCompare(b.capabilityBId),
    );
    expect(results).toEqual(sorted);
  });
});
