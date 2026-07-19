import { describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { collectCapabilityRefs, computeCapabilitySimilarity, isSameCapability, normalizePortfolioCapabilities, type ProductCapabilityRef } from "../capability-normalization.js";
import { portfolioCapabilityId } from "../ids.js";
import { makeCapability, makeCapabilityDomain, makeCapabilityEvidence, makeCapabilityModel, makePortfolioProduct } from "./fixtures.js";

function ref(productId: string, configId: string, capability: ReturnType<typeof makeCapability>, qualified = false): ProductCapabilityRef {
  return { productId, configId, capability, qualified };
}

describe("collectCapabilityRefs", () => {
  it("collects one ref per (product, currentCapabilityIds/qualifiedCapabilityIds) entry that resolves in that product's capability model", () => {
    const capA = makeCapability({ sourceLabel: "Widget Sync" });
    const capB = makeCapability({ sourceLabel: "Widget Report", inclusion: "include_with_qualification" });
    const model = makeCapabilityModel({ includedCapabilities: [capA], qualifiedCapabilities: [capB] });
    const product = makePortfolioProduct({ currentCapabilityIds: [capA.id], qualifiedCapabilityIds: [capB.id] });

    const refs = collectCapabilityRefs([product], new Map([[product.id, model]]));

    expect(refs).toHaveLength(2);
    const refA = refs.find((r) => r.capability.id === capA.id)!;
    const refB = refs.find((r) => r.capability.id === capB.id)!;
    expect(refA.qualified).toBe(false);
    expect(refB.qualified).toBe(true);
    expect(refA.productId).toBe(product.id);
    expect(refA.configId).toBe(product.source.configId);
  });

  it("skips a capability id declared on the product but absent from that product's capability model", () => {
    const capA = makeCapability({ sourceLabel: "Widget Sync" });
    const model = makeCapabilityModel({ includedCapabilities: [capA] });
    const product = makePortfolioProduct({ currentCapabilityIds: [capA.id, "capintel:capability:ghost"] });

    const refs = collectCapabilityRefs([product], new Map([[product.id, model]]));

    expect(refs).toHaveLength(1);
    expect(refs[0]!.capability.id).toBe(capA.id);
  });

  it("skips a product entirely when no capability model is present for it", () => {
    const product = makePortfolioProduct();
    const refs = collectCapabilityRefs([product], new Map());
    expect(refs).toEqual([]);
  });

  it("sorts refs by productId then capability id", () => {
    const capA = makeCapability({ sourceLabel: "Zebra Task" });
    const capB = makeCapability({ sourceLabel: "Alpha Task" });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA, capB] });
    const productZ = makePortfolioProduct({ displayName: "Z Product", currentCapabilityIds: [capA.id, capB.id], source: { configId: "z-product", artifactRoot: "./z", compatibility: "compatible" } });
    const productA = makePortfolioProduct({ displayName: "A Product", currentCapabilityIds: [capA.id], source: { configId: "a-product", artifactRoot: "./a", compatibility: "compatible" } });

    const refs = collectCapabilityRefs(
      [productZ, productA],
      new Map([
        [productZ.id, modelA],
        [productA.id, modelA],
      ]),
    );

    expect(refs.map((r) => r.productId)).toEqual([...refs.map((r) => r.productId)].sort((a, b) => a.localeCompare(b)));
    // Within productZ's refs, capability ids must also be sorted ascending.
    const zRefs = refs.filter((r) => r.productId === productZ.id).map((r) => r.capability.id);
    expect(zRefs).toEqual([...zRefs].sort((a, b) => a.localeCompare(b)));
  });
});

