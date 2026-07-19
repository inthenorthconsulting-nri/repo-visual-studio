import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { PRODUCT_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/product-intelligence";
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

  it("synthesizes an alias_of product as a fully independent PortfolioProduct sharing the same artifact_root -- alias_of only unlocks the config-validation duplicate-root check, it does not deduplicate synthesis output", () => {
    // §5: alias_of exists so a portfolio author can legitimately list the same underlying
    // repository under two catalog identities (e.g. a rename in progress, or a product
    // deliberately marketed under two names) without tripping the "duplicate artifact_root"
    // config error -- see product-registry.test.ts's own alias_of + approved_relationship
    // pairing. Nothing downstream of product-registry.ts reads alias_of at all, so both ids
    // are synthesized as first-class products with their own (here, identical) capabilities;
    // the resulting "shared" capability + an author-declared approved_relationship are what
    // make the intentional duplication legible in the output, not silent deduplication.
    const ticketingRoot = writeArtifactRoot(repoRoot, "ticketing-core", ticketingCoreArtifacts());
    const config = makePortfolioConfig({
      portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
      products: [
        makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRoot }),
        makePortfolioConfigProduct({ id: "ticketing-core-legacy-name", artifact_root: ticketingRoot, alias_of: "ticketing-core" }),
      ],
      approved_relationships: [{ product_a: "ticketing-core", product_b: "ticketing-core-legacy-name", relationship: "shared_platform", note: "Same underlying repository under a legacy catalog name." }],
    });

    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });

    expect(model.products).toHaveLength(2);
    expect(model.products.map((p) => p.source.configId).sort()).toEqual(["ticketing-core", "ticketing-core-legacy-name"]);
    const ticketCapabilities = model.capabilities.filter((c) => c.displayName === "Ticket Sync");
    expect(ticketCapabilities).toHaveLength(1);
    expect(ticketCapabilities[0]!.participation).toHaveLength(2);
    // The two aliased entries carry byte-identical evidence, so ownership.ts finds no single
    // clearly-leading participant -- overlaps.ts correctly reclassifies "shared" to "overlapping"
    // (§14) and records a PortfolioOverlap, exactly as it would for two genuinely independent
    // products with undifferentiated coverage. alias_of gets no special-cased free pass here.
    expect(ticketCapabilities[0]!.coverage).toBe("overlapping");
    expect(model.overlaps.some((o) => o.capabilityId === ticketCapabilities[0]!.id)).toBe(true);
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

  it("with allowPartialPortfolio: true, correctly separates a 4-product portfolio into 2 compatible products and 2 excluded products with distinct compatibility statuses (missing_required_artifact, unsupported_schema)", () => {
    const ticketingRoot = writeArtifactRoot(repoRoot, "ticketing-core", ticketingCoreArtifacts());
    const docsRoot = writeArtifactRoot(repoRoot, "docs-portal", docsPortalArtifacts());
    const missingRoot = writeArtifactRoot(repoRoot, "missing-product", {});
    const { productIdentity, capabilityModel } = supportSuiteArtifacts();
    const unsupportedRoot = writeArtifactRoot(repoRoot, "unsupported-product", {
      productIdentity: { ...productIdentity, schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION + 1 },
      capabilityModel,
    });

    const config = makePortfolioConfig({
      portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
      products: [
        makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRoot }),
        makePortfolioConfigProduct({ id: "docs-portal", artifact_root: docsRoot }),
        makePortfolioConfigProduct({ id: "missing-product", artifact_root: missingRoot }),
        makePortfolioConfigProduct({ id: "unsupported-product", artifact_root: unsupportedRoot }),
      ],
    });

    const { model } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT, allowPartialPortfolio: true });

    expect(model.products).toHaveLength(2);
    expect(model.products.map((p) => p.source.configId).sort()).toEqual(["docs-portal", "ticketing-core"]);
    expect(model.excludedProducts).toHaveLength(2);
    const excludedByConfigId = new Map(model.excludedProducts.map((p) => [p.configId, p]));
    expect(excludedByConfigId.get("missing-product")?.compatibility).toBe("missing_required_artifact");
    expect(excludedByConfigId.get("unsupported-product")?.compatibility).toBe("unsupported_schema");
    expect(model.generationMetadata.incompatibleProductCount).toBe(2);
    expect(model.generationMetadata.allowPartialPortfolio).toBe(true);
    // An excluded product must never leak into capability normalization, relationships, gaps, etc.
    // -- it should be as if it were never in the config at all, aside from the excludedProducts record.
    for (const capability of model.capabilities) {
      expect(capability.participation.some((p) => p.productId.includes("missing-product") || p.productId.includes("unsupported-product"))).toBe(false);
    }
  });

  it("without allowPartialPortfolio, throws and names every incompatible product across a 4-product portfolio (not just the first found)", () => {
    const ticketingRoot = writeArtifactRoot(repoRoot, "ticketing-core", ticketingCoreArtifacts());
    const docsRoot = writeArtifactRoot(repoRoot, "docs-portal", docsPortalArtifacts());
    const missingRoot = writeArtifactRoot(repoRoot, "missing-product", {});
    const { productIdentity, capabilityModel } = supportSuiteArtifacts();
    const unsupportedRoot = writeArtifactRoot(repoRoot, "unsupported-product", {
      productIdentity: { ...productIdentity, schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION + 1 },
      capabilityModel,
    });

    const config = makePortfolioConfig({
      portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
      products: [
        makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRoot }),
        makePortfolioConfigProduct({ id: "docs-portal", artifact_root: docsRoot }),
        makePortfolioConfigProduct({ id: "missing-product", artifact_root: missingRoot }),
        makePortfolioConfigProduct({ id: "unsupported-product", artifact_root: unsupportedRoot }),
      ],
    });

    expect(() => synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT })).toThrow(/missing-product.*missing_required_artifact.*unsupported-product.*unsupported_schema|unsupported-product.*unsupported_schema.*missing-product.*missing_required_artifact/s);
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

