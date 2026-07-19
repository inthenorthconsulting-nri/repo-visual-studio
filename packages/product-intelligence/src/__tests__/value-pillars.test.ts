import { describe, expect, it } from "vitest";
import { buildValuePillars, VALUE_PILLAR_BAND } from "../value-pillars.js";
import { makeCapability, makeCapabilityDomain, makeEmptyCapabilityModel, makeProductIdentityEvidence } from "./fixtures.js";

describe("VALUE_PILLAR_BAND", () => {
  it("declares the 3-5 pillar target band from §8", () => {
    expect(VALUE_PILLAR_BAND).toEqual({ min: 3, max: 5 });
  });
});

describe("buildValuePillars", () => {
  it("returns no pillars when there are no domains with capabilities", () => {
    const model = makeEmptyCapabilityModel({ domains: [makeCapabilityDomain({ sourceLabel: "Empty Domain", capabilities: [] })] });
    expect(buildValuePillars(model, [])).toEqual([]);
  });

  it("excludes domains with zero capabilities from becoming pillars", () => {
    const populated = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [makeCapability({ inclusion: "include" })] });
    const empty = makeCapabilityDomain({ sourceLabel: "Empty Domain", capabilities: [] });
    const model = makeEmptyCapabilityModel({ domains: [populated, empty] });
    const pillars = buildValuePillars(model, []);
    expect(pillars.map((p) => p.title)).toEqual(["Widget Operations"]);
  });

  it("assigns confidence 'confirmed' when a pillar has included capabilities and no qualified ones", () => {
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include" })] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const [pillar] = buildValuePillars(model, []);
    expect(pillar.confidence).toBe("confirmed");
    expect(pillar.qualification).toBeUndefined();
  });

  it("assigns confidence 'derived' when a pillar mixes included and qualified capabilities, and records a qualification note", () => {
    const included = makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include" });
    const qualified = makeCapability({ sourceLabel: "Widget Report Export", inclusion: "include_with_qualification" });
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [included, qualified] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const [pillar] = buildValuePillars(model, []);
    expect(pillar.confidence).toBe("derived");
    expect(pillar.qualification).toContain("1 of 2 capabilities in this pillar carry evidence qualifiers");
  });

  it("assigns confidence 'suggested' when a pillar has only qualified capabilities and no included ones", () => {
    const qualified = makeCapability({ sourceLabel: "Legacy Report Viewer", inclusion: "include_with_qualification" });
    const domain = makeCapabilityDomain({ sourceLabel: "Legacy Reporting", capabilities: [qualified] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const [pillar] = buildValuePillars(model, []);
    expect(pillar.confidence).toBe("suggested");
  });

  it("sorts includedCapabilityIds and qualifiedCapabilityIds ascending regardless of input order", () => {
    const capZ = makeCapability({ sourceLabel: "Zeta Capability", inclusion: "include" });
    const capA = makeCapability({ sourceLabel: "Alpha Capability", inclusion: "include" });
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [capZ, capA] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const [pillar] = buildValuePillars(model, []);
    expect(pillar.includedCapabilityIds).toEqual([...pillar.includedCapabilityIds].sort((a, b) => a.localeCompare(b)));
  });

  it("links evidence whose sourceType is 'capability' and whose sourceId is one of the pillar's capability ids, sorted ascending; excludes non-capability evidence", () => {
    const capA = makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include" });
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [capA] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const evidence = [
      makeProductIdentityEvidence({ id: "prodintel:evidence:capability:widget-sync:1", sourceType: "capability", sourceId: capA.id }),
      makeProductIdentityEvidence({ id: "prodintel:evidence:capability:widget-sync:0", sourceType: "capability", sourceId: capA.id }),
      makeProductIdentityEvidence({ id: "prodintel:evidence:domain:widget-operations:0", sourceType: "capability_domain", sourceId: domain.id }),
    ];
    const [pillar] = buildValuePillars(model, evidence);
    expect(pillar.evidenceIds).toEqual(["prodintel:evidence:capability:widget-sync:0", "prodintel:evidence:capability:widget-sync:1"]);
  });

  it("merges the smallest two domain buckets (by capability count, tie-broken by title) when there are more than 5 domains, until at most 5 pillars remain", () => {
    const domains = ["A", "B", "C", "D", "E", "F"].map((letter) =>
      makeCapabilityDomain({ sourceLabel: letter, capabilities: [makeCapability({ sourceLabel: `Cap ${letter}`, inclusion: "include" })] }),
    );
    const model = makeEmptyCapabilityModel({ domains });
    const pillars = buildValuePillars(model, []);
    expect(pillars).toHaveLength(5);
    expect(pillars.map((p) => p.title)).toContain("A & B");
    expect(pillars.map((p) => p.title)).toEqual(expect.arrayContaining(["C", "D", "E", "F"]));
  });

  it("caps qualified-only pillars at 2 by folding any excess into the largest included-bearing pillar", () => {
    const gov = makeCapabilityDomain({
      sourceLabel: "Governance",
      capabilities: [makeCapability({ sourceLabel: "Policy Console", inclusion: "include" }), makeCapability({ sourceLabel: "Approval Workflow", inclusion: "include" })],
    });
    const ops = makeCapabilityDomain({ sourceLabel: "Operations", capabilities: [makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include" })] });
    const legacyA = makeCapabilityDomain({ sourceLabel: "Legacy A", capabilities: [makeCapability({ sourceLabel: "Legacy Viewer A", inclusion: "include_with_qualification" })] });
    const legacyB = makeCapabilityDomain({ sourceLabel: "Legacy B", capabilities: [makeCapability({ sourceLabel: "Legacy Viewer B", inclusion: "include_with_qualification" })] });
    const legacyC = makeCapabilityDomain({ sourceLabel: "Legacy C", capabilities: [makeCapability({ sourceLabel: "Legacy Viewer C", inclusion: "include_with_qualification" })] });
    const model = makeEmptyCapabilityModel({ domains: [gov, ops, legacyA, legacyB, legacyC] });

    const pillars = buildValuePillars(model, []);
    const qualifiedOnlyPillars = pillars.filter((p) => p.includedCapabilityIds.length === 0 && p.qualifiedCapabilityIds.length > 0);
    expect(qualifiedOnlyPillars).toHaveLength(2);
    // "Legacy C" (the alphabetically-last excess bucket) is folded into "Governance"
    // (the larger of the two included-bearing buckets), not left standing alone.
    expect(pillars.some((p) => p.title === "Governance & Legacy C")).toBe(true);
    expect(pillars.some((p) => p.title === "Legacy C")).toBe(false);
  });

  it("sorts the final pillar list by id ascending", () => {
    const domains = ["Zeta Domain", "Alpha Domain"].map((sourceLabel) => makeCapabilityDomain({ sourceLabel, capabilities: [makeCapability({ sourceLabel: `${sourceLabel} Cap`, inclusion: "include" })] }));
    const model = makeEmptyCapabilityModel({ domains });
    const pillars = buildValuePillars(model, []);
    expect(pillars.map((p) => p.id)).toEqual([...pillars.map((p) => p.id)].sort((a, b) => a.localeCompare(b)));
  });

  it("is deterministic: two builds of the same input produce identical output", () => {
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [makeCapability({ inclusion: "include" })] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const evidence = [makeProductIdentityEvidence({ sourceId: model.domains[0]!.capabilities[0]!.id })];
    const a = buildValuePillars(model, evidence);
    const b = buildValuePillars(model, evidence);
    expect(a).toEqual(b);
  });
});
