import { describe, expect, it } from "vitest";
import { discoverCapabilityCandidates } from "../candidates.js";
import type { DiscoverCapabilityCandidatesInput } from "../candidates.js";
import { makeArchCapabilityDomain, makeArchitectureFixture, makeLogicalComponent, makeMarkdownDocument, makeMarkdownSection, makeRepositoryModel, makeTerraformTopology, makeWorkflowFamily, makeWorkflowGraph } from "./fixtures.js";

function baseInput(overrides: Partial<DiscoverCapabilityCandidatesInput> = {}): DiscoverCapabilityCandidatesInput {
  return {
    architecture: makeArchitectureFixture(),
    model: makeRepositoryModel({ markdown_documents: [] }),
    workflowGraphs: [],
    terraformTopologies: [],
    ...overrides,
  };
}

describe("discoverCapabilityCandidates — workflow-family source", () => {
  it("carries a 'workflow' evidence item per backing workflow graph, plus a 'runtime_entrypoint' for the representative graph", () => {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/widget-sync.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, workflowGraphs: [graph] }));

    const candidate = candidates.find((c) => c.sourceLabel === "Widget Sync");
    expect(candidate).toBeDefined();
    expect(candidate!.evidence.filter((e) => e.type === "workflow")).toHaveLength(1);
    expect(candidate!.evidence.filter((e) => e.type === "runtime_entrypoint")).toHaveLength(1);
    expect(candidate!.evidence.some((e) => e.type === "deprecated_marker")).toBe(false);
  });

  it("flags a workflow whose name suggests it is disabled/deprecated/archived with a 'deprecated_marker' evidence item, at 'suggested' confidence", () => {
    const graph = makeWorkflowGraph("Widget Sync (disabled)", ".github/workflows/widget-sync-disabled.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id] });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, workflowGraphs: [graph] }));

    const candidate = candidates.find((c) => c.sourceLabel === "Widget Sync");
    const marker = candidate!.evidence.find((e) => e.type === "deprecated_marker");
    expect(marker).toBeDefined();
    expect(marker!.confidence).toBe("suggested");
  });

  it("flags a workflow by its path (an 'archive/' directory) even when the workflow's own name looks ordinary", () => {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/archive/widget-sync.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id] });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, workflowGraphs: [graph] }));

    const candidate = candidates.find((c) => c.sourceLabel === "Widget Sync");
    expect(candidate!.evidence.some((e) => e.type === "deprecated_marker")).toBe(true);
  });

  it("prefers the owning capability domain's label over the workflow family's own label for domainHint, when a domain claims the family", () => {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/widget-sync.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id] });
    const architecture = makeArchitectureFixture({
      workflowFamilies: [family],
      capabilityDomains: [makeArchCapabilityDomain({ sourceLabel: "Widget Operations", workflowFamilyIds: [family.id] })],
    });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, workflowGraphs: [graph] }));
    const candidate = candidates.find((c) => c.sourceLabel === "Widget Sync");
    expect(candidate!.domainHint).toBe("Widget Operations");
  });
});

describe("discoverCapabilityCandidates — runtime-component source", () => {
  it("produces a candidate for a 'cli' component, with a runtime_entrypoint plus one implementation item per entry point", () => {
    const component = makeLogicalComponent({
      sourceLabel: "widget-cli",
      kind: "cli",
      implementation: { filePaths: [], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: ["packages/widget-cli/src/bin.ts", "packages/widget-cli/src/bin2.ts"] },
    });
    const architecture = makeArchitectureFixture({ components: [component] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture }));

    const candidate = candidates.find((c) => c.sourceLabel === "widget-cli");
    expect(candidate).toBeDefined();
    expect(candidate!.evidence.filter((e) => e.type === "runtime_entrypoint")).toHaveLength(1);
    expect(candidate!.evidence.filter((e) => e.type === "implementation")).toHaveLength(2);
  });

  it("produces a candidate for a 'service' component", () => {
    const component = makeLogicalComponent({ sourceLabel: "widget-sync-service", kind: "service" });
    const architecture = makeArchitectureFixture({ components: [component] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture }));
    expect(candidates.some((c) => c.sourceLabel === "widget-sync-service")).toBe(true);
  });

  it("never produces a candidate for a component kind other than cli/service (e.g. a plain library)", () => {
    const component = makeLogicalComponent({ sourceLabel: "widget-shared-lib", kind: "library" });
    const architecture = makeArchitectureFixture({ components: [component] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture }));
    expect(candidates.some((c) => c.sourceLabel === "widget-shared-lib")).toBe(false);
  });
});

