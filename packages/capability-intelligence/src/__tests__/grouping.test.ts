import { describe, expect, it } from "vitest";
import { buildCapabilityDomains } from "../grouping.js";
import { capDomainId } from "../ids.js";
import { makeCapability, makeCapabilityEvidence } from "./fixtures.js";

describe("buildCapabilityDomains — visibility filter", () => {
  it("only draws domain membership from include/include_with_qualification capabilities, never roadmap/gap/excluded status leaking in as a capability", () => {
    const domainId = capDomainId("Widget Operations");
    const included = makeCapability({ sourceLabel: "Widget Sync Service", domainId, status: "implemented", inclusion: "include" });
    const qualified = makeCapability({ sourceLabel: "Widget Report Export", domainId, status: "partial", inclusion: "include_with_qualification" });
    const planned = makeCapability({ sourceLabel: "Widget Multi-Region Rollout", domainId, status: "planned", inclusion: "roadmap_only" });

    const { domains } = buildCapabilityDomains([included, qualified, planned], new Map([[domainId, "Widget Operations"]]));

    expect(domains).toHaveLength(1);
    expect(domains[0]!.capabilities.map((c) => c.id).sort()).toEqual([included.id, qualified.id].sort());
    expect(domains[0]!.capabilities.some((c) => c.id === planned.id)).toBe(false);
  });

  it("groups by domainId and sorts capabilities within a domain by id", () => {
    const domainId = capDomainId("Widget Operations");
    const b = makeCapability({ sourceLabel: "Bravo Capability", domainId, inclusion: "include" });
    const a = makeCapability({ sourceLabel: "Alpha Capability", domainId, inclusion: "include" });
    const { domains } = buildCapabilityDomains([b, a], new Map([[domainId, "Widget Operations"]]));
    expect(domains[0]!.capabilities.map((c) => c.id)).toEqual([...domains[0]!.capabilities.map((c) => c.id)].sort((x, y) => x.localeCompare(y)));
  });

  it("sorts domains themselves by domainId ascending", () => {
    const zDomain = capDomainId("Zeta Domain");
    const aDomain = capDomainId("Alpha Domain");
    const zCap = makeCapability({ sourceLabel: "Zeta Capability", domainId: zDomain, inclusion: "include" });
    const aCap = makeCapability({ sourceLabel: "Alpha Capability", domainId: aDomain, inclusion: "include" });
    const { domains } = buildCapabilityDomains(
      [zCap, aCap],
      new Map([
        [zDomain, "Zeta Domain"],
        [aDomain, "Alpha Domain"],
      ]),
    );
    expect(domains.map((d) => d.id)).toEqual([...domains.map((d) => d.id)].sort((x, y) => x.localeCompare(y)));
  });
});

describe("buildCapabilityDomains — computed domain fields", () => {
  it("counts operational/implemented capabilities separately from qualified (include_with_qualification) capabilities", () => {
    const domainId = capDomainId("Widget Operations");
    const operational = makeCapability({ sourceLabel: "Widget Sync Service", domainId, status: "operational", inclusion: "include" });
    const implemented = makeCapability({ sourceLabel: "Widget Report Export", domainId, status: "implemented", inclusion: "include" });
    const qualified = makeCapability({ sourceLabel: "Widget Bulk Import", domainId, status: "partial", inclusion: "include_with_qualification" });
    const { domains } = buildCapabilityDomains([operational, implemented, qualified], new Map([[domainId, "Widget Operations"]]));
    expect(domains[0]!.operationalCapabilityCount).toBe(2);
    expect(domains[0]!.partialCapabilityCount).toBe(1);
  });

  it("sums evidence.length across every capability in the domain for evidenceCount", () => {
    const domainId = capDomainId("Widget Operations");
    const a = makeCapability({ sourceLabel: "Widget Sync Service", domainId, inclusion: "include", evidence: [makeCapabilityEvidence("workflow"), makeCapabilityEvidence("implementation")] });
    const b = makeCapability({ sourceLabel: "Widget Report Export", domainId, inclusion: "include", evidence: [makeCapabilityEvidence("implementation")] });
    const { domains } = buildCapabilityDomains([a, b], new Map([[domainId, "Widget Operations"]]));
    expect(domains[0]!.evidenceCount).toBe(3);
  });

  it("uses the supplied domainLabels display name, falling back to the first capability's displayName, falling back to the raw domainId", () => {
    const domainId = capDomainId("Widget Operations");
    const cap = makeCapability({ sourceLabel: "Widget Sync Service", domainId, inclusion: "include" });
    const withLabel = buildCapabilityDomains([cap], new Map([[domainId, "Widget Operations (custom label)"]]));
    expect(withLabel.domains[0]!.displayName).toBe("Widget Operations (custom label)");

    const withoutLabel = buildCapabilityDomains([cap], new Map());
    expect(withoutLabel.domains[0]!.displayName).toBe(cap.displayName);
  });
});

