import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTerraformSceneSubgraphs, buildTerraformTopology, classifyRootModules, discoverTerraformFiles, groupIntoDirectories, type TerraformTopology } from "@rvs/terraform-graph";
import { describe, expect, it } from "vitest";
import { renderTerraformSvg } from "../render.js";

function fixtureRoot(name: string): string {
  return fileURLToPath(new URL(`../../../terraform-graph/src/__tests__/fixtures/${name}`, import.meta.url));
}

async function buildFixture(name: string, rootName = name): Promise<TerraformTopology> {
  const repoRoot = fixtureRoot(name);
  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  const { roots } = await classifyRootModules(repoRoot, directories);
  return buildTerraformTopology(repoRoot, roots[0]!.relDir, rootName, directories);
}

function fullSubgraph(topology: TerraformTopology) {
  return buildTerraformSceneSubgraphs(topology, "full", [])[0]!;
}

describe("renderTerraformSvg", () => {
  it("emits a well-formed, self-contained <svg> root with accessible title and desc", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<title>module-composition Terraform topology diagram</title>");
    expect(svg).toMatch(/<desc>.*<\/desc>/s);
    expect(svg).toContain('role="img"');
  });

  it("contains no <script> tags and references no external assets", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    expect(svg).not.toContain("<script");
    const externalRefs = svg.match(/https?:\/\/(?!www\.w3\.org)/g);
    expect(externalRefs).toBeNull();
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<link");
  });

  it("renders visually distinct shape markup for different node types", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    expect(svg).toContain('class="tf-node tf-node-root-module"');
    expect(svg).toContain('class="tf-node tf-node-resource"');
    expect(svg).toContain('class="tf-node tf-node-variable"');
    const providerGroup = svg.match(/<g class="tf-node tf-node-provider"[\s\S]*?<\/g>/)?.[0];
    expect(providerGroup).toContain("<polygon");
    const variableGroup = svg.match(/<g class="tf-node tf-node-variable"[\s\S]*?<\/g>/)?.[0];
    expect(variableGroup).toMatch(/<rect[^>]*rx="20"/);
  });

  it("embeds evidence references as data attributes on nodes and edges", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    expect(svg).toMatch(/data-node-id="terraform:resource:aws_instance\.app"[^>]*data-evidence="main\.tf:/);
    expect(svg).toMatch(/data-edge-id="[^"]+"[^>]*data-evidence="main\.tf:/);
  });

  it("produces byte-identical output across repeated renders of the same subgraph (determinism)", async () => {
    const topology = await buildFixture("module-composition");
    const subgraph = fullSubgraph(topology);
    const first = renderTerraformSvg(topology, subgraph);
    const second = renderTerraformSvg(topology, subgraph);
    expect(first.svg).toBe(second.svg);
    expect(first.layout).toEqual(second.layout);
  });

  it("renders contains edges without an arrowhead marker and other edges with one", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    const containsGroup = svg.match(/<g class="tf-edge tf-edge-contains"[\s\S]*?<\/g>/)?.[0];
    expect(containsGroup).not.toContain("marker-end");
    const nonContainsGroup = svg.match(/<g class="tf-edge tf-edge-calls-module"[\s\S]*?<\/g>/)?.[0];
    expect(nonContainsGroup).toContain('marker-end="url(#rvs-tf-arrow)"');
  });

  it("marks dynamic-status nodes with a distinguishing suffix and dashed shape, and only highlights explicitly requested node ids", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const subgraph = fullSubgraph(topology);
    const resourceId = "terraform:resource:aws_db_instance.primary";
    const { svg } = renderTerraformSvg(topology, subgraph, { highlight: [resourceId] });
    expect(svg).toContain("[dynamic]");
    expect(svg).toMatch(/data-status="dynamic"/);
    const highlightedGroup = svg.match(new RegExp(`data-node-id="${resourceId.replace(/\./g, "\\.")}"[\\s\\S]*?<\\/g>`))?.[0];
    expect(highlightedGroup).toContain('stroke="#f97316"');
  });

  it("renders a legend only when multiple node types are present", async () => {
    const topology = await buildFixture("module-composition");
    const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
    expect(svg).toContain("tf-legend");

    const dir = mkdtempSync(join(tmpdir(), "rvs-terraform-svg-empty-"));
    try {
      writeFileSync(join(dir, "main.tf"), "# no resources here\n");
      const files = await discoverTerraformFiles(dir);
      const directories = groupIntoDirectories(files);
      const emptyTopology = await buildTerraformTopology(dir, "", "empty", directories);
      const single = renderTerraformSvg(emptyTopology, fullSubgraph(emptyTopology));
      expect(single.svg).not.toContain("tf-legend");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("escapes label text unsafe for XML/SVG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rvs-terraform-svg-escape-"));
    try {
      writeFileSync(join(dir, "main.tf"), ['variable "quote_test" {', '  default = "unused"', '  description = "Quote \\" & <Tag> Test"', "}", ""].join("\n"));
      const files = await discoverTerraformFiles(dir);
      const directories = groupIntoDirectories(files);
      const topology = await buildTerraformTopology(dir, "", "escape-fixture", directories);
      const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
      expect(svg).not.toMatch(/<tag>/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a layout whose declared width/height cover every positioned node", async () => {
    const topology = await buildFixture("module-composition");
    const { svg, layout } = renderTerraformSvg(topology, fullSubgraph(topology));
    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("marks an unresolved reference edge with dashed styling and no arrowhead suppressed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rvs-terraform-svg-unresolved-"));
    try {
      writeFileSync(join(dir, "main.tf"), ['resource "aws_instance" "app" {', "  ami = var.does_not_exist", "}", ""].join("\n"));
      const files = await discoverTerraformFiles(dir);
      const directories = groupIntoDirectories(files);
      const topology = await buildTerraformTopology(dir, "", "unresolved-fixture", directories);
      const { svg } = renderTerraformSvg(topology, fullSubgraph(topology));
      const unresolvedGroup = svg.match(/<g class="tf-edge tf-edge-unresolved-reference"[\s\S]*?<\/g>/)?.[0];
      expect(unresolvedGroup).toMatch(/stroke-dasharray="6 4"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
