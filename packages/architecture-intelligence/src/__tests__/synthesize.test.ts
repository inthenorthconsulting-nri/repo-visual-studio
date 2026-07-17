import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { synthesizeArchitectureIntelligence } from "../synthesize/index.js";
import { validateArchitectureIntelligenceStructure } from "../validate-structure.js";
import { makeRepositoryModel, makeTerraformTopology } from "./fixtures.js";

const APPROVAL_WORKFLOW = `
name: Release Governance
on:
  push:
    branches: [main]
  workflow_dispatch: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
  approve-release:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - run: echo "awaiting approval"
  release:
    needs: approve-release
    runs-on: ubuntu-latest
    steps:
      - run: npm run release
`;

function buildModel() {
  const model = makeRepositoryModel();
  const { graph } = parseWorkflowText(APPROVAL_WORKFLOW, ".github/workflows/release.yml");
  const topology = makeTerraformTopology();
  return synthesizeArchitectureIntelligence({
    model,
    workflowGraphs: [graph],
    terraformTopologies: [topology],
    gitCommit: model.git.commit,
    generatedAt: "2026-07-01T00:00:00.000Z",
  });
}

describe("synthesizeArchitectureIntelligence", () => {
  it("is deterministic: two syntheses of the same input are identical", () => {
    expect(buildModel()).toEqual(buildModel());
  });

  it("synthesizes a confirmed system identity from the README lead paragraph", () => {
    const result = buildModel();
    expect(result.identity.oneLineDescription.inference).toBe("confirmed");
    expect(result.identity.oneLineDescription.evidence[0]?.path).toBe("README.md");
  });

  it("marks target users as unresolved when no audience section exists, and raises a question about it", () => {
    const result = buildModel();
    expect(result.purpose.targetUsers[0]?.inference).toBe("unresolved");
    expect(result.questions.some((q) => q.reason === "unresolved-claim")).toBe(true);
  });

  it("captures the documented scope boundary as a confirmed statement", () => {
    const result = buildModel();
    expect(result.purpose.scopeBoundaries[0]?.value).toContain("multi-region");
    expect(result.purpose.scopeBoundaries[0]?.inference).toBe("confirmed");
  });

  it("derives a Manual operator actor from the workflow_dispatch trigger and an Approver actor from the approval node", () => {
    const result = buildModel();
    const labels = result.actors.map((a) => a.label.sourceLabel).sort();
    expect(labels).toContain("Manual operator");
  });

  it("derives an external system from the non-generic Terraform provider", () => {
    const result = buildModel();
    expect(result.externalSystems.map((e) => e.label.sourceLabel)).toContain("aws");
  });

  it("derives an approval flow between the approver actor and the release-governance component", () => {
    const result = buildModel();
    const approvalFlow = result.flows.find((f) => f.kind === "approval");
    expect(approvalFlow).toBeDefined();
  });

  it("merges same-family manual-trigger flows into one, instead of colliding on a duplicate id", () => {
    // Two distinct workflow files ("release" and "deploy") both land in the
    // "Release and maintenance" family and both have workflow_dispatch, so
    // they derive the identical (actor, family-component) flow. This must
    // merge into a single flow with combined evidence, not two flows sharing
    // one id (which validateArchitectureIntelligenceStructure would reject
    // as ARCH_INTEL_DUPLICATE_ID).
    const model = makeRepositoryModel();
    const { graph: releaseGraph } = parseWorkflowText(APPROVAL_WORKFLOW, ".github/workflows/release.yml");
    const { graph: deployGraph } = parseWorkflowText(
      `
name: Deploy Service
on:
  workflow_dispatch: {}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
`,
      ".github/workflows/deploy.yml",
    );
    const result = synthesizeArchitectureIntelligence({
      model,
      workflowGraphs: [releaseGraph, deployGraph],
      terraformTopologies: [],
      gitCommit: model.git.commit,
      generatedAt: "2026-07-01T00:00:00.000Z",
    });

    const triggerFlows = result.flows.filter((f) => f.kind === "trigger");
    expect(triggerFlows).toHaveLength(1);
    expect(triggerFlows[0]?.evidence.map((e) => e.path).sort()).toEqual([".github/workflows/deploy.yml", ".github/workflows/release.yml"]);

    const errors = validateArchitectureIntelligenceStructure(result).filter((w) => w.severity === "error");
    expect(errors).toEqual([]);
  });

  it("derives a production deployment-environment boundary from the environment node", () => {
    const result = buildModel();
    expect(result.boundaries.map((b) => b.label.sourceLabel)).toContain("production");
  });

  it("derives observability from the Terraform resource category, not fabricated", () => {
    const result = buildModel();
    expect(result.operatingModel.observability[0]?.inference).toBe("confirmed");
  });

  it("produces a fully self-consistent model with no structural warnings", () => {
    const result = buildModel();
    const warnings = validateArchitectureIntelligenceStructure(result);
    const errors = warnings.filter((w) => w.severity === "error");
    expect(errors).toEqual([]);
  });

  it("tracks a non-zero confidence summary that accounts for every collected statement", () => {
    const result = buildModel();
    const { confirmed, derived, suggested, unresolved, total } = result.metadata.confidence;
    expect(confirmed + derived + suggested + unresolved).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  it("never fabricates a quantified outcome", () => {
    const result = buildModel();
    for (const outcome of result.outcomes) {
      expect(outcome.quantified).toBeUndefined();
    }
  });
});

describe("validateArchitectureIntelligenceStructure", () => {
  it("flags a model with zero components", () => {
    const result = buildModel();
    const empty = { ...result, components: [] };
    const warnings = validateArchitectureIntelligenceStructure(empty);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_NO_COMPONENTS")).toBe(true);
  });

  it("flags a duplicated entity id", () => {
    const result = buildModel();
    if (result.components.length < 2) throw new Error("fixture must produce at least two components");
    const withDuplicate = { ...result, components: [result.components[0]!, { ...result.components[1]!, id: result.components[0]!.id }] };
    const warnings = validateArchitectureIntelligenceStructure(withDuplicate);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_DUPLICATE_ID")).toBe(true);
  });

  it("flags a dangling flow reference", () => {
    const result = buildModel();
    const withDangling = { ...result, flows: [{ ...result.flows[0]!, fromId: "arch:actor:does-not-exist" }] };
    const warnings = validateArchitectureIntelligenceStructure(withDangling);
    expect(warnings.some((w) => w.code === "ARCH_INTEL_DANGLING_FLOW")).toBe(true);
  });
});
