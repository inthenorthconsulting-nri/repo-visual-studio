import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { synthesizeArchitectureIntelligence } from "../synthesize/index.js";
import { validateArchitectureIntelligenceStructure } from "../validate-structure.js";
import { makeRepositoryModel } from "./fixtures.js";

function buildModel() {
  const model = makeRepositoryModel();
  const { graph } = parseWorkflowText("name: Release\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build\n", ".github/workflows/release.yml");
  return synthesizeArchitectureIntelligence({
    model,
    workflowGraphs: [graph],
    terraformTopologies: [],
    gitCommit: model.git.commit,
    generatedAt: "2026-07-01T00:00:00.000Z",
  });
}

describe("validateArchitectureIntelligenceStructure — new Milestone 3.1 codes", () => {
  it("flags a generic (slug-derived) system name informationally", () => {
    const result = buildModel();
    // fixtures.ts's default README title equals project_name, so the name
    // already falls back to the slug — no mutation needed to exercise this.
    expect(result.identity.name.basis).not.toBe("readme-title");
    const warnings = validateArchitectureIntelligenceStructure(result);
    const warning = warnings.find((w) => w.code === "ARCH_INTEL_GENERIC_SYSTEM_NAME");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("informational");
  });

  it("does not flag a system name derived from a distinctive README title", () => {
    const result = buildModel();
    const withDistinctiveName = { ...result, identity: { ...result.identity, name: { ...result.identity.name, basis: "readme-title" } } };
    const warnings = validateArchitectureIntelligenceStructure(withDistinctiveName);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_GENERIC_SYSTEM_NAME")).toBe(false);
  });

  it("flags an over-granular capability-domain map", () => {
    const result = buildModel();
    const manyDomains = { ...result, capabilityDomains: Array.from({ length: 9 }, (_, i) => ({ id: `arch:domain:${i}`, label: { sourceLabel: `Domain ${i}`, displayLabel: `Domain ${i}`, shortLabel: `Domain ${i}` }, summary: result.identity.oneLineDescription, responsibilityIds: [], componentIds: [], workflowFamilyIds: [`fam-${i}`] })) };
    const warnings = validateArchitectureIntelligenceStructure(manyDomains);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR")).toBe(true);
  });

  it("does not flag a coarse capability-domain map at or under the threshold", () => {
    const result = buildModel();
    const warnings = validateArchitectureIntelligenceStructure(result);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR")).toBe(false);
  });

  it("flags a non-empty workflow family with no representative selected", () => {
    const result = buildModel();
    if (result.workflowFamilies.length === 0) throw new Error("fixture must produce at least one workflow family");
    const withoutRepresentative = { ...result, workflowFamilies: [{ ...result.workflowFamilies[0]!, representativeWorkflowGraphId: undefined }] };
    const warnings = validateArchitectureIntelligenceStructure(withoutRepresentative);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE")).toBe(true);
  });

  it("does not flag a workflow family that has a representative selected", () => {
    const result = buildModel();
    const warnings = validateArchitectureIntelligenceStructure(result);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE")).toBe(false);
  });
});
