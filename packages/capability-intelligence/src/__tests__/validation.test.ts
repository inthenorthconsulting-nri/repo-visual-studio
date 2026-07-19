import { describe, expect, it } from "vitest";
import type { CapabilityDomain, ExcludedCapabilityCandidate } from "../contracts.js";
import { capDomainId } from "../ids.js";
import { validateCapabilityModelStructure } from "../validation.js";
import { makeCapability, makeCapabilityEvidence, makeCleanCapabilityModel, makeReadiness } from "./fixtures.js";

/**
 * Covers every CapIntelWarningCode that validateCapabilityModelStructure()
 * itself can emit. Two codes (CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN,
 * CAP_INTEL_OVER_GRANULAR_DOMAIN) are emitted by buildCapabilityDomains()
 * instead and are covered in grouping.test.ts.
 */

describe("validateCapabilityModelStructure — clean baseline", () => {
  it("produces zero warnings for a structurally well-formed model", () => {
    expect(validateCapabilityModelStructure(makeCleanCapabilityModel())).toEqual([]);
  });
});

describe("validateCapabilityModelStructure — per-capability structural checks", () => {
  it("CAP_INTEL_RAW_PATH_AS_CAPABILITY_NAME: a raw file path rendered as the display name", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, displayName: "packages/widget-sync/src/index.ts" };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_RAW_PATH_AS_CAPABILITY_NAME")).toBe(true);
  });

  it("CAP_INTEL_CAPABILITY_TOO_GRANULAR: a non-'capability' granularity promoted as a primary entry", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, granularity: "feature" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_CAPABILITY_TOO_GRANULAR" && w.severity === "error")).toBe(true);
  });

  it("CAP_INTEL_CAPABILITY_TOO_GRANULAR: a single-word name backed by only one evidence item", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, displayName: "Sync", evidence: [makeCapabilityEvidence("implementation")] };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_CAPABILITY_TOO_GRANULAR" && w.severity === "informational")).toBe(true);
  });

  it("CAP_INTEL_SCAFFOLD_PROMOTED: a scaffolded capability promoted into included output", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "scaffolded" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_SCAFFOLD_PROMOTED")).toBe(true);
  });

  it("CAP_INTEL_PLANNED_CAPABILITY_PROMOTED: a planned capability promoted into included output", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "planned" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_PLANNED_CAPABILITY_PROMOTED")).toBe(true);
  });

  it("CAP_INTEL_DEPRECATED_CAPABILITY_PROMOTED: a deprecated capability promoted into included output", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "deprecated" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_DEPRECATED_CAPABILITY_PROMOTED")).toBe(true);
  });

  it("CAP_INTEL_DOCUMENTATION_ONLY_CAPABILITY: an 'unknown' status capability promoted into included output", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "unknown" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_DOCUMENTATION_ONLY_CAPABILITY")).toBe(true);
  });

  it("CAP_INTEL_NO_EXECUTION_PATH: an operational/implemented capability with a zero execution score — the hard gate must never be overridden by status classification", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "implemented" as const, readiness: makeReadiness({ executionScore: 0 }) };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_NO_EXECUTION_PATH")).toBe(true);
  });

  it("CAP_INTEL_PARTIAL_CAPABILITY_UNQUALIFIED: a 'partial' status capability rendered as an unqualified 'include'", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "partial" as const, inclusion: "include" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_PARTIAL_CAPABILITY_UNQUALIFIED")).toBe(true);
  });

  it("CAP_INTEL_UNSUPPORTED_OUTCOME: a quantified/production outcome claim with no usage/deployment/release evidence to back it", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, outcome: "This capability saves $50,000 annually.", evidence: [makeCapabilityEvidence("implementation")] };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_UNSUPPORTED_OUTCOME")).toBe(true);
  });

  it("CAP_INTEL_MISSING_EVIDENCE: an included/qualified capability with no evidence at all", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, evidence: [] };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_MISSING_EVIDENCE")).toBe(true);
  });

  it("CAP_INTEL_CONTRADICTORY_EVIDENCE: confirmed structural evidence coexisting with a deprecated marker, on a capability not classified as deprecated", () => {
    const clean = makeCleanCapabilityModel();
    const bad = {
      ...clean.includedCapabilities[0]!,
      status: "implemented" as const,
      evidence: [makeCapabilityEvidence("workflow", { confidence: "confirmed" }), makeCapabilityEvidence("deprecated_marker")],
    };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_CONTRADICTORY_EVIDENCE")).toBe(true);
  });

  it("CAP_INTEL_UNKNOWN_STATUS_IN_EXECUTIVE_OUTPUT: an 'unresolved' confidence capability surfaced in executive-facing output", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, confidence: "unresolved" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_UNKNOWN_STATUS_IN_EXECUTIVE_OUTPUT")).toBe(true);
  });

  it("CAP_INTEL_PLACEHOLDER_PROMOTED: a promoted capability that still carries a placeholder-style incomplete signal", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, matchedIncompleteSignals: ["placeholder"] };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_PLACEHOLDER_PROMOTED")).toBe(true);
  });

  it("CAP_INTEL_PLACEHOLDER_PROMOTED: does not warn for a promoted capability with no placeholder-style signal", () => {
    const clean = makeCleanCapabilityModel();
    const warnings = validateCapabilityModelStructure(clean);
    expect(warnings.some((w) => w.code === "CAP_INTEL_PLACEHOLDER_PROMOTED")).toBe(false);
  });
});