describe("computeCapabilitySimilarity", () => {
  it("reports high lexical overlap with zero domain/actor/workflow/externalSystem overlap for two capabilities that share wording but nothing structural", () => {
    const capA = ref(
      "portfolio:product:product-a",
      "product-a",
      makeCapability({
        sourceLabel: "Widget Compliance Reporting",
        purpose: "Generates widget compliance reporting for oversight teams.",
        // Deliberately not sharing the "capintel:domain:" convention so the two
        // domain ids' token sets have zero overlap (see jaccard/tokenize above).
        domainId: "widget-ops-alpha",
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        externalSystems: [],
      }),
    );
    const capB = ref(
      "portfolio:product:product-b",
      "product-b",
      makeCapability({
        sourceLabel: "Widget Compliance Reporting",
        purpose: "Generates widget compliance reporting for oversight teams.",
        domainId: "reporting-beta",
        actors: ["Analyst"],
        workflows: ["report-generation"],
        externalSystems: [],
      }),
    );

    const { signals } = computeCapabilitySimilarity(capA, capB);

    expect(signals.nameOverlap).toBeGreaterThan(0.7);
    expect(signals.domainOverlap).toBe(0);
    expect(signals.actorOverlap).toBe(0);
    expect(signals.workflowOverlap).toBe(0);
    expect(signals.externalSystemOverlap).toBe(0);
  });

  it("is symmetric and bounded between 0 and 1", () => {
    const capA = ref("portfolio:product:product-a", "product-a", makeCapability({ sourceLabel: "Widget Sync" }));
    const capB = ref("portfolio:product:product-b", "product-b", makeCapability({ sourceLabel: "Report Export", purpose: "Exports customer report data." }));
    const ab = computeCapabilitySimilarity(capA, capB);
    const ba = computeCapabilitySimilarity(capB, capA);
    expect(ab.score).toBeCloseTo(ba.score, 10);
    expect(ab.score).toBeGreaterThanOrEqual(0);
    expect(ab.score).toBeLessThanOrEqual(1);
  });
});

describe("isSameCapability", () => {
  it("is false when score >= threshold but every structural signal (domain/actor/workflow/externalSystem overlap) is zero — lexical overlap alone is never sufficient", () => {
    const signals = { nameOverlap: 0.9, domainOverlap: 0, actorOverlap: 0, workflowOverlap: 0, externalSystemOverlap: 0, evidenceTypeOverlap: 1 };
    expect(isSameCapability(signals, 0.6)).toBe(false);
  });

  it("is true when score >= threshold, nameOverlap > 0, and at least one structural signal agrees", () => {
    const signals = { nameOverlap: 0.6, domainOverlap: 1, actorOverlap: 0, workflowOverlap: 0, externalSystemOverlap: 0, evidenceTypeOverlap: 0 };
    expect(isSameCapability(signals, 0.55)).toBe(true);
  });

  it("is false when score is below the threshold even with full structural agreement", () => {
    const signals = { nameOverlap: 1, domainOverlap: 1, actorOverlap: 1, workflowOverlap: 1, externalSystemOverlap: 1, evidenceTypeOverlap: 1 };
    expect(isSameCapability(signals, 0.49)).toBe(false);
  });

  it("is false when structural agreement exists but nameOverlap is exactly zero", () => {
    const signals = { nameOverlap: 0, domainOverlap: 1, actorOverlap: 1, workflowOverlap: 1, externalSystemOverlap: 1, evidenceTypeOverlap: 1 };
    expect(isSameCapability(signals, 0.9)).toBe(false);
  });
});

