import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { PortfolioClaim, PortfolioDecision, PortfolioModel } from "@rvs/portfolio-intelligence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExportPortfolioClaims } from "../commands/export-portfolio-claims.js";
import { runExportPortfolioDecisions } from "../commands/export-portfolio-decisions.js";
import { runExportPortfolioModel } from "../commands/export-portfolio-model.js";
import { runPortfolioExplain } from "../commands/portfolio-explain.js";
import { runSynthesizePortfolio } from "../commands/synthesize-portfolio.js";

function makeLogger(): Logger & { infos: string[]; warns: string[]; errors: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    warns,
    errors,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
    error: (m: string) => errors.push(m),
    debug: () => {},
  };
}

function cleanPortfolioModel(): PortfolioModel {
  const dimension = { score: 1, numerator: 1, denominator: 1, label: "dimension" };
  return {
    schemaVersion: 1,
    portfolioId: "portfolio:test",
    displayName: "Test Portfolio",
    products: [
      {
        id: "portfolio:product:widget-cli",
        displayName: "Widget CLI",
        descriptor: "Governs widget rollout",
        primaryArchetype: "governance_platform",
        secondaryArchetypes: [],
        primaryRole: "governance_system",
        secondaryRoles: [],
        currentCapabilityIds: [],
        qualifiedCapabilityIds: [],
        currentCapabilityCount: 0,
        qualifiedCapabilityCount: 0,
        source: { configId: "widget-cli", artifactRoot: "../widget-cli", compatibility: "compatible" },
      },
    ],
    domains: [],
    capabilities: [],
    relationships: [],
    unresolvedRelationships: [],
    dependencyGraph: { nodes: [], edges: [] },
    overlaps: [],
    gaps: [],
    operatingModel: { stages: [], transitions: [], unassignedProductIds: [] },
    maturity: { coverage: dimension, operational: dimension, verification: dimension, integration: dimension, ownership: dimension, runtimeEvidence: dimension, coherence: dimension },
    evidence: [],
    evidenceSummary: {
      productCount: 1,
      uniqueCapabilityCount: 0,
      productCapabilityImplementationCount: 0,
      qualifiedOnlyCapabilityCount: 0,
      confirmedRelationshipCount: 0,
      materialOverlapCount: 0,
      gapCount: 0,
      productsWithRuntimeEvidenceCount: 0,
    },
    excludedProducts: [],
    generationMetadata: { generated_at: "2026-01-01T00:00:00.000Z", schema_version: 1, productCount: 1, incompatibleProductCount: 0, allowPartialPortfolio: false },
  };
}

function cleanClaim(overrides: Partial<PortfolioClaim> = {}): PortfolioClaim {
  return {
    id: "portfolio:claim:identity:widget-cli",
    text: "Widget CLI governs widget rollout.",
    claimType: "identity",
    status: "approved",
    evidenceIds: [],
    qualifiers: [],
    rejectionReasons: [],
    ...overrides,
  };
}

function cleanDecision(overrides: Partial<PortfolioDecision> = {}): PortfolioDecision {
  return {
    id: "portfolio:decision:ownership:widget-sync",
    type: "ownership",
    statement: "Determine an explicit owner for widget-sync.",
    whyItMatters: "Ownership is currently unresolved.",
    affectedProductIds: [],
    evidenceIds: [],
    currentAmbiguity: "No single product claims ownership.",
    recommendedOwnerType: "architecture_council",
    urgency: "medium",
    confidence: "derived",
    ...overrides,
  };
}

