import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceManifest } from "@rvs/core";
import { buildTerraformTopology, classifyRootModules, discoverTerraformFiles, groupIntoDirectories, type TerraformTopology } from "@rvs/terraform-graph";
import type { TopologyScene, VisualDoc, WorkflowScene } from "@rvs/visualdoc-schema";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { renderVisualDocToHtml } from "../render.js";
import type { DesignTokens } from "../tokens.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadTerraformFixture(name: string): Promise<TerraformTopology> {
  const repoRoot = resolve(here, `../../../terraform-graph/src/__tests__/fixtures/${name}`);
  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  const { roots } = await classifyRootModules(repoRoot, directories);
  return buildTerraformTopology(repoRoot, roots[0]!.relDir, name, directories);
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

const evidence: EvidenceManifest = {
  generated_at: "2026-01-01T00:00:00.000Z",
  git_commit: "abc123",
  claims: [
    {
      claim_id: "claim-001",
      claim: "Production deployments require approval",
      sources: [{ path: ".github/workflows/deploy.yml", lines: "84-103" }],
      confidence: "confirmed",
    },
  ],
};

function buildDoc(headline: string): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: "Order Service <demo>",
      aspect_ratio: "16:9",
      audience: "executive",
      theme: "executive-dark",
    },
    scenes: [
      { id: "s1", type: "title", headline, evidence: [] },
      {
        id: "s2",
        type: "headline",
        headline: "Deployments are gated",
        body: ["Manual approval required"],
        evidence: ["claim-001"],
      },
    ],
  };
}

describe("renderVisualDocToHtml", () => {
  it("renders every scene, embeds the citation, and stamps the document", () => {
    const html = renderVisualDocToHtml(buildDoc("One governed platform"), tokens, evidence, {
      gitCommit: "abc123",
    });

    expect(html).toContain("One governed platform");
    expect(html).toContain(".github/workflows/deploy.yml:84-103");
    expect(html).toContain('data-git-commit="abc123"');
    expect(html).toContain('data-design-system="executive-dark"');
    expect(html).toMatch(/data-content-spec-hash="sha256:[a-f0-9]{64}"/);
    expect(html).toContain('data-scene-type="title"');
    expect(html).toContain('data-scene-type="headline"');
  });

  it("escapes HTML in scene headlines to prevent injection", () => {
    const html = renderVisualDocToHtml(buildDoc('<script>alert(1)</script>'), tokens, evidence, {
      gitCommit: "abc123",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders a workflow scene's graph as inline native SVG, resolved by graph_id", () => {
    const { graph } = parseWorkflowText(
      ["name: Deploy", "on: push", "jobs:", "  build:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo hi", ""].join("\n"),
      ".github/workflows/deploy.yml",
    );
    const workflowScene: WorkflowScene = {
      id: "s3",
      type: "workflow",
      headline: "Deploy pipeline",
      evidence: [],
      graph_id: graph.id,
      detail_level: "jobs",
      direction: "top-to-bottom",
      highlight: [],
      annotations: [{ target: "job:workflow:Deploy:build", text: "Runs on every push" }],
    };
    const doc = buildDoc("One governed platform");
    doc.scenes.push(workflowScene);

    const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: "abc123" }, [graph]);

    expect(html).toContain('data-scene-type="workflow"');
    expect(html).toContain("<svg");
    expect(html).toContain('data-node-id="job:workflow:Deploy:build"');
    expect(html).toContain("Runs on every push");
  });

  it("throws a clear error when a workflow scene references an unresolved graph_id", () => {
    const workflowScene: WorkflowScene = {
      id: "s3",
      type: "workflow",
      headline: "Deploy pipeline",
      evidence: [],
      graph_id: "workflow:does-not-exist",
      detail_level: "jobs",
      direction: "top-to-bottom",
      highlight: [],
      annotations: [],
    };
    const doc = buildDoc("One governed platform");
    doc.scenes.push(workflowScene);

    expect(() => renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: "abc123" }, [])).toThrow(/workflow:does-not-exist/);
  });

  it("renders a topology scene's graph as inline native SVG, resolved by topology_id", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const topologyScene: TopologyScene = {
      id: "s3",
      type: "topology",
      headline: "Terraform topology",
      evidence: [],
      topology_id: topology.id,
      detail_level: "modules-and-key-resources",
      direction: "top-to-bottom",
      highlight: [],
      part_index: 0,
    };
    const doc = buildDoc("One governed platform");
    doc.scenes.push(topologyScene);

    const html = renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: "abc123" }, [], [topology]);

    expect(html).toContain('data-scene-type="topology"');
    expect(html).toContain("<svg");
    expect(html).toContain('data-node-type="root-module"');
  });

  it("throws a clear error when a topology scene references an unresolved topology_id", () => {
    const topologyScene: TopologyScene = {
      id: "s3",
      type: "topology",
      headline: "Terraform topology",
      evidence: [],
      topology_id: "terraform:does-not-exist",
      detail_level: "modules-and-key-resources",
      direction: "top-to-bottom",
      highlight: [],
      part_index: 0,
    };
    const doc = buildDoc("One governed platform");
    doc.scenes.push(topologyScene);

    expect(() => renderVisualDocToHtml(doc, tokens, evidence, { gitCommit: "abc123" }, [], [])).toThrow(/terraform:does-not-exist/);
  });
});