describe("buildCapabilityDomains — CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN", () => {
  it("warns when a domain has exactly one capability that never reached operational/implemented status", () => {
    const domainId = capDomainId("Widget Operations");
    const weak = makeCapability({ sourceLabel: "Widget Bulk Import", domainId, status: "partial", inclusion: "include_with_qualification" });
    const { warnings } = buildCapabilityDomains([weak], new Map([[domainId, "Widget Operations"]]));
    expect(warnings.some((w) => w.code === "CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN")).toBe(true);
  });

  it("does not warn when the domain's single capability is operational or implemented", () => {
    const domainId = capDomainId("Widget Operations");
    const strong = makeCapability({ sourceLabel: "Widget Sync Service", domainId, status: "implemented", inclusion: "include" });
    const { warnings } = buildCapabilityDomains([strong], new Map([[domainId, "Widget Operations"]]));
    expect(warnings.some((w) => w.code === "CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN")).toBe(false);
  });

  it("does not warn when a weak domain has more than one capability", () => {
    const domainId = capDomainId("Widget Operations");
    const weak1 = makeCapability({ sourceLabel: "Widget Bulk Import", domainId, status: "partial", inclusion: "include_with_qualification" });
    const weak2 = makeCapability({ sourceLabel: "Widget Bulk Export", domainId, status: "partial", inclusion: "include_with_qualification" });
    const { warnings } = buildCapabilityDomains([weak1, weak2], new Map([[domainId, "Widget Operations"]]));
    expect(warnings.some((w) => w.code === "CAP_INTEL_SINGLE_WEAK_CAPABILITY_DOMAIN")).toBe(false);
  });
});

describe("buildCapabilityDomains — CAP_INTEL_OVER_GRANULAR_DOMAIN", () => {
  it("warns once the model has drifted past the 8-domain guidance band (9th domain onward, by alphabetical domainId order)", () => {
    const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const capabilities = letters.map((letter) =>
      makeCapability({ sourceLabel: `${letter} Domain Capability`, domainId: capDomainId(`${letter} Domain`), status: "implemented", inclusion: "include" }),
    );
    const domainLabels = new Map(letters.map((letter) => [capDomainId(`${letter} Domain`), `${letter} Domain`]));

    const { domains, warnings } = buildCapabilityDomains(capabilities, domainLabels);
    expect(domains).toHaveLength(9);
    const overGranular = warnings.filter((w) => w.code === "CAP_INTEL_OVER_GRANULAR_DOMAIN");
    expect(overGranular).toHaveLength(1);
    expect(overGranular[0]!.relatedId).toBe(capDomainId("I Domain"));
  });

  it("does not warn when the model has 8 or fewer domains", () => {
    const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const capabilities = letters.map((letter) =>
      makeCapability({ sourceLabel: `${letter} Domain Capability`, domainId: capDomainId(`${letter} Domain`), status: "implemented", inclusion: "include" }),
    );
    const domainLabels = new Map(letters.map((letter) => [capDomainId(`${letter} Domain`), `${letter} Domain`]));
    const { warnings } = buildCapabilityDomains(capabilities, domainLabels);
    expect(warnings.some((w) => w.code === "CAP_INTEL_OVER_GRANULAR_DOMAIN")).toBe(false);
  });
});
