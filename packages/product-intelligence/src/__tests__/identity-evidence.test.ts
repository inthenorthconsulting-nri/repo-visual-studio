import { describe, expect, it } from "vitest";
import { gatherIdentityEvidence } from "../identity-evidence.js";
import {
  makeArchitectureFixture,
  makeCapability,
  makeCapabilityDomain,
  makeEmptyCapabilityModel,
  makeLogicalComponent,
  makeWorkflowFamily,
  stmt,
} from "./fixtures.js";

describe("gatherIdentityEvidence", () => {
  it("includes repository_metadata evidence sourced from the architecture identity's one-line description", () => {
    const arch = makeArchitectureFixture();
    const evidence = gatherIdentityEvidence(makeEmptyCapabilityModel(), arch);
    const repoEv = evidence.find((e) => e.sourceType === "repository_metadata");
    expect(repoEv).toBeDefined();
    expect(repoEv!.text).toBe(arch.identity.oneLineDescription.value);
    expect(repoEv!.sourceId).toBe(arch.identity.id);
  });

  it("omits repository_metadata evidence entirely when the one-line description has no value", () => {
    const arch = makeArchitectureFixture({ identity: { ...makeArchitectureFixture().identity, oneLineDescription: stmt("") } });
    const evidence = gatherIdentityEvidence(makeEmptyCapabilityModel(), arch);
    expect(evidence.some((e) => e.sourceType === "repository_metadata")).toBe(false);
  });

  it("weights repository_metadata strength 4 when confirmed and 2 otherwise", () => {
    const archConfirmed = makeArchitectureFixture();
    const confirmedEv = gatherIdentityEvidence(makeEmptyCapabilityModel(), archConfirmed).find((e) => e.sourceType === "repository_metadata")!;
    expect(confirmedEv.strength).toBe(4);

    const archSuggested = makeArchitectureFixture({ identity: { ...makeArchitectureFixture().identity, oneLineDescription: stmt("A platform.", "suggested") } });
    const suggestedEv = gatherIdentityEvidence(makeEmptyCapabilityModel(), archSuggested).find((e) => e.sourceType === "repository_metadata")!;
    expect(suggestedEv.strength).toBe(2);
  });

  it("gathers capability evidence from included AND qualified capabilities, weighting included at strength 4 and qualified at strength 2", () => {
    const included = makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include" });
    const qualified = makeCapability({ sourceLabel: "Widget Report Export", inclusion: "include_with_qualification" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included], qualifiedCapabilities: [qualified] });

    const evidence = gatherIdentityEvidence(model, makeArchitectureFixture());
    const includedEv = evidence.find((e) => e.sourceType === "capability" && e.sourceId === included.id);
    const qualifiedEv = evidence.find((e) => e.sourceType === "capability" && e.sourceId === qualified.id);
    expect(includedEv!.strength).toBe(4);
    expect(qualifiedEv!.strength).toBe(2);
  });

  it("never gathers capability evidence from roadmap, gap, excluded, or unresolved capabilities — only includedCapabilities and qualifiedCapabilities are read", () => {
    const roadmapCap = makeCapability({ sourceLabel: "Widget Auto Remediation", inclusion: "roadmap_only" });
    const gapCap = makeCapability({ sourceLabel: "Widget Multi Region", inclusion: "gap_only" });
    const model = makeEmptyCapabilityModel({
      includedCapabilities: [],
      qualifiedCapabilities: [],
      roadmapCapabilities: [roadmapCap],
      gapCapabilities: [gapCap],
      excludedCandidates: [{ id: "capintel:excluded:x", displayName: "X", sourceLabel: "X", granularity: "capability", status: "scaffolded", confidence: "unresolved", readiness: roadmapCap.readiness, reasonCodes: ["SCAFFOLD_ONLY"], reasonSummary: "n/a", evidence: [] }],
      unresolvedCapabilities: [],
    });

    const evidence = gatherIdentityEvidence(model, makeArchitectureFixture());
    expect(evidence.some((e) => e.sourceType === "capability")).toBe(false);
  });

  it("gathers capability_domain evidence only for domains with at least one capability", () => {
    const populatedDomain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [makeCapability()] });
    const emptyDomain = makeCapabilityDomain({ sourceLabel: "Empty Domain", capabilities: [] });
    const model = makeEmptyCapabilityModel({ domains: [populatedDomain, emptyDomain] });

    const evidence = gatherIdentityEvidence(model, makeArchitectureFixture());
    const domainEvidence = evidence.filter((e) => e.sourceType === "capability_domain");
    expect(domainEvidence).toHaveLength(1);
    expect(domainEvidence[0]!.sourceId).toBe(populatedDomain.id);
  });

  it("gathers logical_component evidence but excludes components with origin 'repository-directory'", () => {
    const realComponent = makeLogicalComponent({ sourceLabel: "shared-core", origin: "workflow-family" });
    const directoryComponent = makeLogicalComponent({ sourceLabel: "src-dir", origin: "repository-directory" });
    const arch = makeArchitectureFixture({ components: [realComponent, directoryComponent] });

    const evidence = gatherIdentityEvidence(makeEmptyCapabilityModel(), arch);
    const componentEvidence = evidence.filter((e) => e.sourceType === "logical_component");
    expect(componentEvidence).toHaveLength(1);
    expect(componentEvidence[0]!.sourceId).toBe(realComponent.id);
  });

  it("gathers workflow_family evidence for every workflow family present", () => {
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync" });
    const arch = makeArchitectureFixture({ workflowFamilies: [family] });

    const evidence = gatherIdentityEvidence(makeEmptyCapabilityModel(), arch);
    const familyEvidence = evidence.filter((e) => e.sourceType === "workflow_family");
    expect(familyEvidence).toHaveLength(1);
    expect(familyEvidence[0]!.sourceId).toBe(family.id);
  });

  it("returns evidence sorted deterministically by id", () => {
    const included = makeCapability({ sourceLabel: "Widget Sync Service" });
    const domain = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [included] });
    const component = makeLogicalComponent({ sourceLabel: "shared-core", origin: "workflow-family" });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included], domains: [domain] });
    const arch = makeArchitectureFixture({ components: [component], workflowFamilies: [family] });

    const evidence = gatherIdentityEvidence(model, arch);
    const ids = evidence.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("is deterministic: two gathers of the same input produce byte-identical output", () => {
    const included = makeCapability({ sourceLabel: "Widget Sync Service" });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included] });
    const arch = makeArchitectureFixture();
    const a = gatherIdentityEvidence(model, arch);
    const b = gatherIdentityEvidence(model, arch);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
