import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffPortfolio } from "../portfolio-diff.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function maturityDimension(score: number, label: string) {
  return { score, numerator: score, denominator: 100, label };
}

function makeProductModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    identity: { displayName: "Acme Widget", archetype: "workflow-automation-platform", purpose: "p", descriptor: "d", shortPromise: "s", primaryUsers: [], secondaryUsers: [], secondaryArchetypes: [], valuePillars: [], differentiators: [], evidence: [] },
    candidates: [],
    archetypeScores: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_capability_model_generated_at: GENERATED_AT, assist_used: false, overrideApplied: false, candidateCount: 1 },
    ...overrides,
  };
}

function makePortfolioModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:acme",
    displayName: "Acme Portfolio",
    products: [
      { id: "product:widget", displayName: "Widget", descriptor: "d1" },
      { id: "product:gadget", displayName: "Gadget", descriptor: "d2" },
    ],
    domains: [],
    capabilities: [],
    relationships: [{ id: "rel:widget-gadget", productAId: "product:widget", productBId: "product:gadget", type: "shared_contract", confidence: "confirmed", statement: "Widget and Gadget share a contract.", capabilityIds: [], evidenceIds: ["ev1"] }],
    unresolvedRelationships: [],
    dependencyGraph: { nodes: [], edges: [{ id: "dep:widget-gadget", kind: "produces", sourceProductId: "product:widget", targetId: "product:gadget", confidence: "confirmed", qualifiers: [], evidenceIds: ["ev1"] }] },
    overlaps: [{ id: "overlap:sync", capabilityId: "cap:sync", productIds: ["product:widget", "product:gadget"], severity: "minor", statement: "Both sync.", ownershipResolved: false, evidenceIds: ["ev1"] }],
    gaps: [{ id: "gap:reporting", type: "no_product_coverage", statement: "No reporting product.", affectedProductIds: ["product:widget"], evidenceIds: [] }],
    operatingModel: {},
    maturity: {
      coverage: maturityDimension(80, "Coverage"),
      operational: maturityDimension(70, "Operational"),
      verification: maturityDimension(60, "Verification"),
      integration: maturityDimension(50, "Integration"),
      ownership: maturityDimension(90, "Ownership"),
      runtimeEvidence: maturityDimension(40, "Runtime Evidence"),
      coherence: maturityDimension(85, "Coherence"),
    },
    evidence: [],
    evidenceSummary: {},
    excludedProducts: [],
    generationMetadata: { generated_at: GENERATED_AT, schema_version: 1, productCount: 2, incompatibleProductCount: 0, allowPartialPortfolio: false },
    ...overrides,
  };
}

describe("diffPortfolio", () => {
  it("attributes a removed relationship to 'product removed / evidence unavailable' when the product domain's provenance went from complete to unavailable", () => {
    const sourcePortfolio = makePortfolioModel();
    const targetPortfolio = makePortfolioModel({ relationships: [] });

    const sourceSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: sourcePortfolio, generatedAt: GENERATED_AT });
    // Target snapshot omits the product artifact entirely -> provenance "unavailable".
    const targetSnapshot = buildIntelligenceSnapshot({ portfolio: targetPortfolio, generatedAt: GENERATED_AT });

    const result = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourcePortfolio, targetArtifact: targetPortfolio });

    const entry = result.changes.find((c) => c.entity_id === "rel:widget-gadget");
    expect(entry?.type).toBe("removed");
    expect(entry?.detail).toContain("product removed / evidence unavailable");
  });

  it("attributes a removed relationship to 'evidence loss' when product provenance stayed complete on both sides but the entry had no evidence backing it", () => {
    const sourcePortfolio = makePortfolioModel({ relationships: [{ id: "rel:widget-gadget", productAId: "product:widget", productBId: "product:gadget", type: "shared_contract", confidence: "confirmed", statement: "Widget and Gadget share a contract.", capabilityIds: [], evidenceIds: [] }] });
    const targetPortfolio = makePortfolioModel({ relationships: [] });

    const sourceSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: sourcePortfolio, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: targetPortfolio, generatedAt: GENERATED_AT });

    const result = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourcePortfolio, targetArtifact: targetPortfolio });

    const entry = result.changes.find((c) => c.entity_id === "rel:widget-gadget");
    expect(entry?.type).toBe("removed");
    expect(entry?.detail).toContain("evidence loss");
  });

  it("marks a removed relationship as 'unresolved -- insufficient evidence to determine cause' when neither known cause applies", () => {
    const sourcePortfolio = makePortfolioModel();
    const targetPortfolio = makePortfolioModel({ relationships: [] });

    // Product provenance is "partial" (malformed) on the source side -- not
    // "complete" -> "unavailable", so the first cause rule doesn't apply;
    // the relationship's own evidenceIds was non-empty, so the second cause
    // rule doesn't apply either.
    const sourceSnapshot = buildIntelligenceSnapshot({ product: "not-an-object" as unknown, portfolio: sourcePortfolio, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ product: "not-an-object" as unknown, portfolio: targetPortfolio, generatedAt: GENERATED_AT });

    const result = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: sourcePortfolio, targetArtifact: targetPortfolio });

    const entry = result.changes.find((c) => c.entity_id === "rel:widget-gadget");
    expect(entry?.detail).toContain("unresolved -- insufficient evidence to determine cause");
  });

  it("returns an empty changes array without throwing when neither snapshot has portfolio provenance complete", () => {
    const sourceSnapshot = buildIntelligenceSnapshot({ generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ generatedAt: "2026-07-02T00:00:00.000Z" });

    expect(() => diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: undefined, targetArtifact: undefined })).not.toThrow();
    const result = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: undefined, targetArtifact: undefined });
    expect(result.changes).toEqual([]);
    expect(result.compatibility).toBe("partial");
  });

  it("detects a product added to the portfolio and a dependency edge added", () => {
    const source = makePortfolioModel();
    const target = makePortfolioModel({
      products: [...source.products, { id: "product:gizmo", displayName: "Gizmo", descriptor: "d3" }],
      dependencyGraph: { nodes: [], edges: [...source.dependencyGraph.edges, { id: "dep:gizmo-widget", kind: "consumes", sourceProductId: "product:gizmo", targetId: "product:widget", confidence: "confirmed", qualifiers: [], evidenceIds: ["ev2"] }] },
    });

    const sourceSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: source, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: target, generatedAt: GENERATED_AT });

    const result = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });

    expect(result.changes.find((c) => c.entity_id === "product:gizmo")?.type).toBe("added");
    expect(result.changes.find((c) => c.entity_id === "dep:gizmo-widget")?.type).toBe("added");
  });

  it("is fully deterministic across repeated runs", () => {
    const source = makePortfolioModel();
    const target = makePortfolioModel({ relationships: [] });
    const sourceSnapshot = buildIntelligenceSnapshot({ product: makeProductModel(), portfolio: source, generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ portfolio: target, generatedAt: GENERATED_AT });

    const first = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const second = diffPortfolio({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
