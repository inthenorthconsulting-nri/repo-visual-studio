import { describe, expect, it } from "vitest";
import type { ProductIdentityModel, ProductIdentityOverride, ShowcasePlan, ShowcaseScenePlan } from "../contracts.js";
import { validateProductIdentityModel, validateShowcasePlan } from "../validation.js";
import { capId, makeCapability, makeEmptyCapabilityModel, makeExcludedCandidate, makeExecutiveNarrative, makeProductClaim, makeProductIdentity, makeValuePillar } from "./fixtures.js";

function makeIdentityModel(overrides: Partial<ProductIdentityModel> = {}): ProductIdentityModel {
  return {
    schemaVersion: 1,
    identity: makeProductIdentity(),
    candidates: [],
    archetypeScores: [],
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: 1,
      source_capability_model_generated_at: "2026-07-01T00:00:00.000Z",
      assist_used: false,
      overrideApplied: false,
      candidateCount: 0,
    },
    ...overrides,
  };
}

function makeScene(overrides: Partial<ShowcaseScenePlan> = {}): ShowcaseScenePlan {
  return {
    id: "showcase:scene:showcase-hero:0",
    type: "showcase-hero",
    headline: "Widget Platform governs widget operations",
    subheadline: undefined,
    narrativeRole: "context",
    density: "low",
    visualMetaphor: "hero",
    capabilityIds: [],
    claimIds: [],
    evidenceIds: [],
    qualifiers: [],
    ...overrides,
  };
}

function makeCleanPlan(overrides: Partial<ShowcasePlan> = {}): ShowcasePlan {
  const sceneTypesAndRoles: Array<[string, string]> = [
    ["showcase-hero", "context"],
    ["showcase-problem", "problem"],
    ["showcase-identity", "product-identity"],
    ["showcase-operating-model", "how-it-works"],
    ["showcase-value-pillars", "value-pillars"],
    ["showcase-capabilities", "proof"],
    ["showcase-closing", "closing"],
  ];
  const scenes = sceneTypesAndRoles.map(([type, role], i) =>
    makeScene({ id: `showcase:scene:${type}:${i}`, type: type as ShowcaseScenePlan["type"], narrativeRole: role, headline: `Distinct headline number ${i}` }),
  );
  return {
    schemaVersion: 1,
    identity: makeProductIdentity(),
    narrative: makeExecutiveNarrative(),
    scenes,
    metrics: [],
    evidenceSummary: { totalEvidence: 0, confirmedCount: 0, derivedCount: 0, runtimeUnverifiedCount: 0, approvedClaimCount: 0, qualifiedClaimCount: 0, rejectedClaimCount: 0, runtimeVerificationClaimCount: 0 },
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: 1,
      source_product_identity_generated_at: "2026-07-01T00:00:00.000Z",
      assist_used: false,
      audience: "executive",
      theme: "default",
      evidenceMode: "visible",
      sceneCount: scenes.length,
    },
    ...overrides,
  };
}

