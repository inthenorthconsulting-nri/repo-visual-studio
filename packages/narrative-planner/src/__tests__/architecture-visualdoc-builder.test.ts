import type { RepositoryModel } from "@rvs/repository-model";
import { synthesizeArchitectureIntelligence, type NarrativeProfileId } from "@rvs/architecture-intelligence";
import { VisualDocSchema } from "@rvs/visualdoc-schema";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { buildArchitectureVisualDoc } from "../architecture-visualdoc-builder.js";

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

function buildRepositoryModel(): RepositoryModel {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 3, commitsLast90Days: 12 },
    files: { total: 4, byExtension: { ".ts": 3, ".yml": 1 }, sampledPaths: ["packages/cli/src/bin.ts", ".github/workflows/release.yml"] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json" },
    markdown_documents: [
      {
        path: "README.md",
        title: "sample-platform",
        leadParagraph: "sample-platform automates release governance for internal services.",
        sections: [{ heading: "Current limitations", depth: 2, text: "No support for multi-region deployments yet.", startLine: 10, endLine: 12 }],
      },
    ],
    ci_workflows: [{ path: ".github/workflows/release.yml" }],
  };
}

function buildArtifact() {
  const model = buildRepositoryModel();
  const { graph } = parseWorkflowText(APPROVAL_WORKFLOW, ".github/workflows/release.yml");
  return {
    artifact: synthesizeArchitectureIntelligence({
      model,
      workflowGraphs: [graph],
      terraformTopologies: [],
      gitCommit: model.git.commit,
      generatedAt: "2026-07-01T00:00:00.000Z",
    }),
    graph,
  };
}

const ARCHITECTURE_PROFILE_IDS: NarrativeProfileId[] = ["executive-overview", "architecture-review", "engineering-onboarding", "operating-review", "repository-audit"];

describe("buildArchitectureVisualDoc", () => {
  it.each(ARCHITECTURE_PROFILE_IDS)("produces a schema-valid deck for profile %s", (profileId) => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, profileId, "executive-dark", [graph], []);

    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
    expect(doc.scenes.every((s) => s.type === "architecture-intelligence" || s.type === "workflow" || s.type === "topology")).toBe(true);
    expect(doc.document.audience).toBe(profileId);
  });

  it("emits one architecture-intelligence scene per entry in the profile's sceneSequence, referencing the artifact by id", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const archScenes = doc.scenes.filter((s) => s.type === "architecture-intelligence");
    expect(archScenes).toHaveLength(11);
    for (const scene of archScenes) {
      if (scene.type !== "architecture-intelligence") throw new Error("unreachable");
      expect(scene.artifact_id).toBe(artifact.identity.id);
    }
  });

  it("omits supplementary workflow scenes for workflowDetailDefault=none (executive-overview)", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "executive-overview", "executive-dark", [graph], []);
    expect(doc.scenes.some((s) => s.type === "workflow")).toBe(false);
  });

  it("includes a representative workflow scene for workflowDetailDefault=representative (architecture-review)", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    expect(doc.scenes.some((s) => s.type === "workflow")).toBe(true);
  });

  it("rejects the repository-inventory profile, which has no architecture scene sequence", () => {
    const { artifact, graph } = buildArtifact();
    expect(() => buildArchitectureVisualDoc(artifact, "repository-inventory", "executive-dark", [graph], [])).toThrow(/repository-inventory/);
  });

  it("is deterministic: two builds of the same input are identical", () => {
    const { artifact, graph } = buildArtifact();
    const a = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const b = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    expect(a).toEqual(b);
  });
});

describe("headlineFor (conclusion-oriented headlines)", () => {
  it("keeps every architecture-intelligence scene headline under a 14-word budget", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    for (const scene of doc.scenes) {
      if (scene.type !== "architecture-intelligence") continue;
      expect(scene.headline.split(/\s+/).length).toBeLessThan(14);
    }
  });

  it("titles the executive-title scene with the system's display name", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const scene = doc.scenes.find((s) => s.type === "architecture-intelligence" && s.kind === "executive-title");
    expect(scene && "headline" in scene ? scene.headline : undefined).toBe(artifact.identity.name.displayLabel);
  });

  it("builds the logical-architecture headline from a real component count, not a static label", () => {
    const { artifact, graph } = buildArtifact();
    const doc = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const scene = doc.scenes.find((s) => s.type === "architecture-intelligence" && s.kind === "logical-architecture");
    const architecturalCount = artifact.components.filter((c) => c.origin !== "repository-directory").length || artifact.components.length;
    expect(scene && "headline" in scene ? scene.headline : undefined).toContain(String(architecturalCount));
  });

  it("produces the same headline for the same artifact across two independent builds", () => {
    const { artifact, graph } = buildArtifact();
    const docA = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const docB = buildArchitectureVisualDoc(artifact, "architecture-review", "executive-dark", [graph], []);
    const headlinesA = docA.scenes.filter((s) => s.type === "architecture-intelligence").map((s) => ("headline" in s ? s.headline : undefined));
    const headlinesB = docB.scenes.filter((s) => s.type === "architecture-intelligence").map((s) => ("headline" in s ? s.headline : undefined));
    expect(headlinesA).toEqual(headlinesB);
  });
});
