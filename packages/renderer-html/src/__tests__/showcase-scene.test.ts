import type {
  Capability,
  CapabilityGenerationMetadata,
  CapabilityModel,
  CapabilityReadiness,
} from "@rvs/capability-intelligence";
import { CAPABILITY_INTELLIGENCE_SCHEMA_VERSION, DEFAULT_CAPABILITY_READINESS_THRESHOLDS, DEFAULT_CAPABILITY_READINESS_WEIGHTS } from "@rvs/capability-intelligence";
import type {
  ExecutiveNarrative,
  ProductClaim,
  ProductIdentity,
  ProductIdentityEvidence,
  ProductValuePillar,
  ShowcaseDensity,
  ShowcasePlan,
  ShowcaseScenePlan,
  ShowcaseSceneType,
  ShowcaseVisualMetaphor,
} from "@rvs/product-intelligence";
import type { ShowcaseScene } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { renderShowcaseScene } from "../scenes/showcase/index.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built fixtures — mirror the shapes exercised by
// packages/product-intelligence/src/__tests__/fixtures.ts, but kept local
// here since renderer-html cannot import another package's __tests__ dir.
// ---------------------------------------------------------------------------

function makeReadiness(overrides: Partial<CapabilityReadiness> = {}): CapabilityReadiness {
  return { score: 80, implementationScore: 80, executionScore: 80, verificationScore: 80, documentationScore: 80, adoptionScore: 80, blockers: [], qualifiers: [], ...overrides };
}

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "capintel:capability:widget-sync-service",
    displayName: "Widget Sync Service",
    shortDescription: "Syncs widgets",
    purpose: "Synchronizes widgets across environments.",
    domainId: "capintel:domain:widget-operations",
    status: "implemented",
    confidence: "confirmed",
    inclusion: "include",
    readiness: makeReadiness(),
    actors: [],
    workflows: [],
    logicalComponents: [],
    externalSystems: [],
    evidence: [],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: "Widget Sync Service", basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

function makeCapabilityModel(overrides: Partial<CapabilityModel> = {}): CapabilityModel {
  const generationMetadata: CapabilityGenerationMetadata = {
    generated_at: "2026-07-01T00:00:00.000Z",
    git_commit: "abc1234",
    schema_version: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    source_architecture_intelligence_generated_at: "2026-07-01T00:00:00.000Z",
    assist_used: false,
    readinessThresholds: DEFAULT_CAPABILITY_READINESS_THRESHOLDS,
    readinessWeights: DEFAULT_CAPABILITY_READINESS_WEIGHTS,
    candidateCount: 0,
  };
  return {
    schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION,
    systemIdentity: { displayName: "Widget Platform" },
    domains: [],
    includedCapabilities: [],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    evidenceSummary: {
      totalCandidates: 0,
      includedCount: 0,
      qualifiedCount: 0,
      excludedCount: 0,
      roadmapCount: 0,
      gapCount: 0,
      unresolvedCount: 0,
      evidenceTypeCounts: {},
      confidence: { confirmed: 0, derived: 0, suggested: 0, unresolved: 0, total: 0 },
    },
    generationMetadata,
    ...overrides,
  };
}

function makeProductIdentityEvidence(overrides: Partial<ProductIdentityEvidence> = {}): ProductIdentityEvidence {
  return { id: "prodintel:evidence:capability:widget-sync-service:0", sourceType: "capability", sourceId: "capintel:capability:widget-sync-service", text: "Syncs widgets.", confidence: "confirmed", strength: 4, ...overrides };
}

function makeValuePillar(overrides: Partial<ProductValuePillar> = {}): ProductValuePillar {
  return {
    id: "prodintel:pillar:widget-operations",
    title: "Widget Operations",
    explanation: "Synchronizes and reports on widget state across environments.",
    includedCapabilityIds: ["capintel:capability:widget-sync-service"],
    qualifiedCapabilityIds: [],
    evidenceIds: [makeProductIdentityEvidence().id],
    confidence: "confirmed",
    ...overrides,
  };
}