// ---------------------------------------------------------------------------
// §M6.1 closure test: repeated source runs over reordered/shuffled inputs
// must produce semantically and byte-equivalent output. Each test below
// isolates exactly one axis of caller-supplied ordering (config.products,
// a product's includedCapabilities/currentCapabilities, a capability's own
// evidence array, and physical filesystem directory-creation order) so a
// regression in any one of them fails independently of the others.
// ---------------------------------------------------------------------------

function twoCapabilityProductArtifacts(order: "forward" | "reversed"): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const domainA = makeCapabilityDomain({ id: "capintel:domain:widget-operations", sourceLabel: "Widget Operations" });
  const domainB = makeCapabilityDomain({ id: "capintel:domain:reporting-analytics", sourceLabel: "Reporting Analytics" });
  const capA = makeCapability({
    id: "capintel:capability:widget-sync-alpha",
    sourceLabel: "Widget Sync Alpha",
    domainId: domainA.id,
    actors: ["Operator"],
    workflows: ["widget-lifecycle"],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("implementation", { sourcePath: "packages/widget/src/sync.ts" }), makeCapabilityEvidence("test", { sourcePath: "packages/widget/src/sync.test.ts" })],
  });
  const capB = makeCapability({
    id: "capintel:capability:report-builder",
    sourceLabel: "Report Builder",
    purpose: "Builds analytical reports from aggregated telemetry.",
    domainId: domainB.id,
    actors: ["Analyst"],
    workflows: ["report-generation"],
    externalSystems: [],
    evidence: [makeCapabilityEvidence("documentation", { sourcePath: "docs/reports.md" })],
  });
  const capabilityModel = makeCapabilityModel({
    domains: [domainA, domainB],
    includedCapabilities: order === "forward" ? [capA, capB] : [capB, capA],
    systemIdentity: { displayName: "Analytics Hub", purpose: "Synchronizes widgets and builds reports." },
    evidenceSummary: {
      totalCandidates: 2,
      includedCount: 2,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 1, test: 1, documentation: 1 },
      confidence: { confirmed: 2, derived: 0, suggested: 0, unresolved: 0, total: 2 },
    },
  });
  const productIdentity = makeProductIdentityModel(
    {},
    {
      displayName: "Analytics Hub",
      descriptor: "Operations platform for widget sync and reporting.",
      shortPromise: "Analytics Hub synchronizes widgets and builds reports for operators and analysts.",
      archetype: "operations_platform",
      purpose: "Synchronizes widget state and builds analytical reports for operators and analysts.",
      primaryUsers: ["Operator", "Analyst"],
      currentCapabilities: order === "forward" ? [capA.id, capB.id] : [capB.id, capA.id],
    },
  );
  return { productIdentity, capabilityModel };
}

