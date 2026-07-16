import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTerraformSceneSubgraphs, buildTerraformTopology, classifyRootModules, discoverTerraformFiles, groupIntoDirectories, type TerraformTopology } from "@rvs/terraform-graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderTerraformMermaid } from "../render.js";

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

describe("renderTerraformMermaid", () => {
  it("emits a valid flowchart header with the requested direction", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology), { direction: "left-to-right" });
    expect(mmd.startsWith("flowchart LR")).toBe(true);
  });

  it("defaults to top-to-bottom direction", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd.startsWith("flowchart TD")).toBe(true);
  });

  it("renders distinct shapes for modules, resources, and variables", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).toMatch(/\[\["module-composition"\]\]/);
    expect(mmd).toMatch(/\["aws_instance\.app(?: \[\w+\])?"\]/);
    expect(mmd).toMatch(/\(\["region"\]\)/);
  });

  it("produces stable, sorted node and edge ordering across repeated renders", async () => {
    const topology = await buildFixture("module-composition");
    const subgraph = fullSubgraph(topology);
    const first = renderTerraformMermaid(topology, subgraph);
    const second = renderTerraformMermaid(topology, subgraph);
    expect(first).toBe(second);
  });

  it("marks a dynamic-status resource node with a [dynamic] suffix and dynamic class", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).toContain("[dynamic]");
    expect(mmd).toMatch(/class \S*aws_db_instance\S* resource,dynamic/);
  });

  it("renders contains edges without an arrowhead and reference edges with one", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).toMatch(/ --- /);
    expect(mmd).toMatch(/ --> /);
  });

  it("emits a legend when multiple node types are present", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).toContain("subgraph Legend");
    expect(mmd).toContain("Resource");
    expect(mmd).toContain("Variable");
  });

  it("preserves evidence via adjacent comments for every node and edge", async () => {
    const topology = await buildFixture("module-composition");
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).toMatch(/%% node terraform:resource:aws_instance\.app evidence=main\.tf:/);
    expect(mmd).toMatch(/%% edge .* evidence=main\.tf:/);
  });

  it("applies the highlight class only to explicitly requested node ids", async () => {
    const topology = await buildFixture("module-composition");
    const subgraph = fullSubgraph(topology);
    const resourceId = "terraform:resource:aws_instance.app";
    const mmd = renderTerraformMermaid(topology, subgraph, { highlight: [resourceId] });
    expect(mmd).toMatch(/class \S*aws_instance_app resource,highlight/);
    expect(mmd).not.toMatch(/class \S*aws_vpc_main resource,highlight/);
  });

  it("marks an unresolved reference with a dashed edge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rvs-terraform-mermaid-"));
    try {
      writeFileSync(
        join(dir, "main.tf"),
        ['resource "aws_instance" "app" {', '  ami = var.does_not_exist', "}", ""].join("\n"),
      );
      const files = await discoverTerraformFiles(dir);
      const directories = groupIntoDirectories(files);
      const topology = await buildTerraformTopology(dir, "", "unresolved-fixture", directories);
      const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
      expect(mmd).toMatch(/-\.->\|unresolved\|/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderTerraformMermaid: single-node-type topology", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rvs-terraform-mermaid-empty-"));
    writeFileSync(join(dir, "main.tf"), "# no resources here\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("omits the legend when only the root module node is present", async () => {
    const files = await discoverTerraformFiles(dir);
    const directories = groupIntoDirectories(files);
    const topology = await buildTerraformTopology(dir, "", "empty", directories);
    const mmd = renderTerraformMermaid(topology, fullSubgraph(topology));
    expect(mmd).not.toContain("subgraph Legend");
  });
});