describe("discoverCapabilityCandidates — terraform source", () => {
  it("produces no terraform candidates at all when no terraform topologies were supplied, even if terraform-module components exist", () => {
    const component = makeLogicalComponent({ sourceLabel: "widget-infra", kind: "infrastructure-module", origin: "terraform-module" });
    const architecture = makeArchitectureFixture({ components: [component] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, terraformTopologies: [] }));
    expect(candidates.some((c) => c.sourceLabel === "widget-infra")).toBe(false);
  });

  it("produces a 'deployment' + 'configuration', externally-runtime-dependent candidate for a terraform-module component when topologies are present", () => {
    const component = makeLogicalComponent({ sourceLabel: "widget-infra", kind: "infrastructure-module", origin: "terraform-module" });
    const architecture = makeArchitectureFixture({ components: [component] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, terraformTopologies: [makeTerraformTopology()] }));

    const candidate = candidates.find((c) => c.sourceLabel === "widget-infra");
    expect(candidate).toBeDefined();
    expect(candidate!.evidence).toHaveLength(2);
    expect(candidate!.evidence.map((e) => e.type).sort()).toEqual(["configuration", "deployment"]);
    expect(candidate!.isExternalRuntimeDependent).toBe(true);
  });
});

describe("discoverCapabilityCandidates — documentation source", () => {
  it("produces a documentation-only candidate for a section whose text reads as a capability claim (matches an action verb at the start)", () => {
    const section = makeMarkdownSection({ heading: "Widget provisioning", text: "Provides automated widget provisioning across every configured environment." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));

    const candidate = candidates.find((c) => c.sourceLabel === "Widget provisioning");
    expect(candidate).toBeDefined();
    expect(candidate!.evidence).toHaveLength(1);
    expect(candidate!.evidence[0]!.type).toBe("documentation");
    expect(candidate!.evidence[0]!.confidence).toBe("suggested");
  });

  it("produces a documentation-only candidate for a section carrying an incomplete-signal keyword, even without a leading action verb", () => {
    const section = makeMarkdownSection({ heading: "Future plans", text: "This area is planned for a future release and is not implemented yet." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    const candidate = candidates.find((c) => c.sourceLabel === "Future plans");
    expect(candidate).toBeDefined();
    expect(candidate!.matchedIncompleteSignals.length).toBeGreaterThan(0);
  });

  it("produces no candidate for a section that neither reads as a capability claim nor carries an incomplete-signal keyword", () => {
    const section = makeMarkdownSection({ heading: "License", text: "This project is licensed under the MIT license." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "License")).toBe(false);
  });
});

describe("discoverCapabilityCandidates — report-narrative filtering (discovery-time noise suppression)", () => {
  it("produces no candidate for a heading that itself reads as milestone/changelog report narrative, even though its body would otherwise match a capability-claim verb", () => {
    const section = makeMarkdownSection({
      heading: "Milestone 3 — Architecture Intelligence Engine",
      depth: 2,
      text: "Automates synthesis of architecture intelligence across the whole repository.",
    });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === section.heading)).toBe(false);
  });

  it("produces no candidate for a 'Changelog' heading carrying an incomplete-signal keyword in its body", () => {
    const section = makeMarkdownSection({ heading: "Changelog", depth: 2, text: "Planned for a future release: multi-region support." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "Changelog")).toBe(false);
  });

  it("produces no candidate for a 'self-hosting proof' heading (a retrospective bootstrapping writeup, not a product capability)", () => {
    const section = makeMarkdownSection({ heading: "Self-hosting proof", depth: 2, text: "Provides a complete walkthrough of running the tool against its own repository." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "Self-hosting proof")).toBe(false);
  });

  it("produces no candidate for a numbered-outline subsection (e.g. '2. Defects found and fixed') nested under a milestone-report heading, even though its own heading carries no report vocabulary", () => {
    const milestoneHeading = makeMarkdownSection({ heading: "Milestone 3 — Architecture Intelligence Engine", depth: 2, text: "Overview of this milestone's scope." });
    const subsection = makeMarkdownSection({ heading: "2. Defects found and fixed", depth: 3, text: "Provides a record of defects discovered and corrected during this milestone." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [milestoneHeading, subsection] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "2. Defects found and fixed")).toBe(false);
  });

  it("produces no candidate for a numbered-outline heading anywhere in a document that independently reads as an engineering report elsewhere, even outside that heading's own ancestor subtree", () => {
    const milestoneHeading = makeMarkdownSection({ heading: "Milestone 1 — HTML Slide MVP", depth: 2, text: "Overview." });
    const interlude = makeMarkdownSection({ heading: "Packaging Hardening Interlude", depth: 2, text: "An interlude between milestones." });
    const numberedUnderInterlude = makeMarkdownSection({ heading: "13. Remaining limitations", depth: 3, text: "Provides a summary of limitations not yet addressed." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [milestoneHeading, interlude, numberedUnderInterlude] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "13. Remaining limitations")).toBe(false);
  });

  it("positive control: a numbered heading in a document with NO report-vocabulary heading anywhere still produces a candidate (numbered-outline alone is never sufficient)", () => {
    const numberedSection = makeMarkdownSection({ heading: "2. Configuration", depth: 2, text: "Provides configuration options for connecting to the deployment target." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [numberedSection] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "2. Configuration")).toBe(true);
  });

  it("positive control: a normal product-documentation heading (e.g. '## Authentication' under a plain product doc) still produces a documentation candidate, proving the filter is not overcorrecting", () => {
    const section = makeMarkdownSection({ heading: "Authentication", depth: 2, text: "Provides single sign-on authentication for every configured environment." });
    const doc = makeMarkdownDocument({ path: "README.md", title: "MyApp", sections: [section] });
    const model = makeRepositoryModel({ markdown_documents: [doc] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));

    const candidate = candidates.find((c) => c.sourceLabel === "Authentication");
    expect(candidate).toBeDefined();
    expect(candidate!.evidence[0]!.type).toBe("documentation");
  });

  it("positive control: a '## Self-hosting' heading describing an actual product feature (no 'proof/report/writeup' suffix) still produces a candidate, distinct from a 'Self-hosting proof' report heading", () => {
    const section = makeMarkdownSection({ heading: "Self-hosting", depth: 2, text: "Automates visualizing and provisioning this repository against itself end to end." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const candidates = discoverCapabilityCandidates(baseInput({ model }));
    expect(candidates.some((c) => c.sourceLabel === "Self-hosting")).toBe(true);
  });
});

describe("discoverCapabilityCandidates — merging duplicate candidates (scenario: same capability visible from two evidence angles)", () => {
  function buildOverlappingInput() {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/widget-sync.yml");
    const component = makeLogicalComponent({
      sourceLabel: "widget-sync-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [graph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-sync-service/src/index.ts"] },
    });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family], components: [component] });
    return baseInput({ architecture, workflowGraphs: [graph] });
  }

  it("merges a workflow-family candidate and a runtime-component candidate that share both a workflow id and a component id into exactly one candidate", () => {
    const candidates = discoverCapabilityCandidates(buildOverlappingInput());
    expect(candidates).toHaveLength(1);
  });

  it("the merged candidate's evidence is the union of both source candidates' evidence, not just one side's", () => {
    const candidates = discoverCapabilityCandidates(buildOverlappingInput());
    const merged = candidates[0]!;
    // family side contributes "workflow" + "implementation" (the workflow file itself) + "runtime_entrypoint" for the representative;
    // component side contributes its own "runtime_entrypoint" + "implementation" (its entry point file).
    expect(merged.evidence.some((e) => e.type === "workflow")).toBe(true);
    expect(merged.evidence.filter((e) => e.type === "implementation")).toHaveLength(2);
    expect(merged.evidence.filter((e) => e.type === "runtime_entrypoint")).toHaveLength(2);
    expect(merged.evidence).toHaveLength(5);
  });

  it("deduplicates the merged candidate's workflows and logicalComponents rather than concatenating with duplicates", () => {
    const candidates = discoverCapabilityCandidates(buildOverlappingInput());
    const merged = candidates[0]!;
    expect(new Set(merged.workflows).size).toBe(merged.workflows.length);
    expect(new Set(merged.logicalComponents).size).toBe(merged.logicalComponents.length);
  });

  it("does NOT merge a workflow-family candidate with an unrelated documentation candidate, since a documentation candidate never carries workflow or component overlap", () => {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/widget-sync.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const section = makeMarkdownSection({ heading: "Widget Sync", text: "Automates the same widget synchronization behavior described elsewhere." });
    const model = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });
    const candidates = discoverCapabilityCandidates(baseInput({ architecture, workflowGraphs: [graph], model }));
    // Both candidates happen to derive from "Widget Sync" text, but the documentation candidate has empty
    // workflows AND empty logicalComponents — merging requires non-empty overlap on BOTH axes, so they
    // must survive as two distinct candidates rather than being silently collapsed into one.
    expect(candidates).toHaveLength(2);
  });
});

describe("discoverCapabilityCandidates — overall ordering", () => {
  it("returns candidates sorted by id ascending, independent of discovery-source order", () => {
    const ids = discoverCapabilityCandidates(
      baseInput({
        architecture: makeArchitectureFixture({
          components: [makeLogicalComponent({ sourceLabel: "zzz-service", kind: "service" }), makeLogicalComponent({ sourceLabel: "aaa-service", kind: "service" })],
        }),
      }),
    ).map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