function shuffledEvidenceArtifacts(order: "forward" | "reversed"): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const domain = makeCapabilityDomain({ id: "capintel:domain:widget-operations", sourceLabel: "Widget Operations" });
  const evidenceForward = [
    makeCapabilityEvidence("implementation", { sourcePath: "packages/widget/src/sync.ts" }),
    makeCapabilityEvidence("test", { sourcePath: "packages/widget/src/sync.test.ts" }),
    makeCapabilityEvidence("documentation", { sourcePath: "docs/widget-sync.md" }),
  ];
  const capability = makeCapability({
    id: "capintel:capability:widget-sync",
    sourceLabel: "Widget Sync",
    domainId: domain.id,
    actors: ["Operator"],
    workflows: ["widget-lifecycle"],
    externalSystems: [],
    evidence: order === "forward" ? evidenceForward : [...evidenceForward].reverse(),
  });
  const capabilityModel = makeCapabilityModel({
    domains: [domain],
    includedCapabilities: [capability],
    systemIdentity: { displayName: "Widget Platform", purpose: "Synchronizes widgets across systems." },
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: { implementation: 1, test: 1, documentation: 1 },
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
  });
  const productIdentity = makeProductIdentityModel(
    {},
    {
      displayName: "Widget Platform",
      descriptor: "Operations platform for widget synchronization.",
      shortPromise: "Widget Platform synchronizes widgets for operators.",
      archetype: "operations_platform",
      purpose: "Synchronizes widget state across operational systems for operators.",
      primaryUsers: ["Operator"],
      currentCapabilities: [capability.id],
    },
  );
  return { productIdentity, capabilityModel };
}

