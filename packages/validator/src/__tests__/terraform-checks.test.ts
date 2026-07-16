import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTerraformSceneSubgraphs,
  buildTerraformTopology,
  classifyRootModules,
  discoverTerraformFiles,
  groupIntoDirectories,
  type TerraformTopology,
} from "@rvs/terraform-graph";
import { renderTerraformMermaid } from "@rvs/terraform-mermaid";
import { renderTerraformSvg } from "@rvs/terraform-svg";
import { estimateLabelWidth, NODE_TYPE_HEIGHTS } from "@rvs/workflow-svg";
import { describe, expect, it } from "vitest";
import {
  checkTerraformLayoutOverlap,
  checkTerraformLayoutTextOverflow,
  checkTerraformMissingEvidence,
  checkTerraformRendererDivergence,
  runTerraformChecks,
} from "../terraform-checks.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadTerraformFixture(name: string): Promise<TerraformTopology> {
  const repoRoot = resolve(here, `../../../terraform-graph/src/__tests__/fixtures/${name}`);
  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  const { roots } = await classifyRootModules(repoRoot, directories);
  return buildTerraformTopology(repoRoot, roots[0]!.relDir, name, directories);
}

describe("checkTerraformMissingEvidence", () => {
  it("is silent for a real parsed fixture (every node/edge carries evidence)", async () => {
    const topology = await loadTerraformFixture("module-composition");
    expect(checkTerraformMissingEvidence(topology)).toEqual([]);
  });

  it("flags a node with no evidence references", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const withStrippedEvidence: TerraformTopology = {
      ...topology,
      nodes: topology.nodes.map((n, i) => (i === 0 ? { ...n, evidence: [] } : n)),
    };
    const warnings = checkTerraformMissingEvidence(withStrippedEvidence);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_MISSING_EVIDENCE");
    expect(warnings[0].relatedId).toBe(topology.nodes[0].id);
  });

  it("flags an edge with no evidence references", async () => {
    const topology = await loadTerraformFixture("module-composition");
    expect(topology.edges.length).toBeGreaterThan(0);
    const withStrippedEvidence: TerraformTopology = {
      ...topology,
      edges: topology.edges.map((e, i) => (i === 0 ? { ...e, evidence: [] } : e)),
    };
    const warnings = checkTerraformMissingEvidence(withStrippedEvidence);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_MISSING_EVIDENCE");
    expect(warnings[0].relatedId).toBe(topology.edges[0].id);
  });
});

describe("checkTerraformLayoutOverlap", () => {
  it("is silent on a well-formed layout", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const [subgraph] = buildTerraformSceneSubgraphs(topology, "modules-and-key-resources", []);
    const { layout } = renderTerraformSvg(topology, subgraph);
    expect(checkTerraformLayoutOverlap(layout, topology.rootModulePath)).toEqual([]);
  });

  it("flags two nodes whose bounding boxes intersect", () => {
    const layout = {
      width: 200,
      height: 200,
      nodes: [
        { id: "a", x: 0, y: 0, width: 100, height: 50, layer: 0 },
        { id: "b", x: 50, y: 25, width: 100, height: 50, layer: 0 },
      ],
      edges: [],
    };
    const warnings = checkTerraformLayoutOverlap(layout, "modules/svc");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_LAYOUT_OVERLAP");
  });
});

describe("checkTerraformLayoutTextOverflow", () => {
  it("flags a node whose label had to be truncated to fit its box", () => {
    const longLabel =
      "This is a very long resource name that will absolutely not fit inside the maximum node width no matter how it is measured";
    const node = {
      id: "resource:root.aws_instance.app",
      type: "resource",
      label: longLabel,
      evidence: [{ path: "main.tf", lines: "1-1" }],
    };
    const layout = {
      width: 300,
      height: 100,
      nodes: [{ id: node.id, x: 0, y: 0, width: estimateLabelWidth(longLabel), height: NODE_TYPE_HEIGHTS.step, layer: 0 }],
      edges: [],
    };
    const warnings = checkTerraformLayoutTextOverflow([node], layout);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_LAYOUT_TEXT_OVERFLOW");
  });

  it("accounts for the ' [status]' suffix the SVG renderer adds to dynamic/unresolved nodes", () => {
    const label = "aws_instance.app";
    const node = {
      id: "resource:root.aws_instance.app",
      type: "resource",
      label,
      status: "dynamic" as const,
      evidence: [{ path: "main.tf", lines: "1-1" }],
    };
    // Box sized to fit the bare label but not "aws_instance.app [dynamic]".
    const width = estimateLabelWidth(label);
    const layout = {
      width: 300,
      height: 100,
      nodes: [{ id: node.id, x: 0, y: 0, width, height: NODE_TYPE_HEIGHTS.step, layer: 0 }],
      edges: [],
    };
    const warnings = checkTerraformLayoutTextOverflow([node], layout);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_LAYOUT_TEXT_OVERFLOW");
  });

  it("is silent for a short label that fits", () => {
    const node = {
      id: "module:root.svc",
      type: "child-module",
      label: "svc",
      evidence: [{ path: "main.tf", lines: "1-1" }],
    };
    const layout = {
      width: 300,
      height: 100,
      nodes: [{ id: node.id, x: 0, y: 0, width: estimateLabelWidth("svc"), height: NODE_TYPE_HEIGHTS.job, layer: 0 }],
      edges: [],
    };
    expect(checkTerraformLayoutTextOverflow([node], layout)).toEqual([]);
  });
});

describe("checkTerraformRendererDivergence", () => {
  it("is silent when Mermaid and SVG are rendered from the same buildTerraformSceneSubgraphs call (the normal case)", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const [subgraph] = buildTerraformSceneSubgraphs(topology, "full", []);
    const mermaid = renderTerraformMermaid(topology, subgraph);
    const { svg } = renderTerraformSvg(topology, subgraph);
    expect(checkTerraformRendererDivergence(mermaid, svg, topology.rootModulePath)).toEqual([]);
  });

  it("flags a mismatch when one renderer's output covers a different node set", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const [fullSubgraph] = buildTerraformSceneSubgraphs(topology, "full", []);
    const [modulesSubgraph] = buildTerraformSceneSubgraphs(topology, "modules", []);
    const mermaid = renderTerraformMermaid(topology, fullSubgraph);
    const { svg } = renderTerraformSvg(topology, modulesSubgraph);
    const warnings = checkTerraformRendererDivergence(mermaid, svg, topology.rootModulePath);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TERRAFORM_RENDERER_DIVERGENCE");
  });
});

describe("runTerraformChecks", () => {
  it("aggregates checks across a real rendered fixture with no findings", async () => {
    const topology = await loadTerraformFixture("module-composition");
    const detailLevel = "modules-and-key-resources" as const;
    const [subgraph] = buildTerraformSceneSubgraphs(topology, detailLevel, []);
    const mermaid = renderTerraformMermaid(topology, subgraph);
    const { svg, layout } = renderTerraformSvg(topology, subgraph);

    const warnings = runTerraformChecks({ topology, selectedNodes: subgraph.nodes, layout, mermaid, svg });
    expect(warnings.filter((w) => w.code === "TERRAFORM_LAYOUT_OVERLAP")).toEqual([]);
    expect(warnings.filter((w) => w.code === "TERRAFORM_RENDERER_DIVERGENCE")).toEqual([]);
    expect(warnings.filter((w) => w.code === "TERRAFORM_MISSING_EVIDENCE")).toEqual([]);
  });
});