describe("validateCapabilityModelStructure — duplicate detection", () => {
  it("CAP_INTEL_DUPLICATE_CAPABILITY: two distinct-id capabilities sharing the same display name were not merged by candidate deduplication", () => {
    const clean = makeCleanCapabilityModel();
    const renamedQualified = { ...clean.qualifiedCapabilities[0]!, displayName: clean.includedCapabilities[0]!.displayName };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [clean.includedCapabilities[0]!], qualifiedCapabilities: [renamedQualified] });
    expect(warnings.filter((w) => w.code === "CAP_INTEL_DUPLICATE_CAPABILITY" && w.severity === "warning")).toHaveLength(2);
  });

  it("CAP_INTEL_DUPLICATE_CAPABILITY: the same id reused across two distinct entries in the model (e.g. a capability and an excluded candidate)", () => {
    const clean = makeCleanCapabilityModel();
    const included = clean.includedCapabilities[0]!;
    const excluded: ExcludedCapabilityCandidate = {
      id: included.id,
      displayName: "Duplicate Id Candidate",
      domainId: included.domainId,
      sourceLabel: "Duplicate Id Candidate",
      granularity: "capability",
      status: "unknown",
      confidence: "unresolved",
      readiness: makeReadiness({ score: 0 }),
      reasonCodes: ["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"],
      reasonSummary: "No implementation evidence found.",
      evidence: [],
    };
    const warnings = validateCapabilityModelStructure({ ...clean, excludedCandidates: [excluded] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_DUPLICATE_CAPABILITY" && w.severity === "error")).toBe(true);
  });
});