describe("synthesizePortfolio order-independence proofs", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-portfolio-order-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("produces a byte-identical model whether config.products lists products in forward or fully reversed order", () => {
    const config = setUpConfig(repoRoot);
    const reversedConfig: PortfolioConfig = { ...config, products: [...config.products].reverse() };

    const forward = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
    const reversed = synthesizePortfolio({ repoRoot, config: reversedConfig, generatedAt: GENERATED_AT });

    expect(JSON.stringify(forward.model)).toBe(JSON.stringify(reversed.model));
    expect(JSON.stringify(forward.claims)).toBe(JSON.stringify(reversed.claims));
  });

  it("produces identical normalized capabilities regardless of the order capabilities appear in a product's includedCapabilities/currentCapabilities arrays", () => {
    const repoRootB = mkdtempSync(join(tmpdir(), "rvs-portfolio-order-"));
    try {
      const rootA = writeArtifactRoot(repoRoot, "analytics-hub", twoCapabilityProductArtifacts("forward"));
      const rootB = writeArtifactRoot(repoRootB, "analytics-hub", twoCapabilityProductArtifacts("reversed"));
      const configA = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "analytics-hub", artifact_root: rootA })] });
      const configB = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "analytics-hub", artifact_root: rootB })] });

      const resultA = synthesizePortfolio({ repoRoot, config: configA, generatedAt: GENERATED_AT });
      const resultB = synthesizePortfolio({ repoRoot: repoRootB, config: configB, generatedAt: GENERATED_AT });

      expect(resultA.model.capabilities).toHaveLength(2);
      expect(JSON.stringify(resultA.model)).toBe(JSON.stringify(resultB.model));
    } finally {
      rmSync(repoRootB, { recursive: true, force: true });
    }
  });

  it("produces identical capability normalization output regardless of the order evidence entries appear within a capability's own evidence array", () => {
    const repoRootB = mkdtempSync(join(tmpdir(), "rvs-portfolio-order-"));
    try {
      const rootA = writeArtifactRoot(repoRoot, "widget-platform", shuffledEvidenceArtifacts("forward"));
      const rootB = writeArtifactRoot(repoRootB, "widget-platform", shuffledEvidenceArtifacts("reversed"));
      const configA = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "widget-platform", artifact_root: rootA })] });
      const configB = makePortfolioConfig({ products: [makePortfolioConfigProduct({ id: "widget-platform", artifact_root: rootB })] });

      const resultA = synthesizePortfolio({ repoRoot, config: configA, generatedAt: GENERATED_AT });
      const resultB = synthesizePortfolio({ repoRoot: repoRootB, config: configB, generatedAt: GENERATED_AT });

      expect(JSON.stringify(resultA.model)).toBe(JSON.stringify(resultB.model));
    } finally {
      rmSync(repoRootB, { recursive: true, force: true });
    }
  });

  it("produces a byte-identical model regardless of the physical order artifact directories are created on disk, independent of config.products order", () => {
    const repoRootB = mkdtempSync(join(tmpdir(), "rvs-portfolio-order-"));
    try {
      // repoRoot: write ticketing-core, then support-suite, then docs-portal (natural order).
      const ticketingRootA = writeArtifactRoot(repoRoot, "ticketing-core", ticketingCoreArtifacts());
      const supportRootA = writeArtifactRoot(repoRoot, "support-suite", supportSuiteArtifacts());
      const docsRootA = writeArtifactRoot(repoRoot, "docs-portal", docsPortalArtifacts());

      // repoRootB: create the SAME three artifact directories but in reverse physical
      // order -- docs-portal's directory exists before ticketing-core's on disk, even
      // though configB below still lists products in the identical ticketing-core /
      // support-suite / docs-portal logical order as configA.
      const docsRootB = writeArtifactRoot(repoRootB, "docs-portal", docsPortalArtifacts());
      const supportRootB = writeArtifactRoot(repoRootB, "support-suite", supportSuiteArtifacts());
      const ticketingRootB = writeArtifactRoot(repoRootB, "ticketing-core", ticketingCoreArtifacts());

      const configA = makePortfolioConfig({
        portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
        products: [
          makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRootA }),
          makePortfolioConfigProduct({ id: "support-suite", artifact_root: supportRootA }),
          makePortfolioConfigProduct({ id: "docs-portal", artifact_root: docsRootA }),
        ],
      });
      const configB = makePortfolioConfig({
        portfolio: { id: "test-portfolio", display_name: "Test Portfolio" },
        products: [
          makePortfolioConfigProduct({ id: "ticketing-core", artifact_root: ticketingRootB }),
          makePortfolioConfigProduct({ id: "support-suite", artifact_root: supportRootB }),
          makePortfolioConfigProduct({ id: "docs-portal", artifact_root: docsRootB }),
        ],
      });

      const resultA = synthesizePortfolio({ repoRoot, config: configA, generatedAt: GENERATED_AT });
      const resultB = synthesizePortfolio({ repoRoot: repoRootB, config: configB, generatedAt: GENERATED_AT });

      expect(JSON.stringify(resultA.model)).toBe(JSON.stringify(resultB.model));
      expect(JSON.stringify(resultA.claims)).toBe(JSON.stringify(resultB.claims));
    } finally {
      rmSync(repoRootB, { recursive: true, force: true });
    }
  });

  it("produces byte-identical model/claims/narrative/plan output across 5 independent fresh synthesis runs of the same input", () => {
    // A single pairwise "runA === runB" comparison (the existing "is deterministic" test
    // above) can miss nondeterminism that only shows up probabilistically -- e.g. a Map/Set
    // whose iteration order happens to coincide on two runs but diverges on a third across
    // the full 3-product, shared-capability fixture (the richest fixture in this file: it
    // exercises capability normalization's union-find grouping, product-relationships,
    // dependency graph, overlaps, gaps, operating model, maturity, claim control, narrative,
    // and portfolio-plan scene selection all at once). Five runs, each compared against the
    // first, gives meaningfully more confidence than two.
    const config = setUpConfig(repoRoot);

    const runs = Array.from({ length: 5 }, () => {
      const { model, claims } = synthesizePortfolio({ repoRoot, config, generatedAt: GENERATED_AT });
      const narrative = synthesizePortfolioNarrative(model, claims);
      const plan = synthesizePortfolioPlan({ model, narrative, claims, audience: "executive", theme: "default", generatedAt: GENERATED_AT });
      return { model: JSON.stringify(model), claims: JSON.stringify(claims), narrative: JSON.stringify(narrative), plan: JSON.stringify(plan) };
    });

    for (const run of runs.slice(1)) {
      expect(run.model).toBe(runs[0]!.model);
      expect(run.claims).toBe(runs[0]!.claims);
      expect(run.narrative).toBe(runs[0]!.narrative);
      expect(run.plan).toBe(runs[0]!.plan);
    }
  });
});
