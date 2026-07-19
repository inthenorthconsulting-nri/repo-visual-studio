import { describe, expect, it } from "vitest";
import { discoverCapabilityCandidates } from "../candidates.js";
import { capabilityEvidenceId, capabilityId, capDomainId } from "../ids.js";
import { makeArchitectureFixture, makeLogicalComponent, makeRepositoryModel, makeWorkflowFamily, makeWorkflowGraph } from "./fixtures.js";

describe("id generators", () => {
  it("capabilityId is a pure function of its input", () => {
    expect(capabilityId("Widget Sync Service")).toBe(capabilityId("Widget Sync Service"));
  });

  it("capabilityId produces distinct ids for distinct inputs", () => {
    expect(capabilityId("Widget Sync Service")).not.toBe(capabilityId("Report Export Pipeline"));
  });

  it("capabilityId sanitizes unsafe characters", () => {
    expect(capabilityId("Widget Sync (beta)")).toBe("cap:capability:Widget-Sync--beta-");
  });

  it("capabilityEvidenceId is a pure function of (sourceLabel, sourcePath, index) and distinguishes on index", () => {
    const a = capabilityEvidenceId("Widget Sync", "packages/widget-sync/src/index.ts", 0);
    const b = capabilityEvidenceId("Widget Sync", "packages/widget-sync/src/index.ts", 1);
    expect(a).not.toBe(b);
    expect(a).toBe(capabilityEvidenceId("Widget Sync", "packages/widget-sync/src/index.ts", 0));
  });

  it("capDomainId is a pure function of its label", () => {
    expect(capDomainId("Widget Operations")).toBe(capDomainId("Widget Operations"));
    expect(capDomainId("Widget Operations")).not.toBe(capDomainId("Report Operations"));
  });
});

describe("determinism across full candidate discovery", () => {
  function buildInput() {
    const graph = makeWorkflowGraph("Widget Sync Pipeline", ".github/workflows/widget-sync.yml");
    const component = makeLogicalComponent({
      sourceLabel: "widget-sync-service",
      kind: "service",
      implementation: { filePaths: [], workflowGraphIds: [graph.id], terraformTopologyIds: [], entryPoints: ["packages/widget-sync-service/src/index.ts"] },
    });
    const family = makeWorkflowFamily({ sourceLabel: "Widget Sync", workflowGraphIds: [graph.id], representativeWorkflowGraphId: graph.id });
    const architecture = makeArchitectureFixture({ workflowFamilies: [family], components: [component] });
    const model = makeRepositoryModel();
    return { architecture, model, workflowGraphs: [graph], terraformTopologies: [] };
  }

  it("produces byte-identical candidate ids across two independent discovery runs of the same input", () => {
    const first = discoverCapabilityCandidates(buildInput());
    const second = discoverCapabilityCandidates(buildInput());
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first).toEqual(second);
  });

  it("produces a stable sort order (candidate ids ascending) across repeated runs", () => {
    const result = discoverCapabilityCandidates(buildInput());
    const ids = result.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