function makeProductIdentity(overrides: Partial<ProductIdentity> = {}): ProductIdentity {
  return {
    displayName: "Widget Platform",
    descriptor: "Governance and compliance platform",
    shortPromise: "Widget Platform governs and reports on widget operations for compliance teams",
    archetype: "governance_platform",
    secondaryArchetypes: [],
    purpose: "Teams lack a governed way to operate widgets.",
    primaryUsers: ["Compliance Officer"],
    secondaryUsers: [],
    valuePillars: [makeValuePillar()],
    differentiators: [{ id: "prodintel:differentiator:shared-core", title: "Unified governance core", description: "A single shared component backs governance and sync capabilities.", basis: ["multi_capability_support"], supportingCapabilityIds: ["capintel:capability:widget-sync-service"], evidenceIds: [], confidence: "confirmed" }],
    currentCapabilities: ["capintel:capability:widget-sync-service"],
    qualifiedCapabilities: [],
    limitations: [],
    evidence: [makeProductIdentityEvidence()],
    confidence: "confirmed",
    overrideApplied: false,
    ...overrides,
  };
}

function makeProductClaim(overrides: Partial<ProductClaim> = {}): ProductClaim {
  return { id: "prodintel:claim:identity:identity", text: "Widget Platform is a governance platform.", claimType: "identity", status: "approved", evidenceIds: [], qualifiers: [], rejectionReasons: [], ...overrides };
}

function makeExecutiveNarrative(overrides: Partial<ExecutiveNarrative> = {}): ExecutiveNarrative {
  return {
    audience: "executive",
    objective: "Give executive stakeholders a concise, evidence-backed view of Widget Platform.",
    centralMessage: "Widget Platform governs and reports on widget operations for compliance teams",
    problemStatement: "Teams lack a governed way to operate widgets",
    productPromise: "Widget Platform governs and reports on widget operations for compliance teams",
    valuePillars: [makeValuePillar()],
    proofPoints: [],
    differentiators: [],
    limitations: [],
    closingMessage: "Widget Platform is presented here strictly by what is currently proven.",
    approvedClaims: [makeProductClaim()],
    rejectedClaims: [],
    runtimeVerificationClaims: [],
    ...overrides,
  };
}

function makeScenePlan(type: ShowcaseSceneType, overrides: Partial<ShowcaseScenePlan> = {}): ShowcaseScenePlan {
  const visualMetaphorByType: Record<ShowcaseSceneType, ShowcaseVisualMetaphor> = {
    "showcase-hero": "hero",
    "showcase-problem": "causal-flow",
    "showcase-identity": "north-star",
    "showcase-operating-model": "layered-architecture",
    "showcase-value-pillars": "pillar-grid",
    "showcase-capabilities": "capability-map",
    "showcase-differentiators": "comparison-matrix",
    "showcase-proof": "proof-cards",
    "showcase-limitations": "constellation",
    "showcase-closing": "hero",
    "portfolio-overview": "journey",
  };
  const density: ShowcaseDensity = "low";
  return {
    id: `showcase:scene:${type}:0`,
    type,
    headline: "Widget Platform governs widget operations",
    subheadline: undefined,
    narrativeRole: "context",
    density,
    visualMetaphor: visualMetaphorByType[type],
    capabilityIds: [],
    claimIds: [],
    evidenceIds: [],
    qualifiers: [],
    ...overrides,
  };
}

