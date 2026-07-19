import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityModel } from "@rvs/product-intelligence";
import { synthesizePortfolio, synthesizePortfolioNarrative, synthesizePortfolioPlan } from "../index.js";
import { buildPortfolioDomains } from "../index.js";
import { PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES } from "../portfolio-plan.js";
import { validatePortfolioClaims, validatePortfolioModel, validatePortfolioPlan } from "../validation.js";
import type { PortfolioConfig } from "../contracts.js";
import { GENERATED_AT, makeCapability, makeCapabilityDomain, makeCapabilityEvidence, makeCapabilityModel, makePortfolioConfig, makePortfolioConfigProduct, makeProductIdentityModel, writeArtifactRoot } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Three genuinely differentiated fixture products:
//   - "ticketing-core" (governance_platform) and "support-suite"
//     (operations_platform) both implement a "Ticket Sync" capability with
//     the same domain/actors/workflows/external system, so capability
//     normalization merges them into one "shared" PortfolioCapability and
//     product-relationships/overlaps/gaps all have real, non-trivial input.
//   - "docs-portal" (developer_tool) implements an unrelated "Doc Publishing"
//     capability, exercising "single_product" coverage alongside the shared
//     one.
// ---------------------------------------------------------------------------

function ticketingCoreArtifacts(): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const domain = makeCapabilityDomain({ id: "capintel:domain:support-operations", sourceLabel: "Support Operations" });
  const capability = makeCapability({
    id: "capintel:capability:ticket-sync-core",
    sourceLabel: "Ticket Sync",
    domainId: domain.id,
    actors: ["Support Agent"],
    workflows: ["ticket-lifecycle"],
    externalSystems: ["Zendesk"],
  });
  const capabilityModel = makeCapabilityModel({
    domains: [domain],
    includedCapabilities: [capability],
    systemIdentity: { displayName: "Ticketing Core", purpose: "Synchronizes support tickets across systems." },
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 1 },
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
  });
  const productIdentity = makeProductIdentityModel(
    {},
    {
      displayName: "Ticketing Core",
      descriptor: "Governance platform for ticket lifecycle compliance.",
      shortPromise: "Ticketing Core governs ticket lifecycle compliance for support operations.",
      archetype: "governance_platform",
      purpose: "Provides governed oversight of ticket lifecycle compliance for support operations leaders.",
      primaryUsers: ["Support Operations Leader"],
      currentCapabilities: [capability.id],
    },
  );
  return { productIdentity, capabilityModel };
}

function supportSuiteArtifacts(): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const domain = makeCapabilityDomain({ id: "capintel:domain:support-operations", sourceLabel: "Support Operations" });
  const capability = makeCapability({
    id: "capintel:capability:ticket-sync-suite",
    sourceLabel: "Ticket Sync",
    domainId: domain.id,
    actors: ["Support Agent"],
    workflows: ["ticket-lifecycle"],
    externalSystems: ["Zendesk"],
  });
  const capabilityModel = makeCapabilityModel({
    domains: [domain],
    includedCapabilities: [capability],
    systemIdentity: { displayName: "Support Suite", purpose: "Operates day-to-day support ticket handling." },
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 1 },
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
  });
  const productIdentity = makeProductIdentityModel(
    {},
    {
      displayName: "Support Suite",
      descriptor: "Operations platform for day-to-day support ticket handling.",
      shortPromise: "Support Suite operates day-to-day support ticket handling for support agents.",
      archetype: "operations_platform",
      purpose: "Provides day-to-day operational handling of support tickets for support agents.",
      primaryUsers: ["Support Agent"],
      currentCapabilities: [capability.id],
    },
  );
  return { productIdentity, capabilityModel };
}

