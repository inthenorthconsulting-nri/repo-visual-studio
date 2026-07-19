import { describe, expect, it } from "vitest";
import { synthesizeCapabilities } from "../index.js";
import type { SynthesizeCapabilitiesInput } from "../index.js";
import { exportCapabilitiesMarkdown } from "../exporter.js";
import { validateCapabilityModelStructure } from "../validation.js";
import {
  makeArchCapabilityDomain,
  makeArchitectureFixture,
  makeLogicalComponent,
  makeMarkdownDocument,
  makeMarkdownSection,
  makeRepositoryModel,
  makeTerraformTopology,
  makeWorkflowFamily,
  makeWorkflowGraph,
} from "./fixtures.js";

/**
 * Integration coverage for the full pipeline entrypoint,
 * synthesizeCapabilities(): Repository Evidence -> Architecture Intelligence
 * -> Capability Intelligence, exercised end-to-end through real discovery
 * (never hand-built CapabilityCandidate objects) so these tests catch
 * regressions in how the stages compose, not just in any one stage alone.
 *
 * Every scenario is written to demonstrate the governing principle: a
 * candidate found by discovery is never automatically a capability. The
 * pipeline must default toward exclude/qualify/roadmap/gap whenever
 * evidence is incomplete, and only promote to "include" when the full
 * evidence-and-maturity bar is actually met.
 */

function baseSynthesizeInput(overrides: Partial<SynthesizeCapabilitiesInput> = {}): SynthesizeCapabilitiesInput {
  return {
    architecture: makeArchitectureFixture(),
    model: makeRepositoryModel({ markdown_documents: [] }),
    workflowGraphs: [],
    terraformTopologies: [],
    gitCommit: "abc1234",
    generatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Scenario 1 — a well-evidenced, actively-run workflow merged with its owning service component is included, but capped at 'implemented' (never 'operational')", () => {
  it("reaches inclusion=include, status=implemented, and never falsely reaches 'operational' since structural discovery alone cannot produce adoption/documentation evidence", () => {
    const graph = makeWorkflowGraph(
      "Widget Sync Pipeline",
      ".github/workflows/widget-sync.yml",
      "name: Widget Sync Pipeline\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n      - name: Run tests\n        run: npm test\n",
    );
    const component = makeLogicalComponent({
      sourceLabel: "widget-sync-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [graph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-sync-service/src/index.ts"] },
      sourcePaths: [
        "packages/widget-sync-service/src/index.ts",
        "packages/widget-sync-service/src/sync.ts",
        "packages/widget-sync-service/src/reconcile.ts",
        "packages/widget-sync-service/src/__tests__/sync.test.ts",
      ],
    });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family], components: [component] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, workflowGraphs: [graph] }));

    // The workflow-family candidate and the runtime-component candidate share both the
    // workflow id and the component id, so discovery merges them into exactly one
    // candidate before this capability is built (see candidates.ts mergeDuplicateCandidates).
    expect(model.evidenceSummary.totalCandidates).toBe(1);
    const capability = model.includedCapabilities[0];
    expect(capability).toBeDefined();
    expect(capability!.inclusion).toBe("include");
    expect(capability!.status).toBe("implemented");
    expect(capability!.status).not.toBe("operational");
    expect(capability!.readiness.executionScore).toBeGreaterThan(0);
    expect(capability!.readiness.verificationScore).toBeGreaterThan(0);
  });
});

describe("Scenario 2 — a workflow family with no backing workflow graphs at all carries zero evidence and is excluded, never silently included", () => {
  it("classifies as status=unknown and excludes with INSUFFICIENT_IMPLEMENTATION_EVIDENCE", () => {
    const family = makeWorkflowFamily({ sourceLabel: "Widget Ghost Automation", workflowGraphIds: [] });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture }));

    expect(model.includedCapabilities).toHaveLength(0);
    expect(model.qualifiedCapabilities).toHaveLength(0);
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "Widget Ghost Automation");
    expect(excluded).toBeDefined();
    expect(excluded!.status).toBe("unknown");
    expect(excluded!.reasonCodes).toContain("INSUFFICIENT_IMPLEMENTATION_EVIDENCE");
  });
});

describe("Scenario 3 — a CLI component with only a bare runtime entrypoint (no implementation files, no tests, no workflow) is excluded as scaffold-only", () => {
  it("never gets promoted merely because a runtime-entrypoint file exists", () => {
    const component = makeLogicalComponent({
      sourceLabel: "widget-cli",
      kind: "cli",
      sourcePaths: ["packages/widget-cli/src/bin.ts"],
      implementation: { filePaths: [], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] },
    });
    const architecture = makeArchitectureFixture({ components: [component] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture }));

    expect(model.includedCapabilities.some((c) => c.naming.sourceLabel === "widget-cli")).toBe(false);
    expect(model.qualifiedCapabilities.some((c) => c.naming.sourceLabel === "widget-cli")).toBe(false);
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "widget-cli");
    expect(excluded).toBeDefined();
    expect(excluded!.status).toBe("scaffolded");
    expect(excluded!.reasonCodes).toContain("SCAFFOLD_ONLY");
  });
});

