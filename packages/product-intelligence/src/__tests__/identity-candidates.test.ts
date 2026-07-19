import { describe, expect, it } from "vitest";
import type { ProductArchetypeScore } from "../contracts.js";
import { ARCHETYPE_DESCRIPTOR_TEMPLATES, buildIdentityCandidates, descriptorForArchetype, shortPromiseFromPurpose } from "../identity-candidates.js";
import { makeArchitectureFixture, makeEmptyCapabilityModel, makeProductIdentityEvidence } from "./fixtures.js";

describe("descriptorForArchetype", () => {
  it("returns the exact structural descriptor template for a spot-checked set of archetypes, never a repository-specific phrase", () => {
    expect(descriptorForArchetype("governance_platform")).toBe("Governance and compliance platform");
    expect(descriptorForArchetype("developer_tool")).toBe("Developer productivity tool");
    expect(descriptorForArchetype("unknown")).toBe("Software platform");
  });

  it("has a template for every key it declares, each between 2 and 9 words ('unknown' is the sole 2-word fallback)", () => {
    for (const [archetype, descriptor] of Object.entries(ARCHETYPE_DESCRIPTOR_TEMPLATES)) {
      const words = descriptor.trim().split(/\s+/);
      expect(words.length, `${archetype} descriptor "${descriptor}"`).toBeGreaterThanOrEqual(2);
      expect(words.length, `${archetype} descriptor "${descriptor}"`).toBeLessThanOrEqual(9);
    }
  });
});

describe("shortPromiseFromPurpose", () => {
  it("takes only the first clause, splitting on the first '.' or ';'", () => {
    expect(shortPromiseFromPurpose("Governs widget operations. It also does other things.")).toBe("Governs widget operations");
    expect(shortPromiseFromPurpose("Governs widget operations; it also does other things.")).toBe("Governs widget operations");
  });

  it("truncates to at most 18 words when the first clause is longer", () => {
    const longClause = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const result = shortPromiseFromPurpose(longClause);
    expect(result.split(/\s+/)).toHaveLength(18);
  });

  it("returns the full text unchanged when there is no '.' or ';' and it is under 18 words", () => {
    expect(shortPromiseFromPurpose("Governs widget operations for compliance teams")).toBe("Governs widget operations for compliance teams");
  });
});

describe("buildIdentityCandidates", () => {
  it("filters out any archetype score of 0, producing no candidate for it", () => {
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 0, includedSignalCount: 0, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], []);
    expect(candidates).toEqual([]);
  });

  it("assigns confidence 'confirmed' once includedSignalCount >= 2", () => {
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 4, includedSignalCount: 2, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], []);
    expect(candidates[0]!.confidence).toBe("confirmed");
  });

  it("assigns confidence 'derived' when includedSignalCount is 1, or qualifiedSignalCount alone is >= 2", () => {
    const oneIncluded: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    expect(buildIdentityCandidates(oneIncluded, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], [])[0]!.confidence).toBe("derived");

    const twoQualified: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 0, qualifiedSignalCount: 2, matchedCapabilityIds: [] }];
    expect(buildIdentityCandidates(twoQualified, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], [])[0]!.confidence).toBe("derived");
  });

  it("assigns confidence 'suggested' when neither the confirmed nor derived thresholds are met", () => {
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 1, includedSignalCount: 0, qualifiedSignalCount: 1, matchedCapabilityIds: [] }];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], []);
    expect(candidates[0]!.confidence).toBe("suggested");
  });

  it("stamps displayName from the architecture artifact's system identity, not the archetype", () => {
    const arch = makeArchitectureFixture();
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), arch, [], []);
    expect(candidates[0]!.displayName).toBe(arch.identity.name.displayLabel);
  });

  it("leaves valuePillars and differentiators empty at the candidate stage — they are only computed for the archetype ranking.ts ultimately selects", () => {
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], []);
    expect(candidates[0]!.valuePillars).toEqual([]);
    expect(candidates[0]!.differentiators).toEqual([]);
  });

  it("attaches only evidence whose sourceId is in the score's matchedCapabilityIds", () => {
    const matchingEvidence = makeProductIdentityEvidence({ id: "prodintel:evidence:capability:cap-a:0", sourceId: "capintel:capability:cap-a" });
    const unrelatedEvidence = makeProductIdentityEvidence({ id: "prodintel:evidence:capability:cap-b:0", sourceId: "capintel:capability:cap-b" });
    const noSourceIdEvidence = makeProductIdentityEvidence({ id: "prodintel:evidence:domain:d:0", sourceType: "capability_domain", sourceId: undefined });
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: ["capintel:capability:cap-a"] }];

    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [matchingEvidence, unrelatedEvidence, noSourceIdEvidence], []);
    expect(candidates[0]!.evidence).toEqual([matchingEvidence]);
  });

  it("orders candidates by score descending, then archetype-derived id ascending on a tie", () => {
    const scores: ProductArchetypeScore[] = [
      { archetype: "observability_platform", score: 1, includedSignalCount: 0, qualifiedSignalCount: 1, matchedCapabilityIds: [] },
      { archetype: "governance_platform", score: 3, includedSignalCount: 2, qualifiedSignalCount: 0, matchedCapabilityIds: [] },
      { archetype: "developer_tool", score: 1, includedSignalCount: 0, qualifiedSignalCount: 1, matchedCapabilityIds: [] },
    ];
    const candidates = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], []);
    expect(candidates.map((c) => c.archetype)).toEqual(["governance_platform", "developer_tool", "observability_platform"]);
  });

  it("is deterministic: two builds of the same input produce byte-identical output", () => {
    const scores: ProductArchetypeScore[] = [{ archetype: "governance_platform", score: 2, includedSignalCount: 1, qualifiedSignalCount: 0, matchedCapabilityIds: [] }];
    const a = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], ["Compliance Officer"]);
    const b = buildIdentityCandidates(scores, makeEmptyCapabilityModel(), makeArchitectureFixture(), [], ["Compliance Officer"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