describe("validateCapabilityModelStructure — deterministic order invariant", () => {
  it("CAP_INTEL_NONDETERMINISTIC_ORDER: includedCapabilities out of ascending-id order", () => {
    const clean = makeCleanCapabilityModel();
    const domainId = clean.domains[0]!.id;
    const zeta = makeCapability({ sourceLabel: "Zeta Capability", domainId, status: "implemented", inclusion: "include" });
    const alpha = makeCapability({ sourceLabel: "Alpha Capability", domainId, status: "implemented", inclusion: "include" });
    expect(zeta.id.localeCompare(alpha.id)).toBeGreaterThan(0);
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [zeta, alpha], qualifiedCapabilities: [] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_NONDETERMINISTIC_ORDER" && w.relatedId === alpha.id)).toBe(true);
  });

  it("CAP_INTEL_NONDETERMINISTIC_ORDER: a domain's own capabilities array out of ascending-id order", () => {
    const clean = makeCleanCapabilityModel();
    const domain = clean.domains[0]!;
    const reversed = { ...domain, capabilities: [...domain.capabilities].reverse() };
    expect(reversed.capabilities.length).toBeGreaterThan(1);
    const warnings = validateCapabilityModelStructure({ ...clean, domains: [reversed] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_NONDETERMINISTIC_ORDER")).toBe(true);
  });

  it("does not warn when every collection is already sorted by id ascending", () => {
    const warnings = validateCapabilityModelStructure(makeCleanCapabilityModel());
    expect(warnings.some((w) => w.code === "CAP_INTEL_NONDETERMINISTIC_ORDER")).toBe(false);
  });
});

describe("validateCapabilityModelStructure — domain-level checks", () => {
  it("CAP_INTEL_EMPTY_DOMAIN: a domain listed with no included/qualified capabilities", () => {
    const clean = makeCleanCapabilityModel();
    const emptyDomain: CapabilityDomain = { ...clean.domains[0]!, capabilities: [] };
    const warnings = validateCapabilityModelStructure({ ...clean, domains: [emptyDomain] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_EMPTY_DOMAIN")).toBe(true);
  });

  it("CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS: a domainId referenced only by roadmap capabilities, with no visible included/qualified capability", () => {
    const clean = makeCleanCapabilityModel();
    const roadmapOnlyDomainId = capDomainId("Roadmap Only Domain");
    const roadmapCap = makeCapability({ sourceLabel: "Widget Multi-Region Rollout", domainId: roadmapOnlyDomainId, status: "planned", inclusion: "roadmap_only" });
    const warnings = validateCapabilityModelStructure({ ...clean, domains: [], includedCapabilities: [], qualifiedCapabilities: [], roadmapCapabilities: [roadmapCap] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS" && w.relatedId === roadmapOnlyDomainId)).toBe(true);
  });
});

describe("validateCapabilityModelStructure — roadmap/excluded status leakage", () => {
  it("CAP_INTEL_ROADMAP_ITEM_COUNTED_AS_CURRENT: a roadmap-only capability carrying a current-implementation status", () => {
    const clean = makeCleanCapabilityModel();
    const bad = { ...clean.includedCapabilities[0]!, status: "implemented" as const, inclusion: "roadmap_only" as const };
    const warnings = validateCapabilityModelStructure({ ...clean, includedCapabilities: [], roadmapCapabilities: [bad] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_ROADMAP_ITEM_COUNTED_AS_CURRENT")).toBe(true);
  });

  it("CAP_INTEL_EXCLUDED_CAPABILITY_COUNTED_AS_CURRENT: an excluded candidate carrying a current-implementation status", () => {
    const clean = makeCleanCapabilityModel();
    const excluded: ExcludedCapabilityCandidate = {
      id: "cap:capability:Excluded-But-Implemented",
      displayName: "Excluded But Implemented",
      domainId: clean.domains[0]!.id,
      sourceLabel: "Excluded But Implemented",
      granularity: "capability",
      status: "implemented",
      confidence: "confirmed",
      readiness: makeReadiness(),
      reasonCodes: ["EXTERNAL_RUNTIME_REQUIRED"],
      reasonSummary: "Excluded for diagnostic purposes despite an implemented status.",
      evidence: [makeCapabilityEvidence("implementation")],
    };
    const warnings = validateCapabilityModelStructure({ ...clean, excludedCandidates: [excluded] });
    expect(warnings.some((w) => w.code === "CAP_INTEL_EXCLUDED_CAPABILITY_COUNTED_AS_CURRENT")).toBe(true);
  });
});