function makePlan(scenes: ShowcaseScenePlan[], overrides: Partial<ShowcasePlan> = {}): ShowcasePlan {
  return {
    schemaVersion: 1,
    identity: makeProductIdentity(),
    narrative: makeExecutiveNarrative(),
    scenes,
    metrics: [{ id: "prodintel:metric:widget-sync-service:0", label: "Widget Sync Uptime", value: "99.9%", status: "confirmed", evidenceIds: [], audiencePriority: 0 }],
    evidenceSummary: { totalEvidence: 1, confirmedCount: 1, derivedCount: 0, runtimeUnverifiedCount: 0, approvedClaimCount: 1, qualifiedClaimCount: 0, rejectedClaimCount: 0, runtimeVerificationClaimCount: 0 },
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

function pointerScene(scenePlanId: string, planId: string): ShowcaseScene {
  return { id: `visualdoc:scene:${scenePlanId}`, type: "showcase-scene", headline: "unused-pointer-headline", evidence: [], plan_id: planId, scene_id: scenePlanId };
}

const ALL_SCENE_TYPES: ShowcaseSceneType[] = [
  "showcase-hero",
  "showcase-problem",
  "showcase-identity",
  "showcase-operating-model",
  "showcase-value-pillars",
  "showcase-capabilities",
  "showcase-differentiators",
  "showcase-proof",
  "showcase-limitations",
  "showcase-closing",
  "portfolio-overview",
];

describe("renderShowcaseScene", () => {
  it("throws when the plan is undefined (unresolved plan_id)", () => {
    const scenePlan = makeScenePlan("showcase-hero");
    const scene = pointerScene(scenePlan.id, "Widget Platform");
    expect(() => renderShowcaseScene(scene, undefined, undefined)).toThrow(/unresolved plan_id/);
  });

  it("throws when the plan is resolved but the scene_id has no matching ShowcaseScenePlan", () => {
    const scenePlan = makeScenePlan("showcase-hero");
    const plan = makePlan([scenePlan]);
    const scene = pointerScene("showcase:scene:does-not-exist:0", "Widget Platform");
    expect(() => renderShowcaseScene(scene, plan, undefined)).toThrow(/unresolved scene_id/);
  });

  it.each(ALL_SCENE_TYPES)("renders scene type %s without throwing, wrapping it with the correct visual-metaphor and narrative-role data attributes", (type) => {
    const scenePlan = makeScenePlan(type, { narrativeRole: "proof", capabilityIds: type === "showcase-capabilities" ? ["capintel:capability:widget-sync-service"] : [] });
    const plan = makePlan([scenePlan]);
    const model = makeCapabilityModel({ includedCapabilities: [makeCapability()] });
    const scene = pointerScene(scenePlan.id, "Widget Platform");

    const html = renderShowcaseScene(scene, plan, model);
    expect(html).toContain(`data-visual-metaphor="${scenePlan.visualMetaphor}"`);
    expect(html).toContain(`data-narrative-role="proof"`);
    expect(html).toContain("Widget Platform governs widget operations");
  });

  it("renders the showcase-capabilities scene with capability display names resolved from the CapabilityModel, and a 'Qualified' badge for qualified capabilities", () => {
    const scenePlan = makeScenePlan("showcase-capabilities", { capabilityIds: ["capintel:capability:widget-sync-service", "capintel:capability:widget-report-export"] });
    const identity = makeProductIdentity({ qualifiedCapabilities: ["capintel:capability:widget-report-export"] });
    const plan = makePlan([scenePlan], { identity });
    const model = makeCapabilityModel({
      includedCapabilities: [makeCapability()],
      qualifiedCapabilities: [makeCapability({ id: "capintel:capability:widget-report-export", displayName: "Widget Report Export" })],
    });
    const scene = pointerScene(scenePlan.id, "Widget Platform");

    const html = renderShowcaseScene(scene, plan, model);
    expect(html).toContain("Widget Sync Service");
    expect(html).toContain("Widget Report Export");
    expect(html).toContain("showcase-chip-qualified");
    expect(html).toContain("Qualified");
  });

  it("falls back to the raw capability id when the CapabilityModel is undefined", () => {
    const scenePlan = makeScenePlan("showcase-capabilities", { capabilityIds: ["capintel:capability:widget-sync-service"] });
    const plan = makePlan([scenePlan]);
    const scene = pointerScene(scenePlan.id, "Widget Platform");

    const html = renderShowcaseScene(scene, plan, undefined);
    expect(html).toContain("capintel:capability:widget-sync-service");
  });

  it("renders the showcase-value-pillars scene with one card per identity.valuePillars entry, including the qualification note when present", () => {
    const scenePlan = makeScenePlan("showcase-value-pillars");
    const identity = makeProductIdentity({ valuePillars: [makeValuePillar({ qualification: "1 of 2 capabilities in this pillar carry evidence qualifiers." })] });
    const plan = makePlan([scenePlan], { identity });
    const scene = pointerScene(scenePlan.id, "Widget Platform");

    const html = renderShowcaseScene(scene, plan, undefined);
    expect(html).toContain("showcase-pillar-card");
    expect(html).toContain("1 of 2 capabilities in this pillar carry evidence qualifiers.");
  });

  it("renders the showcase-differentiators scene from identity.differentiators, and the showcase-proof scene from plan.metrics", () => {
    const diffScenePlan = makeScenePlan("showcase-differentiators");
    const proofScenePlan = makeScenePlan("showcase-proof");
    const plan = makePlan([diffScenePlan, proofScenePlan]);

    const diffHtml = renderShowcaseScene(pointerScene(diffScenePlan.id, "Widget Platform"), plan, undefined);
    expect(diffHtml).toContain("Unified governance core");

    const proofHtml = renderShowcaseScene(pointerScene(proofScenePlan.id, "Widget Platform"), plan, undefined);
    expect(proofHtml).toContain("99.9%");
    expect(proofHtml).toContain("Widget Sync Uptime");
  });

  it("renders 'No confirmed proof points are available yet.' when plan.metrics is empty", () => {
    const scenePlan = makeScenePlan("showcase-proof");
    const plan = makePlan([scenePlan], { metrics: [] });
    const html = renderShowcaseScene(pointerScene(scenePlan.id, "Widget Platform"), plan, undefined);
    expect(html).toContain("No confirmed proof points are available yet.");
  });

  it("renders 'No qualifications were recorded.' on a showcase-limitations scene with no qualifiers, and the qualifier text when present", () => {
    const emptyScenePlan = makeScenePlan("showcase-limitations", { qualifiers: [] });
    const planEmpty = makePlan([emptyScenePlan]);
    const htmlEmpty = renderShowcaseScene(pointerScene(emptyScenePlan.id, "Widget Platform"), planEmpty, undefined);
    expect(htmlEmpty).toContain("No qualifications were recorded.");

    const filledScenePlan = makeScenePlan("showcase-limitations", { qualifiers: ["Multi-region replication is not yet supported."] });
    const planFilled = makePlan([filledScenePlan]);
    const htmlFilled = renderShowcaseScene(pointerScene(filledScenePlan.id, "Widget Platform"), planFilled, undefined);
    expect(htmlFilled).toContain("Multi-region replication is not yet supported.");
  });

  it("HTML-escapes a headline containing markup-significant characters on every scene type", () => {
    const scenePlan = makeScenePlan("showcase-hero", { headline: `<script>alert("x")</script> & 'friends'` });
    const plan = makePlan([scenePlan]);
    const html = renderShowcaseScene(pointerScene(scenePlan.id, "Widget Platform"), plan, undefined);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;");
  });

  it("HTML-escapes a subheadline on scenes that render one (e.g. showcase-hero)", () => {
    const scenePlan = makeScenePlan("showcase-hero", { subheadline: `Governs & audits <widgets>` });
    const plan = makePlan([scenePlan]);
    const html = renderShowcaseScene(pointerScene(scenePlan.id, "Widget Platform"), plan, undefined);
    expect(html).toContain("Governs &amp; audits &lt;widgets&gt;");
    expect(html).not.toContain("<widgets>");
  });

  it("HTML-escapes qualifier text rendered as a note (showcase-capabilities scene qualifiersBlock)", () => {
    const scenePlan = makeScenePlan("showcase-capabilities", { qualifiers: [`Contains <b>unverified</b> claims & "caveats"`] });
    const plan = makePlan([scenePlan]);
    const html = renderShowcaseScene(pointerScene(scenePlan.id, "Widget Platform"), plan, undefined);
    expect(html).toContain("Contains &lt;b&gt;unverified&lt;/b&gt; claims &amp; &quot;caveats&quot;");
    expect(html).not.toContain("<b>unverified</b>");
  });

  it("HTML-escapes value-pillar titles and explanations", () => {
    const scenePlan = makeScenePlan("showcase-value-pillars");
    const identity = makeProductIdentity({ valuePillars: [makeValuePillar({ title: `<Ops> & "Governance"`, explanation: `Handles <script> & special chars` })] });
    const plan = makePlan([scenePlan], { identity });
    const html = renderShowcaseScene(pointerScene(scenePlan.id, "Widget Platform"), plan, undefined);
    expect(html).toContain("&lt;Ops&gt; &amp; &quot;Governance&quot;");
    expect(html).toContain("Handles &lt;script&gt; &amp; special chars");
    expect(html).not.toContain("<script>");
  });
});