describe("Scenario 4 — a workflow whose name/path marks it disabled, but which still carries confirmed implementation evidence, is excluded for contradictory evidence rather than guessed either way", () => {
  it("routes to exclude with UNRESOLVED_CONTRADICTORY_EVIDENCE, confidence unresolved, instead of silently picking deprecated or included", () => {
    const graph = makeWorkflowGraph("Widget Sync (disabled)", ".github/workflows/widget-sync-disabled.yml");
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync Legacy", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, workflowGraphs: [graph] }));

    expect(model.includedCapabilities.some((c) => c.naming.sourceLabel === "Widget Sync Legacy")).toBe(false);
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "Widget Sync Legacy");
    expect(excluded).toBeDefined();
    expect(excluded!.reasonCodes).toContain("UNRESOLVED_CONTRADICTORY_EVIDENCE");
    expect(excluded!.confidence).toBe("unresolved");
  });
});

describe("Scenario 5 — Terraform-provisioned infrastructure with only deployment+configuration evidence and no usage/adoption signal is conservatively excluded, not assumed operational", () => {
  it("never appears in includedCapabilities or qualifiedCapabilities purely because infrastructure was provisioned", () => {
    const component = makeLogicalComponent({ sourceLabel: "widget-infra", kind: "infrastructure-module", origin: "terraform-module" });
    const architecture = makeArchitectureFixture({ components: [component] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, terraformTopologies: [makeTerraformTopology()] }));

    expect(model.includedCapabilities.some((c) => c.naming.sourceLabel === "widget-infra")).toBe(false);
    expect(model.qualifiedCapabilities.some((c) => c.naming.sourceLabel === "widget-infra")).toBe(false);
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "widget-infra");
    expect(excluded).toBeDefined();
    expect(excluded!.reasonCodes.length).toBeGreaterThan(0);
  });
});

describe("Scenario 6 — a README section that reads like a capability claim but only has a TODO marker behind it is excluded as documentation-only, never promoted on prose alone", () => {
  it("excludes with DOCUMENTATION_ONLY despite the text starting with an action verb", () => {
    const section = makeMarkdownSection({
      heading: "Widget migration",
      text: "Migrates legacy widget records to the new schema. TODO: document the full migration checklist here.",
    });
    const model_ = makeRepositoryModel({ markdown_documents: [makeMarkdownDocument({ sections: [section] })] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ model: model_ }));

    expect(model.includedCapabilities.some((c) => c.naming.sourceLabel === "Widget migration")).toBe(false);
    expect(model.roadmapCapabilities.some((c) => c.naming.sourceLabel === "Widget migration")).toBe(false);
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "Widget migration");
    expect(excluded).toBeDefined();
    expect(excluded!.reasonCodes).toContain("DOCUMENTATION_ONLY");
  });
});

describe("Scenario 7 — the same capability visible from both a workflow-family grouping and its runtime component survives synthesis as exactly one capability, never a duplicate", () => {
  it("produces exactly one entry across included+qualified+excluded+roadmap+gap capabilities for the source label, not two", () => {
    const graph = makeWorkflowGraph("Widget Report Pipeline", ".github/workflows/widget-report.yml");
    const component = makeLogicalComponent({
      sourceLabel: "widget-report-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [graph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-report-service/src/index.ts"] },
    });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Report Export", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family], components: [component] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, workflowGraphs: [graph] }));

    // Both the family label ("Widget Report Export") and the component label
    // ("widget-report-service") describe the very same underlying capability;
    // exactly one final entry must exist across every bucket, whichever
    // source label the merge happened to keep as its identity.
    const allBuckets = [...model.includedCapabilities, ...model.qualifiedCapabilities, ...model.roadmapCapabilities, ...model.gapCapabilities];
    expect(allBuckets.length + model.excludedCandidates.length).toBe(1);
    expect(model.evidenceSummary.totalCandidates).toBe(1);
  });
});

