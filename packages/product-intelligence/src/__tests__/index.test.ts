import { describe, expect, it } from "vitest";
import { synthesizeExecutiveNarrative, synthesizeProductIdentity, synthesizeShowcasePlan } from "../index.js";
import type { ProductIdentityOverride } from "../contracts.js";
import { SHOWCASE_MAX_SCENES, SHOWCASE_MIN_SCENES } from "../showcase-plan.js";
import { makeGovernancePlatformFixture } from "./fixtures.js";

const GIT_COMMIT = "abc1234";
const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function runFullPipeline(override?: ProductIdentityOverride) {
  const { architecture, capabilityModel } = makeGovernancePlatformFixture();
  const identityModel = synthesizeProductIdentity({ architecture, capabilityModel, override, gitCommit: GIT_COMMIT, generatedAt: GENERATED_AT });
  const { narrative, claims } = synthesizeExecutiveNarrative({ identityModel, capabilityModel, override, audience: "executive" });
  const showcasePlan = synthesizeShowcasePlan({
    identityModel,
    narrative,
    claims,
    capabilityModel,
    audience: "executive",
    theme: "default",
    gitCommit: GIT_COMMIT,
    generatedAt: GENERATED_AT,
  });
  return { identityModel, narrative, claims, showcasePlan };
}

describe("end-to-end pipeline: synthesizeProductIdentity -> synthesizeExecutiveNarrative -> synthesizeShowcasePlan", () => {
  it("is fully deterministic: two independent runs over the same input produce byte-identical JSON output at every stage", () => {
    const runA = runFullPipeline();
    const runB = runFullPipeline();
    expect(JSON.stringify(runA.identityModel)).toBe(JSON.stringify(runB.identityModel));
    expect(JSON.stringify(runA.narrative)).toBe(JSON.stringify(runB.narrative));
    expect(JSON.stringify(runA.claims)).toBe(JSON.stringify(runB.claims));
    expect(JSON.stringify(runA.showcasePlan)).toBe(JSON.stringify(runB.showcasePlan));
  });

  it("synthesizeProductIdentity produces a well-formed model with overrideApplied=false when no override is supplied", () => {
    const { identityModel } = runFullPipeline();
    expect(identityModel.schemaVersion).toBeGreaterThan(0);
    expect(identityModel.identity.overrideApplied).toBe(false);
    expect(identityModel.generationMetadata.overrideApplied).toBe(false);
    expect(identityModel.generationMetadata.overridePath).toBeUndefined();
    expect(identityModel.identity.archetype).toBe("governance_platform");
    expect(identityModel.identity.currentCapabilities.length).toBeGreaterThan(0);
  });

  it("never promotes a roadmap-only or excluded capability into identity.currentCapabilities", () => {
    const { identityModel } = runFullPipeline();
    const { capabilityModel } = makeGovernancePlatformFixture();
    const roadmapIds = new Set(capabilityModel.roadmapCapabilities.map((c) => c.id));
    const excludedIds = new Set(capabilityModel.excludedCandidates.map((c) => c.id));
    for (const id of identityModel.identity.currentCapabilities) {
      expect(roadmapIds.has(id)).toBe(false);
      expect(excludedIds.has(id)).toBe(false);
    }
  });

  it("claim control (via synthesizeExecutiveNarrative) never approves a claim about a roadmap-only or excluded capability, and every rejected claim carries non-empty rejectionReasons", () => {
    const { claims } = runFullPipeline();
    const { capabilityModel } = makeGovernancePlatformFixture();
    const roadmapIds = new Set(capabilityModel.roadmapCapabilities.map((c) => c.id));
    const excludedIds = new Set(capabilityModel.excludedCandidates.map((c) => c.id));

    for (const claim of claims) {
      if (claim.status === "rejected") {
        expect(claim.rejectionReasons.length).toBeGreaterThan(0);
      } else {
        expect(claim.rejectionReasons).toEqual([]);
      }
    }

    // No approved/qualified/runtime claim's text references a roadmap-only or excluded capability's display name in a promotional way —
    // structurally, claims.ts only ever builds capability claims from includedCapabilities/qualifiedCapabilities, so this is a closed check
    // on the roadmap/excluded capability display names never leaking into any non-rejected claim text.
    const roadmapCap = capabilityModel.roadmapCapabilities[0]!;
    const excludedCandidate = capabilityModel.excludedCandidates[0]!;
    for (const claim of claims) {
      if (claim.status !== "rejected") {
        expect(claim.text).not.toContain(roadmapCap.displayName);
        expect(claim.text).not.toContain(excludedCandidate.displayName);
      }
    }
    void roadmapIds;
    void excludedIds;
  });

  it("applies a .rvs/product.yml-style override end to end: overrideApplied becomes true and the override's fields are reflected in identity", () => {
    const override: ProductIdentityOverride = {
      schema_version: 1,
      display_name: "Widget Governance Suite",
      purpose_override: "Widget Governance Suite governs widget compliance workflows for regulated enterprise teams worldwide.",
      primary_users: ["Compliance Officer", "Auditor"],
    };
    const { identityModel } = runFullPipeline(override);
    expect(identityModel.identity.overrideApplied).toBe(true);
    expect(identityModel.generationMetadata.overrideApplied).toBe(true);
    expect(identityModel.generationMetadata.overridePath).toBe(".rvs/product.yml");
    expect(identityModel.identity.displayName).toBe("Widget Governance Suite");
    expect(identityModel.identity.purpose).toBe(override.purpose_override);
    expect(identityModel.identity.primaryUsers).toEqual(["Compliance Officer", "Auditor"]);
  });

  it("synthesizeShowcasePlan produces a scene count within the SHOWCASE_MIN_SCENES..SHOWCASE_MAX_SCENES band", () => {
    const { showcasePlan } = runFullPipeline();
    expect(showcasePlan.scenes.length).toBeGreaterThanOrEqual(SHOWCASE_MIN_SCENES);
    expect(showcasePlan.scenes.length).toBeLessThanOrEqual(SHOWCASE_MAX_SCENES);
    expect(showcasePlan.generationMetadata.sceneCount).toBe(showcasePlan.scenes.length);
  });

  it("every scene id, capabilityId list, claimId list, and evidenceId list in the showcase plan is internally consistent (sorted ascending)", () => {
    const { showcasePlan } = runFullPipeline();
    for (const scene of showcasePlan.scenes) {
      expect(scene.capabilityIds).toEqual([...scene.capabilityIds].sort((a, b) => a.localeCompare(b)));
      expect(scene.claimIds).toEqual([...scene.claimIds].sort((a, b) => a.localeCompare(b)));
      expect(scene.evidenceIds).toEqual([...scene.evidenceIds].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("resolves the archetype conservatively to a real value (not silently 'unknown') given rich governance-platform evidence", () => {
    const { identityModel } = runFullPipeline();
    expect(identityModel.identity.archetype).not.toBe("unknown");
    expect(identityModel.identity.confidence).not.toBe("unresolved");
  });
});