function docsPortalArtifacts(): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const domain = makeCapabilityDomain({ id: "capintel:domain:developer-enablement", sourceLabel: "Developer Enablement" });
  // Deliberately distinct purpose wording and evidence type from ticketingCoreArtifacts()/supportSuiteArtifacts()'s "Ticket Sync"
  // capability -- capability-normalization.ts's similarity score is a token-jaccard blend across displayName/purpose/outcome,
  // actors/workflows/externalSystems/evidence-type, so any accidental shared boilerplate wording (e.g. the default "Handles X for
  // the platform." purpose template) or shared evidence type would inflate the cross-product similarity score for two capabilities
  // that are not actually the same responsibility. Keeping this capability's name/purpose/evidence type fully non-overlapping
  // keeps its cross-product score below the 0.2 "distinct" floor, so it stays "single_product" coverage as intended.
  const capability = makeCapability({
    id: "capintel:capability:doc-publishing",
    sourceLabel: "Doc Publishing",
    purpose: "Publishes versioned developer reference material to the public documentation site.",
    domainId: domain.id,
    actors: ["Writer"],
    workflows: ["doc-lifecycle"],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("documentation")],
  });
  const capabilityModel = makeCapabilityModel({
    domains: [domain],
    includedCapabilities: [capability],
    systemIdentity: { displayName: "Docs Portal", purpose: "Publishes developer documentation." },
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { documentation: 1 },
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
  });
  const productIdentity = makeProductIdentityModel(
    {},
    {
      displayName: "Docs Portal",
      descriptor: "Developer tool for publishing product documentation.",
      shortPromise: "Docs Portal publishes developer documentation for engineering teams.",
      archetype: "developer_tool",
      purpose: "Publishes and maintains developer documentation for engineering teams.",
      primaryUsers: ["Developer"],
      currentCapabilities: [capability.id],
    },
  );
  return { productIdentity, capabilityModel };
}

function setUpConfig(repoRoot: string, includeIncompatible = false): PortfolioConfig {
  const ticketingRoot = writeArtifactRoot(repoRoot, "ticketing-core", ticketingCoreArtifacts());
  const supportRoot = writeArtifactRoot(repoRoot, "support-suite", supportSuiteArtifacts());
  const docsRoot = writeArtifactRoot(repoRoot, "docs-portal", docsPortalArtifacts());

  const products = [
    makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRoot }),
    makePortfolioConfigProduct({ id: "support-suite", artifact_root: supportRoot }),
    makePortfolioConfigProduct({ id: "docs-portal", artifact_root: docsRoot }),
  ];

  if (includeIncompatible) {
    const brokenRoot = writeArtifactRoot(repoRoot, "broken-product", {});
    products.push(makePortfolioConfigProduct({ id: "broken-product", artifact_root: brokenRoot }));
  }

  return makePortfolioConfig({
    portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
    products,
    approved_relationships: [{ product_a: "ticketing-core", product_b: "support-suite", relationship: "shared_platform", note: "Both integrate with the shared Zendesk support platform." }],
  });
}

