import { describe, expect, it } from "vitest";
import type { ProductDifferentiator, ProductProofPoint } from "../contracts.js";
import { buildShowcasePlan, headlineWordCount, SHOWCASE_MAX_SCENES, SHOWCASE_MIN_SCENES } from "../showcase-plan.js";
import { makeEmptyCapabilityModel, makeExecutiveNarrative, makeProductClaim, makeProductIdentity, makeValuePillar } from "./fixtures.js";

const OPTIONS = { audience: "executive" as const, theme: "default", evidenceMode: "visible" as const, gitCommit: "abc1234", generatedAt: "2026-07-01T00:00:00.000Z" };

function proofPoint(overrides: Partial<ProductProofPoint> = {}): ProductProofPoint {
  return { id: "prodintel:proof:x", label: "outcome", value: "Outcome text", status: "confirmed", evidenceIds: ["prodintel:evidence:capability:x:0"], ...overrides };
}

function differentiator(overrides: Partial<ProductDifferentiator> = {}): ProductDifferentiator {
  return { id: "prodintel:differentiator:x", title: "Shared platform core", description: "Used by 3 capabilities.", basis: ["multi_capability_support"], supportingCapabilityIds: [], evidenceIds: ["prodintel:evidence:capability:x:0"], confidence: "confirmed", ...overrides };
}

describe("SHOWCASE_MIN_SCENES / SHOWCASE_MAX_SCENES", () => {
  it("are 7 and 10 respectively", () => {
    expect(SHOWCASE_MIN_SCENES).toBe(7);
    expect(SHOWCASE_MAX_SCENES).toBe(10);
  });
});

describe("buildShowcasePlan scene selection", () => {
  it("produces the 8 base-sequence scenes when differentiators are present but neither the proof nor limitations bar is cleared", () => {
    const identity = makeProductIdentity({ differentiators: [differentiator()] });
    const narrative = makeExecutiveNarrative({ proofPoints: [], limitations: [] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes.map((s) => s.type)).toEqual([
      "showcase-hero",
      "showcase-problem",
      "showcase-identity",
      "showcase-operating-model",
      "showcase-value-pillars",
      "showcase-capabilities",
      "showcase-differentiators",
      "showcase-closing",
    ]);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(SHOWCASE_MIN_SCENES);
  });

  it("skips showcase-differentiators entirely when identity.differentiators is empty", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({ proofPoints: [], limitations: [] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes.some((s) => s.type === "showcase-differentiators")).toBe(false);
  });

  it("also skips showcase-limitations when differentiators is empty, even though narrative.limitations is non-empty — the limitations-scene check is nested inside the differentiators iteration and is short-circuited by the same 'continue'", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({ proofPoints: [], limitations: ["Some capabilities are only partially evidenced."] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes.some((s) => s.type === "showcase-limitations")).toBe(false);
  });

  it("inserts showcase-limitations immediately after showcase-differentiators once both differentiators and narrative.limitations are non-empty", () => {
    const identity = makeProductIdentity({ differentiators: [differentiator()] });
    const narrative = makeExecutiveNarrative({ proofPoints: [], limitations: ["Some capabilities are only partially evidenced."] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    const types = plan.scenes.map((s) => s.type);
    const diffIndex = types.indexOf("showcase-differentiators");
    expect(diffIndex).toBeGreaterThanOrEqual(0);
    expect(types[diffIndex + 1]).toBe("showcase-limitations");
  });

  it("inserts showcase-proof immediately after showcase-capabilities once 3+ proof points are confirmed or derived", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({
      proofPoints: [proofPoint({ id: "a", status: "confirmed" }), proofPoint({ id: "b", status: "derived" }), proofPoint({ id: "c", status: "confirmed" })],
      limitations: [],
    });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    const types = plan.scenes.map((s) => s.type);
    const capIndex = types.indexOf("showcase-capabilities");
    expect(types[capIndex + 1]).toBe("showcase-proof");
  });

  it("does not insert showcase-proof when fewer than 3 proof points are confirmed/derived (2 is not enough)", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({ proofPoints: [proofPoint({ id: "a" }), proofPoint({ id: "b" })], limitations: [] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes.some((s) => s.type === "showcase-proof")).toBe(false);
  });

  it("does not count runtime_unverified or rejected proof points toward the 3-proof-point bar", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({
      proofPoints: [proofPoint({ id: "a", status: "confirmed" }), proofPoint({ id: "b", status: "runtime_unverified" }), proofPoint({ id: "c", status: "rejected" })],
      limitations: [],
    });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes.some((s) => s.type === "showcase-proof")).toBe(false);
  });

  it("reaches exactly SHOWCASE_MAX_SCENES (10) when differentiators, limitations, and 3+ strong proof points are all present, never exceeding it", () => {
    const identity = makeProductIdentity({ differentiators: [differentiator()] });
    const narrative = makeExecutiveNarrative({
      proofPoints: [proofPoint({ id: "a" }), proofPoint({ id: "b" }), proofPoint({ id: "c" })],
      limitations: ["Some capabilities are only partially evidenced."],
    });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.scenes).toHaveLength(SHOWCASE_MAX_SCENES);
  });
});

