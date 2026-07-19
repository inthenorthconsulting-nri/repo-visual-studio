import type { ExecutiveNarrative, ProductClaim, ProductIdentity, ProductIdentityEvidence, ProductValuePillar, ShowcasePlan, ShowcaseScenePlan, ShowcaseSceneType } from "@rvs/product-intelligence";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { buildShowcaseVisualDoc, buildShowcaseVisualDocScenes } from "../showcase-visualdoc-builder.js";

// ---------------------------------------------------------------------------
// Minimal, hand-built ShowcasePlan fixture — this builder only ever reads
// plan.identity.displayName, plan.generationMetadata.{audience,theme}, and
// plan.scenes[].{id,headline}, so the rest of the shape is filled in with
// structurally-valid placeholders.
// ---------------------------------------------------------------------------

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
    differentiators: [],
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

function makeScenePlan(type: ShowcaseSceneType, id: string, headline: string): ShowcaseScenePlan {
  return {
    id,
    type,
    headline,
    subheadline: undefined,
    narrativeRole: "context",
    density: "low",
    visualMetaphor: "hero",
    capabilityIds: [],
    claimIds: [],
    evidenceIds: [],
    qualifiers: [],
  };
}

function makePlan(scenes: ShowcaseScenePlan[], overrides: Partial<ShowcasePlan> = {}): ShowcasePlan {
  return {
    schemaVersion: 1,
    identity: makeProductIdentity(),
    narrative: makeExecutiveNarrative(),
    scenes,
    metrics: [],
    evidenceSummary: { totalEvidence: 1, confirmedCount: 1, derivedCount: 0, runtimeUnverifiedCount: 0, approvedClaimCount: 1, qualifiedClaimCount: 0, rejectedClaimCount: 0, runtimeVerificationClaimCount: 0 },
    generationMetadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: 1,
      source_product_identity_generated_at: "2026-07-01T00:00:00.000Z",
      assist_used: false,
      audience: "executive",
      theme: "executive-dark",
      evidenceMode: "visible",
      sceneCount: scenes.length,
    },
    ...overrides,
  };
}

describe("buildShowcaseVisualDocScenes", () => {
  it("emits one showcase-scene pointer per ShowcaseScenePlan, in the plan's own (narrative-significant) order — never re-sorted", () => {
    const scenes = [
      makeScenePlan("showcase-closing", "showcase:scene:showcase-closing:0", "Widget Platform is proven, not promised"),
      makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "Widget Platform governs widget operations"),
    ];
    const plan = makePlan(scenes);
    const result = buildShowcaseVisualDocScenes(plan);
    expect(result.map((s) => s.id)).toEqual(["showcase:scene:showcase-closing:0", "showcase:scene:showcase-hero:0"]);
  });

  it("builds each pointer scene with type='showcase-scene', the ShowcaseScenePlan's own id/headline, empty evidence, plan_id=identity.displayName, and scene_id=scene.id", () => {
    const scenePlan = makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "Widget Platform governs widget operations");
    const plan = makePlan([scenePlan], { identity: makeProductIdentity({ displayName: "Widget Platform" }) });
    const [scene] = buildShowcaseVisualDocScenes(plan);
    expect(scene).toEqual({
      id: "showcase:scene:showcase-hero:0",
      type: "showcase-scene",
      headline: "Widget Platform governs widget operations",
      evidence: [],
      plan_id: "Widget Platform",
      scene_id: "showcase:scene:showcase-hero:0",
    });
  });

  it("uses identity.displayName as plan_id — the same stable-key convention as CapabilityModel's model_id", () => {
    const scenePlan = makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "headline");
    const plan = makePlan([scenePlan], { identity: makeProductIdentity({ displayName: "Governed Widget Suite" }) });
    const [scene] = buildShowcaseVisualDocScenes(plan);
    expect(scene.type === "showcase-scene" ? scene.plan_id : undefined).toBe("Governed Widget Suite");
  });

  it("returns an empty array for a plan with no scenes", () => {
    const plan = makePlan([]);
    expect(buildShowcaseVisualDocScenes(plan)).toEqual([]);
  });
});

describe("buildShowcaseVisualDoc", () => {
  it("produces a schema-valid VisualDoc", () => {
    const scenes = [
      makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "Widget Platform governs widget operations"),
      makeScenePlan("showcase-closing", "showcase:scene:showcase-closing:0", "Widget Platform is proven, not promised"),
    ];
    const plan = makePlan(scenes);
    const doc = buildShowcaseVisualDoc(plan);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
  });

  it("titles the document '<displayName> — Executive Showcase' and sources audience/theme from generationMetadata", () => {
    const plan = makePlan([makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "headline")], {
      identity: makeProductIdentity({ displayName: "Widget Governance Suite" }),
      generationMetadata: {
        generated_at: "2026-07-01T00:00:00.000Z",
        git_commit: "abc1234",
        schema_version: 1,
        source_product_identity_generated_at: "2026-07-01T00:00:00.000Z",
        assist_used: false,
        audience: "product_leader",
        theme: "executive-light",
        evidenceMode: "concise",
        sceneCount: 1,
      },
    });
    const doc = buildShowcaseVisualDoc(plan);
    expect(doc.document.title).toBe("Widget Governance Suite — Executive Showcase");
    expect(doc.document.audience).toBe("product_leader");
    expect(doc.document.theme).toBe("executive-light");
    expect(doc.document.aspect_ratio).toBe("16:9");
    expect(doc.version).toBe(1);
  });

  it("is a complete, self-ordered presentation on its own — every scene is a showcase-scene pointer, matching plan.scenes 1:1", () => {
    const scenes = [
      makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "hero"),
      makeScenePlan("showcase-problem", "showcase:scene:showcase-problem:0", "problem"),
      makeScenePlan("showcase-closing", "showcase:scene:showcase-closing:0", "closing"),
    ];
    const plan = makePlan(scenes);
    const doc = buildShowcaseVisualDoc(plan);
    expect(doc.scenes).toHaveLength(3);
    expect(doc.scenes.every((s) => s.type === "showcase-scene")).toBe(true);
  });

  it("is deterministic: two builds of the same plan produce identical output", () => {
    const scenes = [makeScenePlan("showcase-hero", "showcase:scene:showcase-hero:0", "headline")];
    const plan = makePlan(scenes);
    const a = buildShowcaseVisualDoc(plan);
    const b = buildShowcaseVisualDoc(plan);
    expect(a).toEqual(b);
  });
});
