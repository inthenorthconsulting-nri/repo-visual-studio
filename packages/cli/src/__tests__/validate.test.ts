import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { CapabilityModel, CapabilityDomain } from "@rvs/capability-intelligence";
import { DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "@rvs/capability-intelligence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCachedCapabilityModel } from "../commands/validate.js";

// These tests exercise validateCachedCapabilityModel() directly rather than
// runValidate() end to end, because runValidate() unconditionally validates
// deck.html first via @rvs/validator's validateHtmlFile(), which launches a
// real Chromium instance. Nothing in this workspace's default `vitest run`
// suite depends on a Playwright browser being installed — browser install
// only happens in the CI `build-deck` job — so adding that dependency here
// would break the plain `test` job on a clean runner. The full pipeline
// (including a real capability-model.json feeding a real `rvs validate --ci`
// with Chromium available) is covered by the opt-in packaged e2e smoke test
// in packages/cli/src/__tests__/package-smoke.test.ts instead.

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

function baseGenerationMetadata(): CapabilityModel["generationMetadata"] {
  return {
    generated_at: "2026-01-01T00:00:00.000Z",
    git_commit: "abc1234",
    schema_version: 1,
    source_architecture_intelligence_generated_at: "2026-01-01T00:00:00.000Z",
    assist_used: false,
    readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
    readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
    candidateCount: 0,
  };
}

function baseEvidenceSummary(): CapabilityModel["evidenceSummary"] {
  return {
    totalCandidates: 0,
    includedCount: 0,
    qualifiedCount: 0,
    excludedCount: 0,
    roadmapCount: 0,
    gapCount: 0,
    unresolvedCount: 0,
    evidenceTypeCounts: {},
    confidence: { confirmed: 0, derived: 0, suggested: 0, unresolved: 0, total: 0 },
  };
}

// Structurally clean and empty: validateCapabilityModelStructure() has
// nothing to iterate over, so it deterministically produces zero warnings.
function cleanCapabilityModel(): CapabilityModel {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Test System" },
    domains: [],
    includedCapabilities: [],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: baseEvidenceSummary(),
    generationMetadata: baseGenerationMetadata(),
  };
}

// A single domain with no capabilities deterministically trips
// CAP_INTEL_EMPTY_DOMAIN (severity "error") in validateCapabilityModelStructure().
function capabilityModelWithEmptyDomain(): CapabilityModel {
  const emptyDomain: CapabilityDomain = {
    id: "cap:domain:empty",
    displayName: "Empty Domain",
    purpose: "test fixture",
    capabilities: [],
    evidenceCount: 0,
    operationalCapabilityCount: 0,
    partialCapabilityCount: 0,
  };
  return { ...cleanCapabilityModel(), domains: [emptyDomain] };
}

describe("validateCachedCapabilityModel", () => {
  let repoRoot: string;
  let outputDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-validate-cap-"));
    outputDir = resolve(repoRoot, "artifacts/visuals");
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("is a clean no-op when no capability-model.json cache exists", () => {
    const logger = makeLogger();
    const outcome = validateCachedCapabilityModel(repoRoot, outputDir, logger);

    expect(outcome).toEqual({ ran: false, hasError: false });
    expect(logger.infos).toEqual([]);
    expect(logger.warns).toEqual([]);
    expect(logger.errors).toEqual([]);
    expect(existsSync(resolve(outputDir, "capability-validation-report.json"))).toBe(false);
  });

  it("reports hasError: false for a structurally clean capability model, and does not log any error", () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/capability-model.json"), JSON.stringify(cleanCapabilityModel()));

    const logger = makeLogger();
    const outcome = validateCachedCapabilityModel(repoRoot, outputDir, logger);

    expect(outcome).toEqual({ ran: true, hasError: false });
    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.includes("0 error(s)"))).toBe(true);
  });

  it("reports hasError: true and logs an error for a capability model with a structural error (CAP_INTEL_EMPTY_DOMAIN) — the signal runValidate()'s --ci path uses to fail the build", () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/capability-model.json"), JSON.stringify(capabilityModelWithEmptyDomain()));

    const logger = makeLogger();
    const outcome = validateCachedCapabilityModel(repoRoot, outputDir, logger);

    expect(outcome).toEqual({ ran: true, hasError: true });
    expect(logger.errors.some((m) => m.includes("CAP_INTEL_EMPTY_DOMAIN"))).toBe(true);
  });

  it("writes capability-validation-report.json with the CapIntelWarning[] shape", () => {
    mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/cache/capability-model.json"), JSON.stringify(capabilityModelWithEmptyDomain()));

    const logger = makeLogger();
    validateCachedCapabilityModel(repoRoot, outputDir, logger);

    const reportPath = resolve(outputDir, "capability-validation-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(Array.isArray(report)).toBe(true);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ code: "CAP_INTEL_EMPTY_DOMAIN", severity: "error", relatedId: "cap:domain:empty" });
  });
});