describe("buildShowcasePlan scene content", () => {
  it("builds showcase-hero from identity.shortPromise/descriptor and links approved identity claims", () => {
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative();
    const identityClaim = makeProductClaim({ id: "prodintel:claim:identity:identity", claimType: "identity", status: "approved" });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [identityClaim], OPTIONS);
    const hero = plan.scenes.find((s) => s.type === "showcase-hero")!;
    expect(hero.headline).toBe(identity.shortPromise);
    expect(hero.subheadline).toBe(identity.descriptor);
    expect(hero.claimIds).toEqual([identityClaim.id]);
  });

  it("truncates a headline longer than 14 words to exactly 14 words", () => {
    const identity = makeProductIdentity({ shortPromise: Array.from({ length: 20 }, (_, i) => `word${i}`).join(" "), differentiators: [] });
    const plan = buildShowcasePlan(identity, makeExecutiveNarrative(), makeEmptyCapabilityModel(), [], OPTIONS);
    const hero = plan.scenes.find((s) => s.type === "showcase-hero")!;
    expect(headlineWordCount(hero.headline)).toBe(14);
  });

  it("truncates a subheadline longer than 18 words to exactly 18 words", () => {
    const identity = makeProductIdentity({ descriptor: Array.from({ length: 25 }, (_, i) => `word${i}`).join(" "), differentiators: [] });
    const plan = buildShowcasePlan(identity, makeExecutiveNarrative(), makeEmptyCapabilityModel(), [], OPTIONS);
    const hero = plan.scenes.find((s) => s.type === "showcase-hero")!;
    expect(hero.subheadline!.split(/\s+/)).toHaveLength(18);
  });

  it("builds showcase-value-pillars headline stating the pillar count", () => {
    const pillars = [makeValuePillar({ id: "prodintel:pillar:a", title: "A" }), makeValuePillar({ id: "prodintel:pillar:b", title: "B" })];
    const identity = makeProductIdentity({ valuePillars: pillars, differentiators: [] });
    const plan = buildShowcasePlan(identity, makeExecutiveNarrative(), makeEmptyCapabilityModel(), [], OPTIONS);
    const scene = plan.scenes.find((s) => s.type === "showcase-value-pillars")!;
    expect(scene.headline).toBe("Value delivered across 2 pillars");
  });

  it("varies the showcase-capabilities headline depending on whether any capability is qualified", () => {
    const withoutQualified = makeProductIdentity({ currentCapabilities: ["capintel:capability:a", "capintel:capability:b"], qualifiedCapabilities: [], differentiators: [] });
    const planWithout = buildShowcasePlan(withoutQualified, makeExecutiveNarrative(), makeEmptyCapabilityModel(), [], OPTIONS);
    const sceneWithout = planWithout.scenes.find((s) => s.type === "showcase-capabilities")!;
    expect(sceneWithout.headline).toBe("2 evidence-backed capabilities in current use");
    expect(sceneWithout.qualifiers).toEqual([]);

    const withQualified = makeProductIdentity({ currentCapabilities: ["capintel:capability:a"], qualifiedCapabilities: ["capintel:capability:c"], differentiators: [] });
    const planWith = buildShowcasePlan(withQualified, makeExecutiveNarrative(), makeEmptyCapabilityModel(), [], OPTIONS);
    const sceneWith = planWith.scenes.find((s) => s.type === "showcase-capabilities")!;
    expect(sceneWith.headline).toBe("1 evidence-backed capabilities, 1 qualified");
    expect(sceneWith.qualifiers).toEqual(["1 capabilities carry an evidence qualifier and are marked accordingly."]);
  });

  it("limits showcase-limitations qualifiers to at most 6, sourced from narrative.limitations", () => {
    const identity = makeProductIdentity({ differentiators: [differentiator()] });
    const limitations = Array.from({ length: 9 }, (_, i) => `Limitation ${i}`);
    const narrative = makeExecutiveNarrative({ limitations, proofPoints: [] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    const scene = plan.scenes.find((s) => s.type === "showcase-limitations")!;
    expect(scene.qualifiers).toEqual(limitations.slice(0, 6));
  });

  it("builds showcase-closing headline from narrative.centralMessage", () => {
    const narrative = makeExecutiveNarrative({ centralMessage: "Widget Platform governs widget operations" });
    const identity = makeProductIdentity({ differentiators: [] });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    const scene = plan.scenes.find((s) => s.type === "showcase-closing")!;
    expect(scene.headline).toBe("Widget Platform governs widget operations");
  });

  it("sorts and dedupes evidenceIds within a scene", () => {
    const evId1 = "prodintel:evidence:capability:widget-b:0";
    const evId2 = "prodintel:evidence:capability:widget-a:0";
    const pillars = [makeValuePillar({ evidenceIds: [evId1, evId2, evId1] })];
    const identity = makeProductIdentity({ valuePillars: pillars, differentiators: [] });
    const plan = buildShowcasePlan(identity, makeExecutiveNarrative({ valuePillars: pillars }), makeEmptyCapabilityModel(), [], OPTIONS);
    const scene = plan.scenes.find((s) => s.type === "showcase-operating-model")!;
    expect(scene.evidenceIds).toEqual([evId2, evId1]);
  });
});

describe("buildShowcasePlan metrics", () => {
  it("includes only confirmed/derived proof points, capped at 4, with audiencePriority set to the array index", () => {
    const proofPoints = [
      proofPoint({ id: "a", status: "confirmed" }),
      proofPoint({ id: "b", status: "derived" }),
      proofPoint({ id: "c", status: "confirmed" }),
      proofPoint({ id: "d", status: "confirmed" }),
      proofPoint({ id: "e", status: "confirmed" }),
      proofPoint({ id: "f", status: "runtime_unverified" }),
    ];
    const identity = makeProductIdentity({ differentiators: [] });
    const narrative = makeExecutiveNarrative({ proofPoints });
    const plan = buildShowcasePlan(identity, narrative, makeEmptyCapabilityModel(), [], OPTIONS);
    expect(plan.metrics).toHaveLength(4);
    expect(plan.metrics.map((m) => m.audiencePriority)).toEqual([0, 1, 2, 3]);
    expect(plan.metrics.every((m) => m.status === "confirmed" || m.status === "derived")).toBe(true);
  });
});

describe("buildShowcasePlan evidence summary", () => {
  it("tallies claim statuses and model evidence confidence counts", () => {
    const model = makeEmptyCapabilityModel({ evidenceSummary: { totalCandidates: 5, includedCount: 3, qualifiedCount: 2, excludedCount: 0, roadmapCount: 0, gapCount: 0, unresolvedCount: 0, evidenceTypeCounts: {}, confidence: { confirmed: 6, derived: 2, suggested: 0, unresolved: 0, total: 8 } } });
    const claims = [
      makeProductClaim({ id: "a", status: "approved" }),
      makeProductClaim({ id: "b", status: "approved_with_qualification" }),
      makeProductClaim({ id: "c", status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_DUPLICATE"] }),
      makeProductClaim({ id: "d", status: "runtime_verification_required" }),
    ];
    const identity = makeProductIdentity({ differentiators: [] });
    const plan = buildShowcasePlan(identity, makeExecutiveNarrative(), model, claims, OPTIONS);
    expect(plan.evidenceSummary).toEqual({
      totalEvidence: 8,
      confirmedCount: 6,
      derivedCount: 2,
      runtimeUnverifiedCount: 1,
      approvedClaimCount: 1,
      qualifiedClaimCount: 1,
      rejectedClaimCount: 1,
      runtimeVerificationClaimCount: 1,
    });
  });
});

describe("headlineWordCount", () => {
  it("counts words in the given text", () => {
    expect(headlineWordCount("Governs widget operations")).toBe(3);
  });
});

describe("buildShowcasePlan determinism", () => {
  it("produces byte-identical output across two builds of the same input", () => {
    const identity = makeProductIdentity({ differentiators: [differentiator()] });
    const narrative = makeExecutiveNarrative({ proofPoints: [proofPoint()], limitations: ["Some capabilities are only partially evidenced."] });
    const model = makeEmptyCapabilityModel();
    const claims = [makeProductClaim()];
    const a = buildShowcasePlan(identity, narrative, model, claims, OPTIONS);
    const b = buildShowcasePlan(identity, narrative, model, claims, OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
