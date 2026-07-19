import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "@rvs/core";
import { buildEvidenceManifest, buildRepositoryModel } from "@rvs/repository-model";
import { buildTerraformTopology, classifyRootModules, discoverTerraformFiles, groupIntoDirectories, type TerraformTopology } from "@rvs/terraform-graph";
import { VisualDocSchema, type TopologyScene, type WorkflowScene } from "@rvs/visualdoc-schema";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { buildNarrativeBrief } from "../brief.js";
import { buildVisualDoc } from "../visualdoc-builder.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(here, "../../../../examples/fixture-repo");

function loadWorkflowFixture(name: string) {
  const path = resolve(here, `../../../workflow-graph/src/__tests__/fixtures/${name}`);
  return parseWorkflowText(readFileSync(path, "utf8"), `.github/workflows/${name}`).graph;
}

async function loadTerraformFixture(name: string): Promise<TerraformTopology> {
  const repoRoot = resolve(here, `../../../terraform-graph/src/__tests__/fixtures/${name}`);
  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  const { roots } = await classifyRootModules(repoRoot, directories);
  return buildTerraformTopology(repoRoot, roots[0]!.relDir, name, directories);
}

describe("buildVisualDoc", () => {
  it("produces a schema-valid, evidence-linked deck for the executive audience", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");

    const doc = buildVisualDoc(model, evidence, brief, "executive-dark");

    expect(() => VisualDocSchema.parse(doc)).not.toThrow();
    expect(doc.scenes.length).toBeGreaterThanOrEqual(8);
    expect(doc.scenes[0].type).toBe("title");
    expect(doc.scenes.some((s) => s.type === "architecture")).toBe(true);
    expect(doc.scenes.some((s) => s.type === "metric")).toBe(true);
    expect(doc.scenes.at(-1)?.headline).toBe("Decision requested");

    const architectureScene = doc.scenes.find((s) => s.type === "architecture");
    if (architectureScene?.type === "architecture") {
      expect(architectureScene.edges).toEqual([]);
      expect(architectureScene.nodes.length).toBeGreaterThan(0);
    }
  });

  it("omits workflow scenes entirely, and matches the no-argument output exactly, when workflowGraphs is not passed", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");

    const withoutArg = buildVisualDoc(model, evidence, brief, "executive-dark");
    const withEmptyArray = buildVisualDoc(model, evidence, brief, "executive-dark", []);

    expect(withoutArg.scenes.some((s) => s.type === "workflow")).toBe(false);
    expect(withEmptyArray).toEqual(withoutArg);
  });

  it("adds a single workflow scene for a small workflow graph", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");
    const graph = loadWorkflowFixture("linear-chain.yml");

    const doc = buildVisualDoc(model, evidence, brief, "executive-dark", [graph]);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();

    const workflowScenes = doc.scenes.filter((s): s is WorkflowScene => s.type === "workflow");
    expect(workflowScenes).toHaveLength(1);
    expect(workflowScenes[0].graph_id).toBe(graph.id);
    expect(workflowScenes[0].detail_level).toBe("jobs");
    expect(workflowScenes[0].focus_nodes).toBeUndefined();
    expect(doc.scenes.at(-1)?.headline).toBe("Decision requested");
  });

  it("splits a workflow over the size threshold into an overview scene plus deterministic detail groups", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");
    const graph = loadWorkflowFixture("large-workflow.yml");

    const doc1 = buildVisualDoc(model, evidence, brief, "executive-dark", [graph]);
    const doc2 = buildVisualDoc(model, evidence, brief, "executive-dark", [graph]);
    expect(() => VisualDocSchema.parse(doc1)).not.toThrow();

    const workflowScenes = doc1.scenes.filter((s): s is WorkflowScene => s.type === "workflow");
    expect(workflowScenes.length).toBeGreaterThan(1);
    expect(workflowScenes[0].detail_level).toBe("summary");
    expect(workflowScenes[0].focus_nodes).toBeUndefined();

    const detailScenes = workflowScenes.slice(1);
    expect(detailScenes.length).toBeGreaterThan(0);
    for (const scene of detailScenes) {
      expect(scene.detail_level).toBe("jobs-and-key-steps");
      expect(scene.focus_nodes && scene.focus_nodes.length).toBeGreaterThan(0);
    }
    const allFocusIds = detailScenes.flatMap((s) => s.focus_nodes ?? []);
    expect(new Set(allFocusIds).size).toBe(allFocusIds.length);

    // Deterministic: rebuilding from the same graph produces identical scenes.
    expect(doc2.scenes.filter((s) => s.type === "workflow")).toEqual(workflowScenes);
  });

  it("omits topology scenes entirely, and matches the no-argument output exactly, when terraformTopologies is not passed", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");

    const withoutArg = buildVisualDoc(model, evidence, brief, "executive-dark");
    const withEmptyArray = buildVisualDoc(model, evidence, brief, "executive-dark", [], []);

    expect(withoutArg.scenes.some((s) => s.type === "topology")).toBe(false);
    expect(withEmptyArray).toEqual(withoutArg);
  });

  it("adds a single topology scene for a small Terraform topology", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");
    const topology = await loadTerraformFixture("module-composition");

    const doc = buildVisualDoc(model, evidence, brief, "executive-dark", [], [topology]);
    expect(() => VisualDocSchema.parse(doc)).not.toThrow();

    const topologyScenes = doc.scenes.filter((s): s is TopologyScene => s.type === "topology");
    expect(topologyScenes).toHaveLength(1);
    expect(topologyScenes[0].topology_id).toBe(topology.id);
    expect(topologyScenes[0].detail_level).toBe("modules-and-key-resources");
    expect(topologyScenes[0].part_index).toBe(0);
    expect(doc.scenes.some((s) => s.type === "section-divider" && s.headline === "Infrastructure")).toBe(true);
    expect(doc.scenes.at(-1)?.headline).toBe("Decision requested");
  });

  it("splits a Terraform topology over the size threshold into deterministic part scenes", async () => {
    // buildTerraformSceneSubgraphs splits along module boundaries and never
    // cuts a single module's resources across scenes, so triggering a real
    // split requires multiple child modules (not just >25 resources in one
    // module) — four modules of eight resources each, each resource wired to
    // a per-module local so it clears the "modules-and-key-resources"
    // degree>0 filter.
    const dir = mkdtempSync(join(tmpdir(), "rvs-terraform-large-"));
    try {
      const moduleCount = 4;
      const resourcesPerModule = 8;
      const rootLines = Array.from({ length: moduleCount }, (_, m) => `module "svc_${m}" {\n  source = "./modules/svc_${m}"\n}\n`);
      writeFileSync(join(dir, "main.tf"), rootLines.join("\n"));

      for (let m = 0; m < moduleCount; m += 1) {
        const modDir = join(dir, "modules", `svc_${m}`);
        mkdirSync(modDir, { recursive: true });
        const lines: string[] = [`locals {\n  common_tags = { team = "svc-${m}" }\n}\n`];
        for (let i = 0; i < resourcesPerModule; i += 1) {
          lines.push(
            `resource "aws_instance" "app_${i}" {\n  ami           = "ami-${m}-${i}"\n  instance_type = "t3.micro"\n  tags          = local.common_tags\n}\n`,
          );
        }
        writeFileSync(join(modDir, "main.tf"), lines.join("\n"));
      }

      const files = await discoverTerraformFiles(dir);
      const directories = groupIntoDirectories(files);
      const { roots } = await classifyRootModules(dir, directories);
      const topology = await buildTerraformTopology(dir, roots[0]!.relDir, "large-topology", directories);

      const config = defaultConfig("order-service");
      const model = await buildRepositoryModel(fixtureRepo, config);
      const evidence = buildEvidenceManifest(model);
      const brief = buildNarrativeBrief(model, evidence, "executive");

      const doc1 = buildVisualDoc(model, evidence, brief, "executive-dark", [], [topology]);
      const doc2 = buildVisualDoc(model, evidence, brief, "executive-dark", [], [topology]);
      expect(() => VisualDocSchema.parse(doc1)).not.toThrow();

      const topologyScenes = doc1.scenes.filter((s): s is TopologyScene => s.type === "topology");
      expect(topologyScenes.length).toBeGreaterThan(1);
      for (const [index, scene] of topologyScenes.entries()) {
        expect(scene.part_index).toBe(index);
        expect(scene.topology_id).toBe(topology.id);
      }

      // Deterministic: rebuilding from the same topology produces identical scenes.
      expect(doc2.scenes.filter((s) => s.type === "topology")).toEqual(topologyScenes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orders tied-count top-level directory nodes alphabetically, regardless of the order sampledPaths lists them in", async () => {
    // §4 determinism audit: topLevelNodes() sorted by file count descending
    // with no tiebreaker, so a tie between two top-level directories fell
    // back to Map insertion order (first-occurrence order in sampledPaths) —
    // this proves the fix makes the architecture scene's node order
    // independent of scan/insertion order.
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);
    const brief = buildNarrativeBrief(model, evidence, "executive");

    const tiedFirst: typeof model = { ...model, files: { ...model.files, sampledPaths: ["scripts/a.ts", "scripts/b.ts", "packages/a.ts", "packages/b.ts", "docs/readme.md"] } };
    const tiedReversed: typeof model = { ...model, files: { ...model.files, sampledPaths: ["packages/a.ts", "packages/b.ts", "scripts/a.ts", "scripts/b.ts", "docs/readme.md"] } };

    const docFirst = buildVisualDoc(tiedFirst, evidence, brief, "executive-dark");
    const docReversed = buildVisualDoc(tiedReversed, evidence, brief, "executive-dark");

    const nodesFirst = docFirst.scenes.find((s) => s.type === "architecture" && s.nodes.length > 0);
    const nodesReversed = docReversed.scenes.find((s) => s.type === "architecture" && s.nodes.length > 0);
    if (nodesFirst?.type !== "architecture" || nodesReversed?.type !== "architecture") throw new Error("expected an architecture scene with nodes");

    expect(nodesFirst.nodes.map((n) => n.label)).toEqual(nodesReversed.nodes.map((n) => n.label));
    const packagesIndex = nodesFirst.nodes.findIndex((n) => n.label.startsWith("packages ("));
    const scriptsIndex = nodesFirst.nodes.findIndex((n) => n.label.startsWith("scripts ("));
    expect(packagesIndex).toBeGreaterThanOrEqual(0);
    expect(packagesIndex).toBeLessThan(scriptsIndex);
  });
});
