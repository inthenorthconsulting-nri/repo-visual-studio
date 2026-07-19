import type { CapabilityModel } from "@rvs/capability-intelligence";
import { describe, expect, it } from "vitest";
import { capabilityRefKey } from "../capability-normalization.js";
import type { PortfolioCapability, PortfolioConfig, PortfolioDependencyGraph, PortfolioOverlap, PortfolioProduct } from "../contracts.js";
import { computeRuntimeEvidenceByCapability, detectGaps } from "../gaps.js";
import { makeCapability, makeCapabilityEvidence, makeCapabilityModel, makePortfolioProduct } from "./fixtures.js";

const EMPTY_GRAPH: PortfolioDependencyGraph = { nodes: [], edges: [] };

describe("detectGaps", () => {
  // -------------------------------------------------------------------------
  // qualified_only_coverage: fires when every participant in a capability's
  // participation array has qualified:true.
  // -------------------------------------------------------------------------
  it("emits qualified_only_coverage when every participant of a capability is qualified-only", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const capability: PortfolioCapability = {
      id: "portfolio:capability:qualified-only",
      displayName: "Qualified Only Cap",
      domain: "Widget Operations",
      // "derived" so this capability never also trips the confirmed-only runtime_verification_gap check.
      coverage: "shared",
      participation: [
        { productId: productA.id, productCapabilityId: "capA:x", productCapabilityDisplayName: "X", qualified: true },
        { productId: productB.id, productCapabilityId: "capB:x", productCapabilityDisplayName: "X", qualified: true },
      ],
      evidenceIds: ["portfolio:evidence:capability:product-a:0"],
      confidence: "derived",
    };

    const gaps = detectGaps([productA, productB], new Map(), [capability], [], EMPTY_GRAPH, new Map(), undefined);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.type).toBe("qualified_only_coverage");
    expect(gaps[0]!.capabilityId).toBe(capability.id);
    expect(gaps[0]!.affectedProductIds).toEqual([productA.id, productB.id].sort((a, b) => a.localeCompare(b)));
  });

  it("does NOT emit qualified_only_coverage when at least one participant is fully current (not qualified)", () => {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const capability: PortfolioCapability = {
      id: "portfolio:capability:mixed",
      displayName: "Mixed Cap",
      domain: "Widget Operations",
      coverage: "shared",
      participation: [
        { productId: productA.id, productCapabilityId: "capA:x", productCapabilityDisplayName: "X", qualified: false },
        { productId: productB.id, productCapabilityId: "capB:x", productCapabilityDisplayName: "X", qualified: true },
      ],
      evidenceIds: ["portfolio:evidence:capability:product-a:0"],
      confidence: "derived",
    };

    const gaps = detectGaps([productA, productB], new Map(), [capability], [], EMPTY_GRAPH, new Map(), undefined);
    expect(gaps.filter((g) => g.type === "qualified_only_coverage")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // unowned_capability: fires for every overlap with severity "material" or
  // "strategic".
  // -------------------------------------------------------------------------
  it("emits unowned_capability for a material-severity overlap", () => {
    const overlap: PortfolioOverlap = {
      id: "portfolio:overlap:x",
      capabilityId: "portfolio:capability:x",
      productIds: ["portfolio:product:a", "portfolio:product:b"],
      severity: "material",
      statement: "Two products overlap on capability x.",
      ownershipResolved: false,
      evidenceIds: ["portfolio:evidence:capability:a:0"],
    };

    const gaps = detectGaps([], new Map(), [], [overlap], EMPTY_GRAPH, new Map(), undefined);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.type).toBe("unowned_capability");
    expect(gaps[0]!.capabilityId).toBe(overlap.capabilityId);
    expect(gaps[0]!.affectedProductIds).toEqual(overlap.productIds);
  });

  it("emits unowned_capability for a strategic-severity overlap too", () => {
    const overlap: PortfolioOverlap = {
      id: "portfolio:overlap:y",
      capabilityId: "portfolio:capability:y",
      productIds: ["portfolio:product:a", "portfolio:product:c"],
      severity: "strategic",
      statement: "Strategic overlap on capability y.",
      ownershipResolved: false,
      evidenceIds: [],
    };

    const gaps = detectGaps([], new Map(), [], [overlap], EMPTY_GRAPH, new Map(), undefined);
    expect(gaps.filter((g) => g.type === "unowned_capability")).toHaveLength(1);
  });

  it("does NOT emit unowned_capability for a minor or informational overlap", () => {
    const minorOverlap: PortfolioOverlap = {
      id: "portfolio:overlap:z",
      capabilityId: "portfolio:capability:z",
      productIds: ["portfolio:product:a", "portfolio:product:b"],
      severity: "minor",
      statement: "Minor overlap.",
      ownershipResolved: false,
      evidenceIds: [],
    };
    const informationalOverlap: PortfolioOverlap = { ...minorOverlap, id: "portfolio:overlap:w", severity: "informational" };

    const gaps = detectGaps([], new Map(), [], [minorOverlap, informationalOverlap], EMPTY_GRAPH, new Map(), undefined);
    expect(gaps.filter((g) => g.type === "unowned_capability")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // runtime_verification_gap: fires when confidence=="confirmed" but no
  // evidence type across the capability's underlying refs is in
  // RUNTIME_EVIDENCE_TYPES (runtime_entrypoint/usage/deployment).
  // -------------------------------------------------------------------------
  function buildRuntimeFixture(evidenceType: "implementation" | "usage") {
    const product = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const capabilityDraft = makeCapability({ sourceLabel: "Widget Sync", evidence: [makeCapabilityEvidence(evidenceType)] });
    const model: CapabilityModel = makeCapabilityModel({ includedCapabilities: [capabilityDraft] });
    const capabilityModelsByProductId = new Map([[product.id, model]]);
    const productWithRef = { ...product, currentCapabilityIds: [capabilityDraft.id], currentCapabilityCount: 1 };

    const portfolioCapability: PortfolioCapability = {
      id: "portfolio:capability:widget-sync",
      displayName: "Widget Sync",
      domain: "Widget Operations",
      coverage: "single_product",
      participation: [{ productId: product.id, productCapabilityId: capabilityDraft.id, productCapabilityDisplayName: capabilityDraft.displayName, qualified: false }],
      evidenceIds: ["portfolio:evidence:capability:product-a:0"],
      confidence: "confirmed",
    };

    const refToCapabilityId = new Map([[capabilityRefKey({ productId: product.id, configId: "product-a", capability: capabilityDraft, qualified: false }), portfolioCapability.id]]);

    return { productWithRef, capabilityModelsByProductId, portfolioCapability, refToCapabilityId };
  }

  it("emits runtime_verification_gap for a confirmed capability whose only evidence is static (implementation)", () => {
    const { productWithRef, capabilityModelsByProductId, portfolioCapability, refToCapabilityId } = buildRuntimeFixture("implementation");

    const gaps = detectGaps([productWithRef], capabilityModelsByProductId, [portfolioCapability], [], EMPTY_GRAPH, refToCapabilityId, undefined);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.type).toBe("runtime_verification_gap");
    expect(gaps[0]!.capabilityId).toBe(portfolioCapability.id);
  });

  it("does NOT emit runtime_verification_gap when the capability has runtime/usage/deployment evidence", () => {
    const { productWithRef, capabilityModelsByProductId, portfolioCapability, refToCapabilityId } = buildRuntimeFixture("usage");

    const gaps = detectGaps([productWithRef], capabilityModelsByProductId, [portfolioCapability], [], EMPTY_GRAPH, refToCapabilityId, undefined);
    expect(gaps.filter((g) => g.type === "runtime_verification_gap")).toHaveLength(0);
  });

  it("does NOT emit runtime_verification_gap for a non-confirmed capability, even with only static evidence", () => {
    const { productWithRef, capabilityModelsByProductId, portfolioCapability, refToCapabilityId } = buildRuntimeFixture("implementation");
    const derivedCapability: PortfolioCapability = { ...portfolioCapability, confidence: "derived" };

    const gaps = detectGaps([productWithRef], capabilityModelsByProductId, [derivedCapability], [], EMPTY_GRAPH, refToCapabilityId, undefined);
    expect(gaps.filter((g) => g.type === "runtime_verification_gap")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // computeRuntimeEvidenceByCapability — the shared helper directly.
  // -------------------------------------------------------------------------
  it("computeRuntimeEvidenceByCapability reports true only for capabilities with runtime-flavored evidence", () => {
    const { productWithRef, capabilityModelsByProductId, portfolioCapability, refToCapabilityId } = buildRuntimeFixture("usage");
    const result = computeRuntimeEvidenceByCapability([productWithRef], capabilityModelsByProductId, refToCapabilityId);
    expect(result.get(portfolioCapability.id)).toBe(true);

    const staticFixture = buildRuntimeFixture("implementation");
    const staticResult = computeRuntimeEvidenceByCapability([staticFixture.productWithRef], staticFixture.capabilityModelsByProductId, staticFixture.refToCapabilityId);
    expect(staticResult.get(staticFixture.portfolioCapability.id)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // dependency_gap: fires when >=2 products depend (via a "depends_on" edge)
  // on the same external_system dependency node and no shared_platform /
  // shared_contract relationship has been declared between them in config.
  // -------------------------------------------------------------------------
  function buildDependencyFixture() {
    const productA = makePortfolioProduct({ source: { configId: "product-a", artifactRoot: "./a", compatibility: "compatible" } });
    const productB = makePortfolioProduct({ source: { configId: "product-b", artifactRoot: "./b", compatibility: "compatible" } });
    const graph: PortfolioDependencyGraph = {
      nodes: [{ id: "portfolio:node:external_system:shared-db", kind: "external_system", label: "Shared DB" }],
      edges: [
        { id: "portfolio:edge:depends_on:a:db", kind: "depends_on", sourceProductId: productA.id, targetId: "portfolio:node:external_system:shared-db", confidence: "confirmed", qualifiers: [], evidenceIds: ["ev:a"] },
        { id: "portfolio:edge:depends_on:b:db", kind: "depends_on", sourceProductId: productB.id, targetId: "portfolio:node:external_system:shared-db", confidence: "confirmed", qualifiers: [], evidenceIds: ["ev:b"] },
      ],
    };
    return { productA, productB, graph };
  }

  it("emits dependency_gap when two products depend on the same external system with no declared shared relationship", () => {
    const { productA, productB, graph } = buildDependencyFixture();

    const gaps = detectGaps([productA, productB], new Map(), [], [], graph, new Map(), undefined);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.type).toBe("dependency_gap");
    expect(gaps[0]!.affectedProductIds).toEqual([productA.id, productB.id].sort((a, b) => a.localeCompare(b)));
    expect(gaps[0]!.evidenceIds.sort()).toEqual(["ev:a", "ev:b"].sort());
  });

  it("does NOT emit dependency_gap when only one product depends on the external system", () => {
    const { productA, graph } = buildDependencyFixture();
    const singleProductGraph: PortfolioDependencyGraph = { nodes: graph.nodes, edges: graph.edges.filter((e) => e.sourceProductId === productA.id) };

    const gaps = detectGaps([productA], new Map(), [], [], singleProductGraph, new Map(), undefined);
    expect(gaps.filter((g) => g.type === "dependency_gap")).toHaveLength(0);
  });

  it("does NOT emit dependency_gap when a shared_platform relationship for the pair is already declared in config", () => {
    const { productA, productB, graph } = buildDependencyFixture();
    const config: PortfolioConfig = {
      schema_version: 1,
      portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
      products: [
        { id: "product-a", artifact_root: "./a" },
        { id: "product-b", artifact_root: "./b" },
      ],
      approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship: "shared_platform" }],
    };

    const gaps = detectGaps([productA, productB], new Map(), [], [], graph, new Map(), config);
    expect(gaps.filter((g) => g.type === "dependency_gap")).toHaveLength(0);
  });
});