describe("validateProductIdentityModel", () => {
  it("returns no warnings for a clean model", () => {
    const model = makeIdentityModel();
    expect(validateProductIdentityModel(model, makeEmptyCapabilityModel())).toEqual([]);
  });

  it("PRODUCT_IDENTITY_WEAK_EVIDENCE (Tier 2, severity warning) fires when archetype is 'unknown'", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ archetype: "unknown" }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_WEAK_EVIDENCE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("PRODUCT_IDENTITY_GENERIC_MARKETING (Tier 1, severity error) fires for generic marketing language in descriptor/purpose/shortPromise", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ descriptor: "AI-Powered governance platform" }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_GENERIC_MARKETING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PRODUCT_IDENTITY_GENERIC_MARKETING also fires for absolute-superiority language in descriptor/purpose (same code as generic marketing in this implementation)", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ descriptor: "The only governance platform" }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_GENERIC_MARKETING" && x.message.includes("comparative"));
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("approved_terms suppresses PRODUCT_IDENTITY_GENERIC_MARKETING for a human-cleared term in descriptor/purpose/shortPromise", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ descriptor: "AI-Powered governance platform" }) });
    const override: ProductIdentityOverride = { schema_version: 1, approved_terms: ["ai-powered"] };
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel(), override);
    expect(warnings.find((x) => x.code === "PRODUCT_IDENTITY_GENERIC_MARKETING")).toBeUndefined();
  });

  it("approved_terms does not suppress an unapproved marketing term even when other terms are approved", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ descriptor: "AI-Powered governance platform" }) });
    const override: ProductIdentityOverride = { schema_version: 1, approved_terms: ["revolutionary"] };
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel(), override);
    expect(warnings.find((x) => x.code === "PRODUCT_IDENTITY_GENERIC_MARKETING")).toBeDefined();
  });

  it("PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM (Tier 1, severity error) fires when 'production-grade' is used without deployment/release/usage evidence", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ purpose: "A production-grade governance platform for compliance teams.", evidence: [] }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("does not fire PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM when deployment evidence is present", () => {
    const model = makeIdentityModel({
      identity: makeProductIdentity({
        purpose: "A production-grade governance platform for compliance teams.",
        evidence: [{ id: "prodintel:evidence:deployment:x:0", sourceType: "deployment", text: "Deployed to production.", confidence: "confirmed", strength: 3 }],
      }),
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM")).toBe(false);
  });

  it("SHOWCASE_ROADMAP_PROMOTED (Tier 1, severity error) fires when currentCapabilities includes a roadmap-only capability id", () => {
    const roadmapCap = makeCapability({ sourceLabel: "Widget Auto Remediation", inclusion: "roadmap_only" });
    const capModel = makeEmptyCapabilityModel({ roadmapCapabilities: [roadmapCap] });
    const model = makeIdentityModel({ identity: makeProductIdentity({ currentCapabilities: [roadmapCap.id] }) });
    const warnings = validateProductIdentityModel(model, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_ROADMAP_PROMOTED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.relatedId).toBe(roadmapCap.id);
  });

  it("SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED (Tier 1, severity error) fires when currentCapabilities includes an excluded candidate id", () => {
    const excluded = makeExcludedCandidate({ sourceLabel: "Widget Scratch Cli" });
    const capModel = makeEmptyCapabilityModel({ excludedCandidates: [excluded] });
    const model = makeIdentityModel({ identity: makeProductIdentity({ currentCapabilities: [excluded.id] }) });
    const warnings = validateProductIdentityModel(model, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("PRODUCT_IDENTITY_MISSING (Tier 2, severity warning) fires when a required identity field is blank", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ displayName: "" }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
    expect(w!.message).toContain("displayName");
  });

  it("PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES (Tier 2, severity warning) fires when the top two archetype scores tie with no overlapping evidence", () => {
    const model = makeIdentityModel({
      archetypeScores: [
        { archetype: "governance_platform", score: 3, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [capId("Policy Governance Console")] },
        { archetype: "developer_tool", score: 3, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [capId("Widget Sync Service")] },
      ],
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("does not fire PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES when the tied archetypes share matched capability evidence", () => {
    const shared = capId("Widget Sync Service");
    const model = makeIdentityModel({
      archetypeScores: [
        { archetype: "governance_platform", score: 3, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [shared] },
        { archetype: "developer_tool", score: 3, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [shared] },
      ],
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES")).toBe(false);
  });

  it("PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM (Tier 1, severity error) fires when 'enterprise-grade' is used without deployment/release/usage evidence", () => {
    const model = makeIdentityModel({ identity: makeProductIdentity({ purpose: "An enterprise-grade governance platform for compliance teams.", evidence: [] }) });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("does not fire PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM when deployment evidence is present", () => {
    const model = makeIdentityModel({
      identity: makeProductIdentity({
        purpose: "An enterprise-grade governance platform for compliance teams.",
        evidence: [{ id: "prodintel:evidence:deployment:x:0", sourceType: "deployment", text: "Deployed to production.", confidence: "confirmed", strength: 3 }],
      }),
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM")).toBe(false);
  });

  it("SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED (Tier 1, severity error) fires when currentCapabilities promotes a capability the capability model only qualifies", () => {
    const qualifiedCap = makeCapability({ sourceLabel: "Widget Report Export", inclusion: "include_with_qualification" });
    const capModel = makeEmptyCapabilityModel({ qualifiedCapabilities: [qualifiedCap] });
    const model = makeIdentityModel({ identity: makeProductIdentity({ currentCapabilities: [qualifiedCap.id] }) });
    const warnings = validateProductIdentityModel(model, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
    expect(w!.relatedId).toBe(qualifiedCap.id);
  });

  it("SHOWCASE_UNSUPPORTED_DIFFERENTIATOR (Tier 2, severity warning) fires when a differentiator has no supporting evidence", () => {
    const model = makeIdentityModel({
      identity: makeProductIdentity({
        differentiators: [{ id: "prodintel:differentiator:x", title: "Cross-cutting audit trail", description: "Spans every capability.", basis: ["cross_cutting_property"], supportingCapabilityIds: [], evidenceIds: [], confidence: "confirmed" }],
      }),
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_UNSUPPORTED_DIFFERENTIATOR");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("PRODUCT_IDENTITY_OVERRIDE_CONFLICT (Tier 1, severity error) fires when an override's disallowed_terms appear in evidence-derived identity content", () => {
    const model = makeIdentityModel({
      identity: makeProductIdentity({ valuePillars: [makeValuePillar({ title: "Legacy Widget Sync", explanation: "Synchronizes widgets on a schedule." })] }),
    });
    const override: ProductIdentityOverride = { schema_version: 1, disallowed_terms: ["legacy"] };
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel(), override);
    const w = warnings.find((x) => x.code === "PRODUCT_IDENTITY_OVERRIDE_CONFLICT");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("does not fire PRODUCT_IDENTITY_OVERRIDE_CONFLICT when no override is passed", () => {
    const model = makeIdentityModel({
      identity: makeProductIdentity({ valuePillars: [makeValuePillar({ title: "Legacy Widget Sync" })] }),
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "PRODUCT_IDENTITY_OVERRIDE_CONFLICT")).toBe(false);
  });

  it("SHOWCASE_NONDETERMINISTIC_ORDER (Tier 1, severity error) fires when model.candidates is not sorted by id", () => {
    const model = makeIdentityModel({
      candidates: [
        { id: "prodintel:candidate:zeta_platform" as never, displayName: "X", archetype: "governance_platform", purpose: "p", primaryUsers: [], valuePillars: [], differentiators: [], evidence: [], confidence: "confirmed", score: 1 },
        { id: "prodintel:candidate:alpha_platform" as never, displayName: "X", archetype: "developer_tool", purpose: "p", primaryUsers: [], valuePillars: [], differentiators: [], evidence: [], confidence: "confirmed", score: 1 },
      ],
    });
    const warnings = validateProductIdentityModel(model, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_NONDETERMINISTIC_ORDER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });
});

describe("validateShowcasePlan", () => {
  it("returns no warnings for a clean plan", () => {
    expect(validateShowcasePlan(makeCleanPlan(), makeEmptyCapabilityModel())).toEqual([]);
  });

  it("SHOWCASE_TOO_FEW_SCENES (Tier 2, severity warning) fires when scenes.length is below SHOWCASE_MIN_SCENES", () => {
    const plan = makeCleanPlan({ scenes: [makeScene()] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_TOO_FEW_SCENES");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_TOO_MANY_SCENES (Tier 2, severity warning) fires when scenes.length is above SHOWCASE_MAX_SCENES", () => {
    const scenes = Array.from({ length: 11 }, (_, i) => makeScene({ id: `showcase:scene:showcase-hero:${i}`, headline: `Distinct headline number ${i}`, narrativeRole: `role-${i}` }));
    const plan = makeCleanPlan({ scenes });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_TOO_MANY_SCENES");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_MISSING_CENTRAL_MESSAGE (Tier 1, severity error) fires when the narrative's central message is blank", () => {
    const plan = makeCleanPlan({ narrative: makeExecutiveNarrative({ centralMessage: "   " }) });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_MISSING_CENTRAL_MESSAGE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_HEADLINE_TOO_LONG (Tier 1, severity error) fires when a scene headline exceeds the 14-word hard maximum", () => {
    const longHeadline = Array.from({ length: 16 }, (_, i) => `word${i}`).join(" ");
    const plan = makeCleanPlan({ scenes: [makeScene({ headline: longHeadline })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_HEADLINE_TOO_LONG");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_GENERIC_HEADLINE (Tier 1, severity error) fires when a scene headline is a generic slide label", () => {
    const plan = makeCleanPlan({ scenes: [makeScene({ headline: "Overview" })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_GENERIC_HEADLINE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM (Tier 1, severity error) fires when a scene references a qualified capability without acknowledging it in headline or qualifiers", () => {
    const qualifiedCapId = capId("Widget Report Export");
    const plan = makeCleanPlan({
      identity: makeProductIdentity({ qualifiedCapabilities: [qualifiedCapId] }),
      scenes: [makeScene({ capabilityIds: [qualifiedCapId], headline: "Widget capabilities", qualifiers: [] })],
    });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("does not fire SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM when a qualifier mentions the qualification", () => {
    const qualifiedCapId = capId("Widget Report Export");
    const plan = makeCleanPlan({
      identity: makeProductIdentity({ qualifiedCapabilities: [qualifiedCapId] }),
      scenes: [makeScene({ capabilityIds: [qualifiedCapId], headline: "Widget capabilities", qualifiers: ["This capability carries a qualified evidence status."] })],
    });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM")).toBe(false);
  });

  it("SHOWCASE_HEADLINE_ROADMAP_PROMOTED (Tier 1, severity error) fires when a scene references a roadmap-only capability", () => {
    const roadmapCap = makeCapability({ sourceLabel: "Widget Auto Remediation", inclusion: "roadmap_only" });
    const capModel = makeEmptyCapabilityModel({ roadmapCapabilities: [roadmapCap] });
    const plan = makeCleanPlan({ scenes: [makeScene({ capabilityIds: [roadmapCap.id] })] });
    const warnings = validateShowcasePlan(plan, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_HEADLINE_ROADMAP_PROMOTED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED (Tier 1, severity error) fires when a scene references an excluded candidate", () => {
    const excluded = makeExcludedCandidate({ sourceLabel: "Widget Scratch Cli" });
    const capModel = makeEmptyCapabilityModel({ excludedCandidates: [excluded] });
    const plan = makeCleanPlan({ scenes: [makeScene({ capabilityIds: [excluded.id] })] });
    const warnings = validateShowcasePlan(plan, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_SCENE_WORD_BUDGET_EXCEEDED (Tier 2, severity warning) fires when headline+subheadline together exceed the 30-word low-density budget", () => {
    const headline = Array.from({ length: 14 }, (_, i) => `h${i}`).join(" ");
    const subheadline = Array.from({ length: 18 }, (_, i) => `s${i}`).join(" ");
    const plan = makeCleanPlan({ scenes: [makeScene({ headline, subheadline })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_SCENE_WORD_BUDGET_EXCEEDED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_DUPLICATE_SCENE_PURPOSE (Tier 2, severity warning) fires when two scenes share the same narrativeRole and headline", () => {
    const plan = makeCleanPlan({
      scenes: [makeScene({ id: "a", narrativeRole: "context", headline: "Same headline" }), makeScene({ id: "b", narrativeRole: "context", headline: "Same headline" })],
    });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_DUPLICATE_SCENE_PURPOSE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_NONDETERMINISTIC_ORDER (Tier 1, severity error) fires when a scene's capabilityIds are not sorted", () => {
    const plan = makeCleanPlan({ scenes: [makeScene({ capabilityIds: ["capintel:capability:zzz", "capintel:capability:aaa"] })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_NONDETERMINISTIC_ORDER");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED (Tier 2, severity warning) fires when a scene headline is phrased as a question", () => {
    const plan = makeCleanPlan({ scenes: [makeScene({ headline: "What does Widget Platform do?" })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_SCENE_TOO_DENSE (Tier 2, severity warning) fires when a low-density scene's combined id count exceeds the density budget", () => {
    const manyIds = Array.from({ length: 16 }, (_, i) => `capintel:capability:cap-${i}`);
    const plan = makeCleanPlan({ scenes: [makeScene({ capabilityIds: manyIds, density: "low" })] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_SCENE_TOO_DENSE");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_RUNTIME_CLAIM_UNVERIFIED (Tier 2, severity warning) fires when a scene references a runtime-verification-required claim without a disclosing qualifier", () => {
    const runtimeClaim = makeProductClaim({ id: "prodintel:claim:scale:override-scale", claimType: "scale", status: "runtime_verification_required" });
    const plan = makeCleanPlan({
      narrative: makeExecutiveNarrative({ runtimeVerificationClaims: [runtimeClaim] }),
      scenes: [makeScene({ claimIds: [runtimeClaim.id], qualifiers: [] })],
    });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_RUNTIME_CLAIM_UNVERIFIED");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("does not fire SHOWCASE_RUNTIME_CLAIM_UNVERIFIED when the scene's qualifiers disclose the unverified status", () => {
    const runtimeClaim = makeProductClaim({ id: "prodintel:claim:scale:override-scale", claimType: "scale", status: "runtime_verification_required" });
    const plan = makeCleanPlan({
      narrative: makeExecutiveNarrative({ runtimeVerificationClaims: [runtimeClaim] }),
      scenes: [makeScene({ claimIds: [runtimeClaim.id], qualifiers: ["Pending runtime verification."] })],
    });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "SHOWCASE_RUNTIME_CLAIM_UNVERIFIED")).toBe(false);
  });

  it("SHOWCASE_UNSUPPORTED_METRIC (Tier 2, severity warning) fires when a metric carries no resolvable evidence", () => {
    const plan = makeCleanPlan({ metrics: [{ id: "prodintel:metric:x", label: "Capabilities shipped", value: "3", status: "confirmed", evidenceIds: [], audiencePriority: 0 }] });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_UNSUPPORTED_METRIC");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY (Tier 1, severity error) fires when a metric's evidence traces back to a roadmap capability", () => {
    const roadmapCap = makeCapability({ sourceLabel: "Widget Auto Remediation", inclusion: "roadmap_only" });
    const capModel = makeEmptyCapabilityModel({ roadmapCapabilities: [roadmapCap] });
    const evidence = { id: "prodintel:evidence:capability:x:0", sourceType: "capability" as const, sourceId: roadmapCap.id, text: "Planned remediation.", confidence: "derived" as const, strength: 1 };
    const plan = makeCleanPlan({
      identity: makeProductIdentity({ evidence: [evidence] }),
      metrics: [{ id: "prodintel:metric:x", label: "Capabilities shipped", value: "3", status: "confirmed", evidenceIds: [evidence.id], audiencePriority: 0 }],
    });
    const warnings = validateShowcasePlan(plan, capModel);
    const w = warnings.find((x) => x.code === "SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("error");
  });

  it("SHOWCASE_EVIDENCE_MISSING (Tier 2, severity warning) fires when a rejected claim in narrative.rejectedClaims has no rejection reason codes", () => {
    const rejectedClaim = makeProductClaim({ id: "prodintel:claim:purpose:purpose", status: "rejected", rejectionReasons: [] });
    const plan = makeCleanPlan({ narrative: makeExecutiveNarrative({ rejectedClaims: [rejectedClaim] }) });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    const w = warnings.find((x) => x.code === "SHOWCASE_EVIDENCE_MISSING");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  it("does not fire SHOWCASE_EVIDENCE_MISSING when the rejected claim has rejection reasons recorded", () => {
    const rejectedClaim = makeProductClaim({ id: "prodintel:claim:purpose:purpose", status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_GENERIC_MARKETING"] });
    const plan = makeCleanPlan({ narrative: makeExecutiveNarrative({ rejectedClaims: [rejectedClaim] }) });
    const warnings = validateShowcasePlan(plan, makeEmptyCapabilityModel());
    expect(warnings.some((x) => x.code === "SHOWCASE_EVIDENCE_MISSING")).toBe(false);
  });
});