// Minimal self-consistent artifact pair for a single compatible product,
// per intake.ts/compatibility.ts's requirements: matching schemaVersion 1,
// identity.currentCapabilities intersecting capability-model's included
// capability ids, and source_capability_model_generated_at exactly equal to
// the capability model's own generated_at.
const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function validCapabilityModel(schemaVersion = 1): unknown {
  return {
    schemaVersion,
    systemIdentity: { displayName: "Widget Platform", purpose: "Automates widget operations." },
    domains: [
      {
        id: "capintel:domain:widget-operations",
        displayName: "Widget Operations",
        purpose: "Everything involved in widget operations.",
        capabilities: [],
        evidenceCount: 0,
        operationalCapabilityCount: 0,
        partialCapabilityCount: 0,
      },
    ],
    includedCapabilities: [
      {
        id: "capintel:capability:widget-sync",
        displayName: "Widget Sync",
        shortDescription: "Widget Sync",
        purpose: "Handles widget sync for the platform.",
        domainId: "capintel:domain:widget-operations",
        status: "implemented",
        confidence: "confirmed",
        inclusion: "include",
        readiness: {
          score: 80,
          implementationScore: 80,
          executionScore: 80,
          verificationScore: 80,
          documentationScore: 80,
          adoptionScore: 80,
          blockers: [],
          qualifiers: [],
        },
        actors: ["Operator"],
        workflows: ["widget-lifecycle"],
        logicalComponents: [],
        externalSystems: [],
        evidence: [
          {
            id: "capintel:evidence:widget:implementation:0",
            type: "implementation",
            sourcePath: "packages/widget/src/implementation.ts",
            description: "implementation evidence.",
            strength: 4,
            confidence: "confirmed",
          },
        ],
        matchedIncompleteSignals: [],
        naming: { sourceLabel: "Widget Sync", basis: "title-case" },
        granularity: "capability",
      },
    ],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: 1,
      includedCount: 1,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: {},
      confidence: { confirmed: 1, derived: 0, suggested: 0, unresolved: 0, total: 1 },
    },
    generationMetadata: {
      generated_at: GENERATED_AT,
      git_commit: "abc1234",
      schema_version: 1,
      source_architecture_intelligence_generated_at: GENERATED_AT,
      assist_used: false,
      readinessThresholds: { operational: 85, implemented: 70, partial: 45, experimental: 25, scaffolded: 10 },
      readinessWeights: { implementation: 35, execution: 25, verification: 20, documentation: 10, adoption: 10 },
      candidateCount: 0,
    },
  };
}

function validProductIdentity(schemaVersion = 1): unknown {
  return {
    schemaVersion,
    identity: {
      displayName: "Widget Platform",
      descriptor: "Governance and compliance platform",
      shortPromise: "Widget Platform governs widget operations for compliance teams.",
      archetype: "governance_platform",
      secondaryArchetypes: [],
      purpose: "Provides governed oversight of widget operations for compliance officers.",
      primaryUsers: ["Compliance Officer"],
      secondaryUsers: [],
      valuePillars: [],
      differentiators: [],
      currentCapabilities: ["capintel:capability:widget-sync"],
      qualifiedCapabilities: [],
      limitations: [],
      evidence: [],
      confidence: "confirmed",
      overrideApplied: false,
    },
    candidates: [],
    archetypeScores: [],
    generationMetadata: {
      generated_at: GENERATED_AT,
      git_commit: "abc1234",
      schema_version: 1,
      source_capability_model_generated_at: GENERATED_AT,
      assist_used: false,
      overrideApplied: false,
      candidateCount: 1,
    },
  };
}

function writeArtifactRoot(repoRoot: string, configId: string, opts: { capabilitySchemaVersion?: number; identitySchemaVersion?: number } = {}): void {
  const root = resolve(repoRoot, "artifacts", configId);
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "capability-model.json"), JSON.stringify(validCapabilityModel(opts.capabilitySchemaVersion ?? 1)));
  writeFileSync(resolve(root, "product-identity.json"), JSON.stringify(validProductIdentity(opts.identitySchemaVersion ?? 1)));
}

function writePortfolioConfig(repoRoot: string, products: Array<{ id: string; artifact_root: string }>): void {
  const productsYaml = products.map((p) => `  - id: ${p.id}\n    artifact_root: ${p.artifact_root}`).join("\n");
  const yaml = `schema_version: 1\nportfolio:\n  id: test-portfolio\n  display_name: Test Portfolio\nproducts:\n${productsYaml}\n`;
  mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/portfolio.yml"), yaml);
}