describe("normalizePortfolioCapabilities", () => {
  function twoProductSetup() {
    const productAId = "portfolio:product:product-a";
    const productBId = "portfolio:product:product-b";
    const productA = makePortfolioProduct({
      displayName: "Product A",
      source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" },
    });
    const productB = makePortfolioProduct({
      displayName: "Product B",
      source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" },
    });
    return { productA, productB, productAId: productA.id, productBId: productB.id };
  }

  it("merges two genuinely matching capabilities (same actors/workflow/domain) across products into one shared PortfolioCapability with 2 participants", () => {
    const { productA, productB } = twoProductSetup();
    const capA = makeCapability({
      sourceLabel: "Widget Identity Sync",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
      evidence: [makeCapabilityEvidence("implementation")],
    });
    const capB = makeCapability({
      sourceLabel: "Widget Identity Sync",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
      evidence: [makeCapabilityEvidence("implementation")],
    });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB] });
    const productAWithCap = { ...productA, currentCapabilityIds: [capA.id] };
    const productBWithCap = { ...productB, currentCapabilityIds: [capB.id] };

    const result = normalizePortfolioCapabilities(
      [productAWithCap, productBWithCap],
      new Map<string, CapabilityModel>([
        [productAWithCap.id, modelA],
        [productBWithCap.id, modelB],
      ]),
    );

    expect(result.capabilities).toHaveLength(1);
    const merged = result.capabilities[0]!;
    expect(merged.coverage).toBe("shared");
    expect(merged.participation).toHaveLength(2);
    expect(merged.participation.map((p) => p.productId).sort()).toEqual([productAWithCap.id, productBWithCap.id].sort());
  });

  it("leaves two unrelated capabilities (different names, domains, actors, workflows) as separate single_product entries", () => {
    const { productA, productB } = twoProductSetup();
    const capA = makeCapability({
      sourceLabel: "Widget Sync",
      purpose: "Synchronizes widget state between nodes.",
      actors: ["Operator"],
      workflows: ["widget-lifecycle"],
      domainId: "capintel:domain:widget-operations",
      evidence: [makeCapabilityEvidence("implementation")],
    });
    const capB = makeCapability({
      sourceLabel: "Report Export",
      purpose: "Produces customer report exports.",
      actors: ["Analyst"],
      workflows: ["report-generation"],
      domainId: "capintel:domain:reporting-analytics",
      evidence: [makeCapabilityEvidence("test")],
    });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB] });
    const productAWithCap = { ...productA, currentCapabilityIds: [capA.id] };
    const productBWithCap = { ...productB, currentCapabilityIds: [capB.id] };

    const result = normalizePortfolioCapabilities(
      [productAWithCap, productBWithCap],
      new Map<string, CapabilityModel>([
        [productAWithCap.id, modelA],
        [productBWithCap.id, modelB],
      ]),
    );

    expect(result.capabilities).toHaveLength(2);
    expect(result.capabilities.every((c) => c.coverage === "single_product")).toBe(true);
    expect(result.capabilities.every((c) => c.participation.length === 1)).toBe(true);
  });

  it("derives the normalized capability id deterministically from the sorted member (productId, capabilityId) pairs", () => {
    const { productA, productB } = twoProductSetup();
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

    const result = normalizePortfolioCapabilities(
      [productAWithCap, productBWithCap],
      new Map<string, CapabilityModel>([
        [productAWithCap.id, modelA],
        [productBWithCap.id, modelB],
      ]),
    );

    const members = [productAWithCap, productBWithCap].map((p) => (p.id === productAWithCap.id ? { productId: p.id, capId: capA.id } : { productId: p.id, capId: capB.id }));
    const sortedMembers = members.sort((a, b) => a.productId.localeCompare(b.productId) || a.capId.localeCompare(b.capId));
    const normalizedKey = sortedMembers.map((m) => `${m.productId}:${m.capId}`).join("|");
    expect(result.capabilities[0]!.id).toBe(portfolioCapabilityId(normalizedKey));
  });

  it("picks the canonical displayName from the member with the most evidence when merging", () => {
    const { productA, productB } = twoProductSetup();
    const capA = makeCapability({
      sourceLabel: "Widget Identity Sync",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
      evidence: [makeCapabilityEvidence("implementation"), makeCapabilityEvidence("test")],
    });
    const capB = makeCapability({
      sourceLabel: "Identity Bridge",
      purpose: "Synchronizes widget identity records across systems.",
      actors: ["Operator"],
      workflows: ["identity-lifecycle"],
      domainId: "capintel:domain:widget-operations",
      evidence: [makeCapabilityEvidence("implementation")],
    });
    const modelA = makeCapabilityModel({ includedCapabilities: [capA] });
    const modelB = makeCapabilityModel({ includedCapabilities: [capB] });
    const productAWithCap = { ...productA, currentCapabilityIds: [capA.id] };
    const productBWithCap = { ...productB, currentCapabilityIds: [capB.id] };

    const result = normalizePortfolioCapabilities(
      [productAWithCap, productBWithCap],
      new Map<string, CapabilityModel>([
        [productAWithCap.id, modelA],
        [productBWithCap.id, modelB],
      ]),
    );

    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]!.displayName).toBe("Widget Identity Sync");
  });

  it("uses the domain's displayName (not the raw domain id) for the merged capability's domain label", () => {
    const product = makePortfolioProduct();
    const domain = makeCapabilityDomain({ id: "capintel:domain:widget-operations", sourceLabel: "Widget Operations Domain" });
    const cap = makeCapability({ domainId: domain.id });
    const model = makeCapabilityModel({ domains: [domain], includedCapabilities: [cap] });
    const productWithCap = { ...product, currentCapabilityIds: [cap.id] };

    const result = normalizePortfolioCapabilities([productWithCap], new Map([[productWithCap.id, model]]));

    expect(result.capabilities[0]!.domain).toBe("Widget Operations Domain");
  });
});