describe("Scenario 8 — capabilities across multiple capability domains are grouped correctly, and the whole model passes structural validation with zero warnings", () => {
  it("places each capability under its declared domain and produces no CapIntelWarning for a well-formed multi-domain model", () => {
    const syncGraph = makeWorkflowGraph(
      "Widget Sync Pipeline",
      ".github/workflows/widget-sync.yml",
      "name: Widget Sync Pipeline\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n      - name: Run tests\n        run: npm test\n",
    );
    const reportGraph = makeWorkflowGraph(
      "Widget Report Pipeline",
      ".github/workflows/widget-report.yml",
      "name: Widget Report Pipeline\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n      - name: Run tests\n        run: npm test\n",
    );
    const syncComponent = makeLogicalComponent({
      sourceLabel: "widget-sync-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [syncGraph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-sync-service/src/index.ts"] },
      sourcePaths: ["packages/widget-sync-service/src/index.ts", "packages/widget-sync-service/src/sync.ts", "packages/widget-sync-service/src/__tests__/sync.test.ts"],
    });
    const reportComponent = makeLogicalComponent({
      sourceLabel: "widget-report-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [reportGraph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-report-service/src/index.ts"] },
      sourcePaths: ["packages/widget-report-service/src/index.ts", "packages/widget-report-service/src/export.ts", "packages/widget-report-service/src/__tests__/export.test.ts"],
    });
    const syncFamily = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [syncGraph.id], representativeWorkflowGraphId: syncGraph.id });
    const reportFamily = makeWorkflowFamily({ sourceLabel: "Widget Report Export", workflowGraphIds: [reportGraph.id], representativeWorkflowGraphId: reportGraph.id });
    const architecture = makeArchitectureFixture({
      workflowFamilies: [syncFamily, reportFamily],
      components: [syncComponent, reportComponent],
      // Merging keeps the runtime-component candidate's domainHint (componentIds-based),
      // not the workflow-family's, since the component candidate sorts first by id and
      // becomes the merge base — so domain ownership must be declared via componentIds here.
      capabilityDomains: [
        makeArchCapabilityDomain({ sourceLabel: "Widget Synchronization", workflowFamilyIds: [syncFamily.id], componentIds: [syncComponent.id] }),
        makeArchCapabilityDomain({ sourceLabel: "Widget Reporting", workflowFamilyIds: [reportFamily.id], componentIds: [reportComponent.id] }),
      ],
    });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, workflowGraphs: [syncGraph, reportGraph] }));

    expect(model.domains.length).toBeGreaterThanOrEqual(2);
    const syncDomain = model.domains.find((d) => d.displayName === "Widget Synchronization");
    const reportDomain = model.domains.find((d) => d.displayName === "Widget Reporting");
    expect(syncDomain?.capabilities.some((c) => c.naming.sourceLabel === "widget-sync-service")).toBe(true);
    expect(reportDomain?.capabilities.some((c) => c.naming.sourceLabel === "widget-report-service")).toBe(true);

    const warnings = validateCapabilityModelStructure(model);
    expect(warnings).toEqual([]);
  });
});

describe("Scenario 9 — the conservative inclusion decision actually manifests in the exported CAPABILITIES.md: an excluded/scaffolded candidate is never mentioned by default, an included capability is", () => {
  it("closes the loop from repository evidence to the rendered document", () => {
    const graph = makeWorkflowGraph(
      "Widget Sync Pipeline",
      ".github/workflows/widget-sync.yml",
      "name: Widget Sync Pipeline\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n      - name: Run tests\n        run: npm test\n",
    );
    const goodComponent = makeLogicalComponent({
      sourceLabel: "widget-sync-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [graph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-sync-service/src/index.ts"] },
      sourcePaths: ["packages/widget-sync-service/src/index.ts", "packages/widget-sync-service/src/sync.ts", "packages/widget-sync-service/src/__tests__/sync.test.ts"],
    });
    const scaffoldComponent = makeLogicalComponent({
      sourceLabel: "widget-scratch-cli",
      kind: "cli",
      sourcePaths: ["packages/widget-scratch-cli/src/bin.ts"],
      implementation: { filePaths: [], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] },
    });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family], components: [goodComponent, scaffoldComponent] });

    const model = synthesizeCapabilities(baseSynthesizeInput({ architecture, workflowGraphs: [graph] }));
    const excluded = model.excludedCandidates.find((c) => c.sourceLabel === "widget-scratch-cli");
    expect(excluded).toBeDefined();
    // The workflow-family and its runtime component merge into one capability (see
    // Scenario 7); assert on the model's own output rather than a hardcoded label.
    expect(model.includedCapabilities).toHaveLength(1);
    const included = model.includedCapabilities[0]!;

    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain(included.displayName);
    expect(markdown).not.toContain(excluded!.displayName);
    expect(markdown).not.toContain("## Excluded candidates");
  });
});

describe("Scenario 10 — a repository with no discoverable candidates at all still produces a well-formed, empty CapabilityModel rather than crashing or fabricating content", () => {
  it("returns empty capability buckets with consistent, zeroed evidenceSummary/generationMetadata counts", () => {
    const model = synthesizeCapabilities(baseSynthesizeInput());

    expect(model.includedCapabilities).toEqual([]);
    expect(model.qualifiedCapabilities).toEqual([]);
    expect(model.excludedCandidates).toEqual([]);
    expect(model.roadmapCapabilities).toEqual([]);
    expect(model.gapCapabilities).toEqual([]);
    expect(model.domains).toEqual([]);
    expect(model.evidenceSummary.totalCandidates).toBe(0);
    expect(model.generationMetadata.candidateCount).toBe(0);

    const warnings = validateCapabilityModelStructure(model);
    expect(warnings).toEqual([]);

    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain("## Capability summary");
  });
});