describe("synthesizePortfolio pipeline", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-portfolio-index-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("is deterministic: two independent runs over the same input produce byte-identical model JSON", () => {
    const config = setUpConfig(repoRoot);
    const runA = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const runB = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    expect(JSON.stringify(runA.model)).toBe(JSON.stringify(runB.model));
    expect(JSON.stringify(runA.claims)).toBe(JSON.stringify(runB.claims));
  });

  it("produces one PortfolioProduct per compatible input product", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    expect(model.products.length).toBe(3);
    expect(model.evidenceSummary.productCount).toBe(model.products.length);
  });

  it("normalizes the two products' identically-shaped 'Ticket Sync' capabilities into one shared capability", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const ticketCapabilities = model.capabilities.filter((c) => c.displayName === "Ticket Sync");
    expect(ticketCapabilities).toHaveLength(1);
    expect(ticketCapabilities[0]!.participation.map((p) => p.productId).sort()).toEqual(
      model.products.filter((p) => p.displayName === "Ticketing Core" || p.displayName === "Support Suite").map((p) => p.id).sort(),
    );
    const docCapability = model.capabilities.find((c) => c.displayName === "Doc Publishing");
    expect(docCapability?.coverage).toBe("single_product");
  });

  it("produces non-empty, id-sorted evidence contributed by normalization/relationships/dependencies and by claim control", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    expect(model.evidence.length).toBeGreaterThan(0);
    expect(model.evidence).toEqual([...model.evidence].sort((a, b) => a.id.localeCompare(b.id)));
    // Claim-control (draftIdentityClaims in claims.ts) contributes its own "product_identity" evidence entry keyed by the
    // portfolio id (config.portfolio.id), distinct from the plain capability/config evidence normalization/relationships/
    // dependencies alone produce -- confirms claims.ts's own evidence made it into the merged evidence list, not just the
    // preliminary evidence computed before claim control ran.
    const claimOnlyEvidenceId = `portfolio:evidence:product_identity:test-portfolio:0`;
    expect(model.evidence.some((e) => e.id === claimOnlyEvidenceId)).toBe(true);
  });

  it("buildPortfolioDomains groups the synthesized capabilities by their domain label", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const domains = buildPortfolioDomains(model.capabilities);
    expect(domains).toEqual(model.domains);
    const supportDomain = domains.find((d) => d.displayName === "Support Operations");
    expect(supportDomain?.capabilityIds.length).toBeGreaterThan(0);
  });

  it("throws when an incompatible product is present and allowPartialPortfolio is not set", () => {
    const config = setUpConfig(repoRoot, true);
    expect(() => synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT })).toThrow(/incompatible/i);
  });

  it("succeeds with excludedProducts populated when allowPartialPortfolio is true", () => {
    const config = setUpConfig(repoRoot, true);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT, allowPartialPortfolio: true });
    expect(model.products.length).toBe(3);
    expect(model.excludedProducts).toHaveLength(1);
    expect(model.excludedProducts[0]!.configId).toBe("broken-product");
    expect(model.excludedProducts[0]!.compatibility).toBe("missing_required_artifact");
    expect(model.generationMetadata.incompatibleProductCount).toBe(1);
    expect(model.generationMetadata.allowPartialPortfolio).toBe(true);
  });

  it("narrative -> plan: scene count is within PORTFOLIO_PLAN_MIN_SCENES..PORTFOLIO_PLAN_MAX_SCENES", () => {
    const config = setUpConfig(repoRoot);
    const { model, claims } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const narrative = synthesizePortfolioNarrative(model, claims);
    const plan = synthesizePortfolioPlan({ model, narrative, claims, audience: "executive", theme: "default", generatedAt: GENERATED_AT });
    expect(plan.scenes.length).toBeGreaterThanOrEqual(PORTFOLIO_PLAN_MIN_SCENES);
    expect(plan.scenes.length).toBeLessThanOrEqual(PORTFOLIO_PLAN_MAX_SCENES);
    expect(plan.generationMetadata.sceneCount).toBe(plan.scenes.length);
  });

  it("validatePortfolioModel/validatePortfolioClaims/validatePortfolioPlan report zero error-severity warnings for a self-consistent synthesis", () => {
    const config = setUpConfig(repoRoot);
    const { model, claims } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const narrative = synthesizePortfolioNarrative(model, claims);
    const plan = synthesizePortfolioPlan({ model, narrative, claims, audience: "executive", theme: "default", generatedAt: GENERATED_AT });

    const modelErrors = validatePortfolioModel(model).filter((w) => w.severity === "error");
    const claimErrors = validatePortfolioClaims(claims, model).filter((w) => w.severity === "error");
    const planErrors = validatePortfolioPlan(plan).filter((w) => w.severity === "error");

    expect(modelErrors, JSON.stringify(modelErrors, null, 2)).toEqual([]);
    expect(claimErrors, JSON.stringify(claimErrors, null, 2)).toEqual([]);
    expect(planErrors, JSON.stringify(planErrors, null, 2)).toEqual([]);
  });

  it("gives the shared_capability relationship non-empty evidence sourced from the merged capability's own evidence", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const sharedRelationship = model.relationships.find((r) => r.type === "shared_capability");
    expect(sharedRelationship).toBeDefined();
    expect(sharedRelationship!.evidenceIds.length).toBeGreaterThan(0);
  });

  it("operating-model stage capabilityIds are portfolio-normalized ids that resolve against model.capabilities", () => {
    const config = setUpConfig(repoRoot);
    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const capabilityIds = new Set(model.capabilities.map((c) => c.id));
    const stageCapabilityIds = model.operatingModel.stages.flatMap((s) => s.capabilityIds);
    expect(stageCapabilityIds.length).toBeGreaterThan(0);
    for (const id of stageCapabilityIds) expect(capabilityIds.has(id)).toBe(true);
  });
});
