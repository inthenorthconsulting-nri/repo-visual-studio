import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import { synthesizeArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { EvidenceManifest } from "@rvs/core";
import type { RepositoryModel } from "@rvs/repository-model";
import type { ArchitectureSceneKind, VisualDoc } from "@rvs/visualdoc-schema";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { renderVisualDocToHtml } from "../render.js";
import type { DesignTokens } from "../tokens.js";

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

function buildArtifact(): ArchitectureIntelligence {
  const model = buildRepositoryModel();
  const { graph } = parseWorkflowText(APPROVAL_WORKFLOW, ".github/workflows/release.yml");
  return synthesizeArchitectureIntelligence({
    model,
    workflowGraphs: [graph],
    terraformTopologies: [],
    gitCommit: model.git.commit,
    generatedAt: "2026-07-01T00:00:00.000Z",
  });
}

const tokens: DesignTokens = {
  name: "executive-dark",
  version: "1.0.0",
  colors: {
    background: "#000",
    surface: "#111",
    text_primary: "#fff",
    text_secondary: "#aaa",
    accent: "#5b8cff",
    border: "#333",
    success: "#0f0",
    warning: "#ff0",
  },
  typography: { display: "serif", heading: "sans", body: "sans", code: "mono" },
  spacing: { unit: 8 },
  motion: { fast: 100, normal: 200, slow: 300 },
};

const emptyEvidence: EvidenceManifest = { generated_at: "2026-01-01T00:00:00.000Z", git_commit: "abc123", claims: [] };

const SCENE_KINDS: ArchitectureSceneKind[] = [
  "executive-title",
  "executive-summary",
  "problem-and-response",
  "platform-responsibilities",
  "system-context",
  "logical-architecture",
  "capability-map",
  "operating-model",
  "architecture-flow",
  "boundary-map",
  "outcomes",
  "risk-summary",
  "risk-and-dependency-summary",
  "workflow-family-map",
  "repository-map",
  "evidence-confidence",
  "decision-or-next-step",
];

function buildDoc(kind: ArchitectureSceneKind, artifactId: string): VisualDoc {
  return {
    version: 1,
    document: { type: "presentation", title: "Architecture review", aspect_ratio: "16:9", audience: "architecture-review", theme: "executive-dark" },
    scenes: [{ id: `scene-${kind}`, type: "architecture-intelligence", headline: `Scene: ${kind}`, evidence: [], artifact_id: artifactId, kind, focus_ids: [] }],
  };
}

describe("renderVisualDocToHtml with architecture-intelligence scenes", () => {
  it("renders every architecture scene kind without throwing", () => {
    const artifact = buildArtifact();
    for (const kind of SCENE_KINDS) {
      const html = renderVisualDocToHtml(buildDoc(kind, artifact.identity.id), tokens, emptyEvidence, { gitCommit: "abc123" }, [], [], [artifact]);
      expect(html).toContain(`Scene: ${kind}`);
      expect(html).toContain('data-scene-type="architecture-intelligence"');
    }
  });

  it("qualifies unresolved/suggested statements instead of presenting them as fact", () => {
    const artifact = buildArtifact();
    const html = renderVisualDocToHtml(buildDoc("problem-and-response", artifact.identity.id), tokens, emptyEvidence, { gitCommit: "abc123" }, [], [], [artifact]);
    const unresolvedTargetUser = artifact.purpose.targetUsers.find((s) => s.inference === "unresolved");
    if (unresolvedTargetUser) {
      expect(html).not.toContain(unresolvedTargetUser.value);
    }
  });

  it("throws when artifact_id does not resolve to a supplied artifact", () => {
    expect(() => renderVisualDocToHtml(buildDoc("executive-title", "arch:identity:does-not-exist"), tokens, emptyEvidence, { gitCommit: "abc123" }, [], [], [])).toThrow(
      /unresolved artifact_id/,
    );
  });

  it("escapes HTML characters embedded in evidenced README text", () => {
    const model = buildRepositoryModel();
    model.markdown_documents[0]!.leadParagraph = "sample-platform <img src=x onerror=alert(1)> automates release governance.";
    const { graph } = parseWorkflowText(APPROVAL_WORKFLOW, ".github/workflows/release.yml");
    const artifact = synthesizeArchitectureIntelligence({
      model,
      workflowGraphs: [graph],
      terraformTopologies: [],
      gitCommit: model.git.commit,
      generatedAt: "2026-07-01T00:00:00.000Z",
    });
    const html = renderVisualDocToHtml(buildDoc("executive-title", artifact.identity.id), tokens, emptyEvidence, { gitCommit: "abc123" }, [], [], [artifact]);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