describe("runSynthesizePortfolio", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-synthesize-portfolio-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("throws a clear error when no .rvs/portfolio.yml exists", async () => {
    const logger = makeLogger();
    await expect(runSynthesizePortfolio(repoRoot, {}, logger)).rejects.toThrow("No .rvs/portfolio.yml found.");
  });

  it("succeeds on a valid config with one compatible product: writes all 3 cache files, logs a summary, and never touches process.exitCode", async () => {
    writeArtifactRoot(repoRoot, "widget-cli", {});
    writePortfolioConfig(repoRoot, [{ id: "widget-cli", artifact_root: "./artifacts/widget-cli" }]);

    const logger = makeLogger();
    process.exitCode = undefined;
    await runSynthesizePortfolio(repoRoot, {}, logger);

    expect(readFileSync(resolve(repoRoot, ".rvs/cache/portfolio-model.json"), "utf8")).toContain('"widget-cli"');
    expect(() => JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/portfolio-claims.json"), "utf8"))).not.toThrow();
    expect(() => JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/portfolio-decisions.json"), "utf8"))).not.toThrow();
    expect(logger.infos.some((m) => m.includes('Synthesized portfolio "Test Portfolio": 1 product(s)'))).toBe(true);
    expect(logger.errors).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("propagates synthesizePortfolio()'s own error when an incompatible product exists and allowPartial is not set", async () => {
    writeArtifactRoot(repoRoot, "widget-cli", { capabilitySchemaVersion: 2 });
    writePortfolioConfig(repoRoot, [{ id: "widget-cli", artifact_root: "./artifacts/widget-cli" }]);

    const logger = makeLogger();
    await expect(runSynthesizePortfolio(repoRoot, {}, logger)).rejects.toThrow();
  });

  it("does not throw with allowPartial: true when one product is compatible and another is incompatible -- logs a warning listing the excluded configId, still writes cache files, and never touches process.exitCode", async () => {
    writeArtifactRoot(repoRoot, "widget-cli", {});
    writeArtifactRoot(repoRoot, "legacy-cli", { capabilitySchemaVersion: 2 });
    writePortfolioConfig(repoRoot, [
      { id: "widget-cli", artifact_root: "./artifacts/widget-cli" },
      { id: "legacy-cli", artifact_root: "./artifacts/legacy-cli" },
    ]);

    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runSynthesizePortfolio(repoRoot, { allowPartial: true }, logger)).resolves.toBeUndefined();

    expect(logger.warns.some((m) => m.includes("1 product(s) excluded as incompatible: legacy-cli"))).toBe(true);
    expect(() => JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/portfolio-model.json"), "utf8"))).not.toThrow();
    // rvs synthesize portfolio is intentionally non-blocking on validation (unlike `rvs
    // validate --ci`): even with a warning logged via logger.warn, process.exitCode is
    // never touched here. Tier-1 "error"-severity PortfolioWarning codes (see
    // validation.ts's TIER1_ERROR_CODES) would be logged via logger.error instead, by
    // the same unconditional, non-throwing loop -- but those codes are defensive
    // structural invariants that legitimate multi-product synthesis cannot actually
    // produce (e.g. capability-normalization.ts's union-find explicitly refuses to
    // merge two capabilities from the same product, and incompatible products are
    // excluded from the model before validatePortfolioModel ever runs against it), so
    // they are exercised directly against hand-built PortfolioModel fixtures in
    // validation.test.ts / validate.test.ts's validateCachedPortfolio suite instead of
    // here.
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runExportPortfolioModel", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-portfolio-model-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("throws the standard missing-cache error when portfolio-model.json has never been written", async () => {
    const logger = makeLogger();
    await expect(runExportPortfolioModel(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/portfolio-model.json. Run `rvs inspect` first.");
  });

  it("writes the requested output file and logs a summary when the cache exists", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-model.json"), JSON.stringify(cleanPortfolioModel()));

    const logger = makeLogger();
    await runExportPortfolioModel(repoRoot, { output: "out/model.json" }, logger);

    const outputPath = resolve(repoRoot, "out/model.json");
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(cleanPortfolioModel());
    expect(logger.infos.some((m) => m.includes("1 product(s)"))).toBe(true);
  });
});

describe("runExportPortfolioClaims", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-portfolio-claims-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("throws the standard missing-cache error when portfolio-claims.json has never been written", async () => {
    const logger = makeLogger();
    await expect(runExportPortfolioClaims(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/portfolio-claims.json. Run `rvs inspect` first.");
  });

  it("writes rejected claims verbatim alongside approved ones and reports the correct approved count", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    const claims = [cleanClaim(), cleanClaim({ id: "portfolio:claim:coverage:x", status: "rejected", rejectionReasons: ["PORTFOLIO_CLAIM_UNSUPPORTED"] })];
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-claims.json"), JSON.stringify(claims));

    const logger = makeLogger();
    await runExportPortfolioClaims(repoRoot, { output: "out/claims.json" }, logger);

    const written = JSON.parse(readFileSync(resolve(repoRoot, "out/claims.json"), "utf8"));
    expect(written).toEqual(claims);
    expect(logger.infos.some((m) => m.includes("2 claim(s), 1 approved"))).toBe(true);
  });
});

describe("runExportPortfolioDecisions", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-portfolio-decisions-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("throws the standard missing-cache error when portfolio-decisions.json has never been written", async () => {
    const logger = makeLogger();
    await expect(runExportPortfolioDecisions(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/portfolio-decisions.json. Run `rvs inspect` first.");
  });

  it("writes the requested output file and logs a summary when the cache exists", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    const decisions = [cleanDecision()];
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-decisions.json"), JSON.stringify(decisions));

    const logger = makeLogger();
    await runExportPortfolioDecisions(repoRoot, { output: "out/decisions.json" }, logger);

    const written = JSON.parse(readFileSync(resolve(repoRoot, "out/decisions.json"), "utf8"));
    expect(written).toEqual(decisions);
    expect(logger.infos.some((m) => m.includes("1 decision(s)"))).toBe(true);
  });
});

describe("runPortfolioExplain", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-portfolio-explain-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("sets process.exitCode = 1 and logs an error when neither cache exists at all (never throws)", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runPortfolioExplain(repoRoot, "portfolio:claim:identity:widget-cli", logger)).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(logger.errors.some((m) => m.includes('No claim or decision found matching "portfolio:claim:identity:widget-cli"'))).toBe(true);
    process.exitCode = undefined;
  });

  it("sets process.exitCode = 1 and logs an error when the given id matches neither a claim nor a decision in existing caches", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-claims.json"), JSON.stringify([cleanClaim()]));
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-decisions.json"), JSON.stringify([cleanDecision()]));

    const logger = makeLogger();
    process.exitCode = undefined;
    await runPortfolioExplain(repoRoot, "portfolio:claim:does-not-exist", logger);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("finds and explains a matching claim without touching process.exitCode", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-claims.json"), JSON.stringify([cleanClaim()]));

    const logger = makeLogger();
    process.exitCode = undefined;
    await runPortfolioExplain(repoRoot, "portfolio:claim:identity:widget-cli", logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.infos.some((m) => m.includes("Widget CLI governs widget rollout."))).toBe(true);
    expect(logger.errors).toEqual([]);
  });

  it("falls back to the decisions cache and explains a matching decision when the id is absent from claims (proving the claim-then-decision fallback order works, not just claim-only lookup)", async () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-claims.json"), JSON.stringify([cleanClaim()]));
    writeFileSync(resolve(repoRoot, ".rvs/cache/portfolio-decisions.json"), JSON.stringify([cleanDecision()]));

    const logger = makeLogger();
    process.exitCode = undefined;
    await runPortfolioExplain(repoRoot, "portfolio:decision:ownership:widget-sync", logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.infos.some((m) => m.includes("Determine an explicit owner for widget-sync."))).toBe(true);
    expect(logger.errors).toEqual([]);
  });
});
