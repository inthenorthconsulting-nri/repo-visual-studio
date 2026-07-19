import { describe, expect, it } from "vitest";
import { classifyArchetypes, selectArchetypes } from "../archetypes.js";
import { makeArchitectureFixture, makeCapability, makeEmptyCapabilityModel, makeLogicalComponent, makeResponsibility } from "./fixtures.js";

describe("classifyArchetypes", () => {
  it("scores an included capability whose purpose/description matches an archetype's text signals, weighted higher than a qualified match", () => {
    const included = makeCapability({
      sourceLabel: "Policy Governance Console",
      purpose: "Enforces governance policy and compliance audit controls.",
      inclusion: "include",
    });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included] });
    const arch = makeArchitectureFixture();

    const scores = classifyArchetypes(model, arch);
    const governance = scores.find((s) => s.archetype === "governance_platform");
    expect(governance).toBeDefined();
    expect(governance!.score).toBe(2);
    expect(governance!.includedSignalCount).toBe(1);
    expect(governance!.qualifiedSignalCount).toBe(0);
    expect(governance!.matchedCapabilityIds).toEqual([included.id]);
  });

  it("weights a qualified capability match at half the strength of an included match", () => {
    const qualified = makeCapability({ sourceLabel: "Widget Report Export", purpose: "Exports observability dashboard metrics for widget health.", inclusion: "include_with_qualification" });
    const model = makeEmptyCapabilityModel({ qualifiedCapabilities: [qualified] });
    const arch = makeArchitectureFixture();

    const scores = classifyArchetypes(model, arch);
    const observability = scores.find((s) => s.archetype === "observability_platform");
    expect(observability!.score).toBe(1);
    expect(observability!.includedSignalCount).toBe(0);
    expect(observability!.qualifiedSignalCount).toBe(1);
  });

  it("boosts an archetype from a matching architecture responsibility kind, independent of capability wording", () => {
    const model = makeEmptyCapabilityModel();
    const arch = makeArchitectureFixture({ responsibilities: [makeResponsibility("governance")] });

    const scores = classifyArchetypes(model, arch);
    const governance = scores.find((s) => s.archetype === "governance_platform");
    expect(governance!.score).toBe(1);
    // Responsibility boost never counts as an included/qualified capability signal.
    expect(governance!.includedSignalCount).toBe(0);
    expect(governance!.qualifiedSignalCount).toBe(0);
  });

  it("boosts developer_tool when a CLI-kind component is present", () => {
    const model = makeEmptyCapabilityModel();
    const arch = makeArchitectureFixture({ components: [makeLogicalComponent({ sourceLabel: "widget-cli", kind: "cli" })] });

    const scores = classifyArchetypes(model, arch);
    const devTool = scores.find((s) => s.archetype === "developer_tool");
    expect(devTool!.score).toBe(1);
  });

  it("orders results deterministically by score desc, then archetype id asc as a stable tiebreak", () => {
    const model = makeEmptyCapabilityModel();
    const arch = makeArchitectureFixture();
    const scores = classifyArchetypes(model, arch);
    // All-zero scores here, so the whole list must be sorted purely by archetype id.
    const ids = scores.map((s) => s.archetype);
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sortedIds);
  });

  it("never includes 'unknown' as a scored archetype", () => {
    const scores = classifyArchetypes(makeEmptyCapabilityModel(), makeArchitectureFixture());
    expect(scores.some((s) => s.archetype === "unknown")).toBe(false);
  });
});

describe("selectArchetypes", () => {
  it("resolves to primary 'unknown' with no secondary archetypes when no archetype clears the evidence bar (zero evidence)", () => {
    const scores = classifyArchetypes(makeEmptyCapabilityModel(), makeArchitectureFixture());
    const { primary, secondary } = selectArchetypes(scores);
    expect(primary).toBe("unknown");
    expect(secondary).toEqual([]);
  });

  it("resolves to primary 'unknown' when only a responsibility boost or CLI boost contributed score, since neither counts as an included/qualified capability signal", () => {
    const model = makeEmptyCapabilityModel();
    const arch = makeArchitectureFixture({ responsibilities: [makeResponsibility("governance")], components: [makeLogicalComponent({ sourceLabel: "widget-cli", kind: "cli" })] });
    const scores = classifyArchetypes(model, arch);
    const { primary } = selectArchetypes(scores);
    expect(primary).toBe("unknown");
  });

  it("selects a primary archetype once two included capabilities match its signals (the >=2 included-capability rule)", () => {
    const cap1 = makeCapability({ sourceLabel: "Policy Governance Console", purpose: "Enforces governance policy and compliance audit controls." });
    const cap2 = makeCapability({ sourceLabel: "Access Approval Workflow", purpose: "Manages governance approval and permission guardrails." });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap1, cap2] });
    const scores = classifyArchetypes(model, makeArchitectureFixture());
    const { primary } = selectArchetypes(scores);
    expect(primary).toBe("governance_platform");
  });

  it("selects a primary archetype via 1 included + 2 qualified signals (the alternate qualifying rule)", () => {
    const included = makeCapability({ sourceLabel: "Policy Governance Console", purpose: "Enforces governance policy controls." });
    const qualified1 = makeCapability({ sourceLabel: "Compliance Audit Trail", purpose: "Tracks compliance audit history.", inclusion: "include_with_qualification" });
    const qualified2 = makeCapability({ sourceLabel: "Access Guardrail", purpose: "Applies access control guardrail policy.", inclusion: "include_with_qualification" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included], qualifiedCapabilities: [qualified1, qualified2] });
    const scores = classifyArchetypes(model, makeArchitectureFixture());
    const { primary } = selectArchetypes(scores);
    expect(primary).toBe("governance_platform");
  });

  it("does not select a primary archetype from a single included capability match alone", () => {
    const cap1 = makeCapability({ sourceLabel: "Policy Governance Console", purpose: "Enforces governance policy controls." });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap1] });
    const scores = classifyArchetypes(model, makeArchitectureFixture());
    const { primary } = selectArchetypes(scores);
    expect(primary).toBe("unknown");
  });

  it("returns up to 2 secondary archetypes with positive score, excluding the primary", () => {
    const govCap1 = makeCapability({ sourceLabel: "Policy Governance Console", purpose: "Enforces governance policy and compliance audit controls." });
    const govCap2 = makeCapability({ sourceLabel: "Access Approval Workflow", purpose: "Manages governance approval and permission guardrails." });
    const opsCap = makeCapability({ sourceLabel: "Ops Scheduler", purpose: "Handles operations orchestration and pipeline scheduling.", inclusion: "include_with_qualification" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [govCap1, govCap2], qualifiedCapabilities: [opsCap] });
    const scores = classifyArchetypes(model, makeArchitectureFixture());
    const { primary, secondary } = selectArchetypes(scores);
    expect(primary).toBe("governance_platform");
    expect(secondary.length).toBeLessThanOrEqual(2);
    expect(secondary).not.toContain("governance_platform");
  });
});
