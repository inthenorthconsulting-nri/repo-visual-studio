import { describe, expect, it } from "vitest";
import { buildDifferentiators } from "../differentiators.js";
import { makeArchitectureFixture, makeCapability, makeCapabilityEvidence, makeEmptyCapabilityModel, makeLogicalComponent, makeProductIdentityEvidence, domId } from "./fixtures.js";

describe("buildDifferentiators", () => {
  it("does not surface a shared-component differentiator when fewer than 3 capabilities share it and they are all in one domain", () => {
    const shared = makeLogicalComponent({ sourceLabel: "shared-core" });
    const capA = makeCapability({ sourceLabel: "Widget Alpha", domainId: domId("Widget Operations"), logicalComponents: [shared.id] });
    const capB = makeCapability({ sourceLabel: "Widget Bravo", domainId: domId("Widget Operations"), logicalComponents: [shared.id] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [capA, capB] });
    const arch = makeArchitectureFixture({ components: [shared] });

    const result = buildDifferentiators(model, arch, []);
    expect(result).toEqual([]);
  });

  it("surfaces multi_capability_support once 3+ included capabilities in the same domain share a logical component, with confidence 'derived'", () => {
    const shared = makeLogicalComponent({ sourceLabel: "shared-core" });
    const caps = ["Widget Alpha", "Widget Bravo", "Widget Charlie"].map((sourceLabel) =>
      makeCapability({ sourceLabel, domainId: domId("Widget Operations"), logicalComponents: [shared.id] }),
    );
    const model = makeEmptyCapabilityModel({ includedCapabilities: caps });
    const arch = makeArchitectureFixture({ components: [shared] });

    const result = buildDifferentiators(model, arch, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.basis).toEqual(["multi_capability_support"]);
    expect(result[0]!.confidence).toBe("derived");
    expect(result[0]!.supportingCapabilityIds).toEqual([...caps.map((c) => c.id)].sort((a, b) => a.localeCompare(b)));
  });

  it("surfaces cross_cutting_property (and upgrades confidence to 'confirmed') once a shared component spans 2+ distinct domains, even with only 2 capabilities", () => {
    const shared = makeLogicalComponent({ sourceLabel: "shared-core" });
    const capA = makeCapability({ sourceLabel: "Widget Alpha", domainId: domId("Governance"), logicalComponents: [shared.id] });
    const capB = makeCapability({ sourceLabel: "Widget Bravo", domainId: domId("Widget Operations"), logicalComponents: [shared.id] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [capA, capB] });
    const arch = makeArchitectureFixture({ components: [shared] });

    const result = buildDifferentiators(model, arch, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.basis).toEqual(["cross_cutting_property"]);
    expect(result[0]!.confidence).toBe("confirmed");
  });

  it("combines both shared-component criteria when 3+ capabilities across 2+ domains share a component", () => {
    const shared = makeLogicalComponent({ sourceLabel: "shared-core" });
    const capA = makeCapability({ sourceLabel: "Widget Alpha", domainId: domId("Governance"), logicalComponents: [shared.id] });
    const capB = makeCapability({ sourceLabel: "Widget Bravo", domainId: domId("Widget Operations"), logicalComponents: [shared.id] });
    const capC = makeCapability({ sourceLabel: "Widget Charlie", domainId: domId("Widget Operations"), logicalComponents: [shared.id] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [capA, capB, capC] });
    const arch = makeArchitectureFixture({ components: [shared] });

    const result = buildDifferentiators(model, arch, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.basis).toEqual(expect.arrayContaining(["multi_capability_support", "cross_cutting_property"]));
    expect(result[0]!.basis).toHaveLength(2);
  });

  it("falls back to the raw component id as its label when the referenced logical component is not present in the architecture artifact", () => {
    const capA = makeCapability({ sourceLabel: "Widget Alpha", domainId: domId("Governance"), logicalComponents: ["arch:component:missing"] });
    const capB = makeCapability({ sourceLabel: "Widget Bravo", domainId: domId("Widget Operations"), logicalComponents: ["arch:component:missing"] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [capA, capB] });
    const arch = makeArchitectureFixture({ components: [] });

    const result = buildDifferentiators(model, arch, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.title.toLowerCase()).toContain("arch:component:missing".toLowerCase());
  });

  it("surfaces test_or_deployment_verified for an included capability with both test and deployment evidence", () => {
    const cap = makeCapability({
      sourceLabel: "Widget Verified",
      evidence: [makeCapabilityEvidence("test"), makeCapabilityEvidence("deployment")],
      status: "implemented",
    });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result).toHaveLength(1);
    expect(result[0]!.basis).toEqual(["test_or_deployment_verified"]);
  });

  it("surfaces test_or_deployment_verified for test+workflow evidence too (deployment is not the only qualifying pair)", () => {
    const cap = makeCapability({
      sourceLabel: "Widget Verified",
      evidence: [makeCapabilityEvidence("test"), makeCapabilityEvidence("workflow")],
      status: "implemented",
    });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result[0]!.basis).toEqual(["test_or_deployment_verified"]);
  });

  it("does not surface test_or_deployment_verified from test evidence alone (implementation-only pairing is insufficient)", () => {
    const cap = makeCapability({ sourceLabel: "Widget Verified", evidence: [makeCapabilityEvidence("test")], status: "implemented" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result).toEqual([]);
  });

  it("surfaces operational_distinction for an operational capability with readiness score >= 85", () => {
    const cap = makeCapability({ sourceLabel: "Widget Solid", status: "operational", readiness: { score: 92, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] } });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result).toHaveLength(1);
    expect(result[0]!.basis).toEqual(["operational_distinction"]);
  });

  it("does not surface operational_distinction when status is operational but readiness score is below 85", () => {
    const cap = makeCapability({ sourceLabel: "Widget Shaky", status: "operational", readiness: { score: 60, implementationScore: 60, executionScore: 60, verificationScore: 60, documentationScore: 60, adoptionScore: 60, blockers: [], qualifiers: [] } });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result).toEqual([]);
  });

  it("links evidenceIds from the supplied ProductIdentityEvidence list by matching sourceType='capability' and sourceId to the capability id", () => {
    const cap = makeCapability({ sourceLabel: "Widget Solid", status: "operational", readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] } });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });
    const ev = makeProductIdentityEvidence({ id: "prodintel:evidence:capability:widget-solid:0", sourceType: "capability", sourceId: cap.id });
    const unrelatedEv = makeProductIdentityEvidence({ id: "prodintel:evidence:domain:other:0", sourceType: "capability_domain", sourceId: "capintel:domain:other" });

    const result = buildDifferentiators(model, makeArchitectureFixture(), [ev, unrelatedEv]);
    expect(result[0]!.evidenceIds).toEqual([ev.id]);
  });

  it("caps output at MAX_DIFFERENTIATORS (6), preferring lower ids on a score tie and re-sorting the trimmed set by id ascending", () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
    const caps = names.map((n) =>
      makeCapability({
        sourceLabel: n,
        status: "operational",
        readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
      }),
    );
    const model = makeEmptyCapabilityModel({ includedCapabilities: caps });

    const result = buildDifferentiators(model, makeArchitectureFixture(), []);
    expect(result).toHaveLength(6);
    // All 7 candidates tie in score (same basis count, confidence, supporting-capability count),
    // so the id-ascending tiebreak determines which 6 survive: "golf" sorts last and is dropped.
    expect(result.some((d) => d.title.toLowerCase().includes("golf"))).toBe(false);
    const ids = result.map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("is deterministic: two builds of the same input produce byte-identical output", () => {
    const shared = makeLogicalComponent({ sourceLabel: "shared-core" });
    const caps = ["Widget Alpha", "Widget Bravo", "Widget Charlie"].map((sourceLabel) =>
      makeCapability({ sourceLabel, domainId: domId("Widget Operations"), logicalComponents: [shared.id] }),
    );
    const model = makeEmptyCapabilityModel({ includedCapabilities: caps });
    const arch = makeArchitectureFixture({ components: [shared] });

    const a = buildDifferentiators(model, arch, []);
    const b = buildDifferentiators(model, arch, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
