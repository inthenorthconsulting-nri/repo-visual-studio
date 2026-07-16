import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRootModules, discoverTerraformFiles, groupIntoDirectories } from "../discover.js";
import { buildTerraformTopology } from "../topology.js";
import { validateTerraformTopologyStructure } from "../validate-structure.js";
import * as ids from "../ids.js";
import type { ArchitectureEdge, ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformTopology } from "../types.js";

function fixtureRoot(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function findNode(nodes: ArchitectureNode[], id: string): ArchitectureNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`expected node "${id}" not found among: ${nodes.map((n) => n.id).join(", ")}`);
  return node;
}

function findEdge(edges: ArchitectureEdge[], predicate: (e: ArchitectureEdge) => boolean): ArchitectureEdge {
  const edge = edges.find(predicate);
  if (!edge) throw new Error(`expected edge not found among: ${edges.map((e) => `${e.type}:${e.source}->${e.target}`).join(", ")}`);
  return edge;
}

async function buildFixture(name: string, rootName = name): Promise<TerraformTopology> {
  const repoRoot = fixtureRoot(name);
  const files = await discoverTerraformFiles(repoRoot);
  const directories = groupIntoDirectories(files);
  const { roots } = await classifyRootModules(repoRoot, directories);
  if (roots.length !== 1) throw new Error(`expected exactly one root module, found: ${roots.map((r) => r.relDir).join(", ")}`);
  return buildTerraformTopology(repoRoot, roots[0]!.relDir, rootName, directories);
}

describe("buildTerraformTopology: module-composition fixture", () => {
  it("classifies modules/network as a child module, not a second root", async () => {
    const repoRoot = fixtureRoot("module-composition");
    const files = await discoverTerraformFiles(repoRoot);
    const directories = groupIntoDirectories(files);
    const { roots, referenced } = await classifyRootModules(repoRoot, directories);
    expect(roots.map((r) => r.relDir)).toEqual([""]);
    expect(referenced.has("modules/network")).toBe(true);
  });

  it("builds root and child module nodes with deterministic IDs", async () => {
    const topology = await buildFixture("module-composition");
    const rootId = ids.rootModuleId("module-composition");
    const childId = ids.childModuleId("network");
    expect(findNode(topology.nodes, rootId).type).toBe("root-module");
    expect(findNode(topology.nodes, childId).type).toBe("child-module");
    expect(findEdge(topology.edges, (e) => e.type === "calls-module" && e.source === rootId && e.target === childId)).toBeTruthy();
  });

  it("resolves a depends_on reference to a module directly", async () => {
    const topology = await buildFixture("module-composition");
    const resourceId = ids.resourceId("", "aws_instance", "app");
    const childId = ids.childModuleId("network");
    const edge = findEdge(topology.edges, (e) => e.type === "depends-on" && e.source === resourceId && e.target === childId);
    expect(edge).toBeTruthy();
  });

  it("resolves module.network.subnet_id to the child module's output node via an exports edge, regardless of file processing order", async () => {
    const topology = await buildFixture("module-composition");
    const resourceId = ids.resourceId("", "aws_instance", "app");
    const outputNodeId = ids.outputId("network", "subnet_id");
    expect(findNode(topology.nodes, outputNodeId).type).toBe("output");
    const edge = findEdge(topology.edges, (e) => e.source === resourceId && e.target === outputNodeId);
    expect(edge.type).toBe("exports");
  });

  it("resolves a root resource's forward reference to a variable declared in a later-processed file (var.region in main.tf, declared in variables.tf)", async () => {
    const topology = await buildFixture("module-composition");
    const providerNodeId = topology.nodes.find((n) => n.type === "provider" && n.label === "aws")?.id;
    expect(providerNodeId).toBeTruthy();
    const variableNodeId = ids.variableId("", "region");
    expect(findNode(topology.nodes, variableNodeId).type).toBe("variable");
    const edge = findEdge(topology.edges, (e) => e.source === providerNodeId && e.target === variableNodeId);
    expect(edge.type).toBe("references");
  });

  it("resolves an intra-child-module resource-to-resource reference (aws_subnet.private -> aws_vpc.main)", async () => {
    const topology = await buildFixture("module-composition");
    const subnetId = ids.resourceId("network", "aws_subnet", "private");
    const vpcId = ids.resourceId("network", "aws_vpc", "main");
    const edge = findEdge(topology.edges, (e) => e.type === "references" && e.source === subnetId && e.target === vpcId);
    expect(edge).toBeTruthy();
  });

  it("resolves the child module's own variable, declared in a sibling file, back to the root value passed through the module call", async () => {
    const topology = await buildFixture("module-composition");
    const vpcId = ids.resourceId("network", "aws_vpc", "main");
    const childVariableId = ids.variableId("network", "cidr_block");
    expect(findNode(topology.nodes, childVariableId).type).toBe("variable");
    const edge = findEdge(topology.edges, (e) => e.source === vpcId && e.target === childVariableId);
    expect(edge.type).toBe("references");
  });

  it("links the default provider to a resource with no explicit provider meta-argument", async () => {
    const topology = await buildFixture("module-composition");
    const resourceId = ids.resourceId("", "aws_instance", "app");
    const providerNodeId = ids.providerId("", "aws");
    const edge = findEdge(topology.edges, (e) => e.type === "uses-provider" && e.source === resourceId && e.target === providerNodeId);
    expect(edge).toBeTruthy();
  });

  it("never emits a connects-to edge (spec section 5: never infer cloud-network relationships)", async () => {
    const topology = await buildFixture("module-composition");
    expect(topology.edges.some((e) => e.type === "connects-to")).toBe(false);
  });

  it("passes structural validation with zero warnings for a well-formed fixture", async () => {
    const topology = await buildFixture("module-composition");
    const structuralWarnings = validateTerraformTopologyStructure(topology);
    expect(structuralWarnings).toEqual([]);
  });

  it("reports no unresolved-reference or dangling warnings during the build itself", async () => {
    const topology = await buildFixture("module-composition");
    const errorOrWarningCodes = topology.warnings.filter((w) => w.severity !== "informational").map((w) => w.code);
    expect(errorOrWarningCodes).toEqual([]);
  });

  it("is deterministic across repeated builds of the same source", async () => {
    const first = await buildFixture("module-composition");
    const second = await buildFixture("module-composition");
    expect(second).toEqual(first);
  });

  it("computes correct summary metadata", async () => {
    const topology = await buildFixture("module-composition");
    expect(topology.metadata.moduleCount).toBe(2); // root + network
    expect(topology.metadata.resourceCount).toBe(3); // aws_instance.app, aws_vpc.main, aws_subnet.private
    expect(topology.metadata.dataSourceCount).toBe(1); // aws_availability_zones.available
    expect(topology.metadata.hasExternalModules).toBe(false);
  });
});

describe("buildTerraformTopology: sensitive-and-dynamic fixture", () => {
  it("never captures a sensitive variable's default value in node metadata", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const variableNodeId = ids.variableId("", "db_password");
    const node = findNode(topology.nodes, variableNodeId);
    expect(node.metadata?.sensitive).toBe(true);
    expect(node.metadata?.default).toBeUndefined();
    expect(JSON.stringify(node.metadata)).not.toContain("should-not-appear");
  });

  it("never captures a sensitive output's value expression", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const outputNodeId = ids.outputId("", "password_out");
    const node = findNode(topology.nodes, outputNodeId);
    expect(node.metadata?.sensitive).toBe(true);
    expect(node.status).toBe("partial");
    // No produces-output edge should be created for a sensitive output.
    expect(topology.edges.some((e) => e.type === "produces-output" && e.target === outputNodeId)).toBe(false);
  });

  it("redacts a resource attribute whose key name matches a sensitive pattern", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const resourceNodeId = ids.resourceId("", "aws_db_instance", "primary");
    const node = findNode(topology.nodes, resourceNodeId);
    const attributes = node.metadata?.attributes as Record<string, unknown>;
    expect(attributes.password).toBe("[redacted]");
  });

  it("marks a resource with dynamic count as status dynamic and emits an informational warning", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const resourceNodeId = ids.resourceId("", "aws_db_instance", "primary");
    const node = findNode(topology.nodes, resourceNodeId);
    expect(node.status).toBe("dynamic");
    expect(node.metadata?.hasCount).toBe(true);
    expect(topology.warnings.some((w) => w.code === "TERRAFORM_DYNAMIC_EXPRESSION" && w.relatedId === resourceNodeId)).toBe(true);
  });

  it("emits informational sensitive-value warnings for both the variable and the output", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    const sensitiveWarnings = topology.warnings.filter((w) => w.code === "TERRAFORM_SENSITIVE_VALUE_REDACTED");
    expect(sensitiveWarnings).toHaveLength(2);
    expect(sensitiveWarnings.every((w) => w.severity === "informational")).toBe(true);
  });

  it("passes structural validation with zero warnings", async () => {
    const topology = await buildFixture("sensitive-and-dynamic");
    expect(validateTerraformTopologyStructure(topology)).toEqual([]);
  });
});

describe("buildTerraformTopology: remote-module fixture", () => {
  it("classifies a registry-sourced module as an opaque external module", async () => {
    const topology = await buildFixture("remote-module");
    const externalId = ids.externalModuleId("vpc");
    const node = findNode(topology.nodes, externalId);
    expect(node.type).toBe("external-module");
    expect(node.status).toBe("unresolved");
    expect(node.metadata?.sourceKind).toBe("registry");
    expect(topology.warnings.some((w) => w.code === "TERRAFORM_REMOTE_MODULE_OPAQUE" && w.relatedId === externalId)).toBe(true);
  });

  it("warns when a local module source cannot be found, and represents it as an external module fallback", async () => {
    const topology = await buildFixture("remote-module");
    const externalId = ids.externalModuleId("missing_local");
    const node = findNode(topology.nodes, externalId);
    expect(node.type).toBe("external-module");
    expect(node.metadata?.resolutionFailed).toBe(true);
    expect(topology.warnings.some((w) => w.code === "TERRAFORM_LOCAL_MODULE_NOT_FOUND")).toBe(true);
  });

  it("computes hasExternalModules metadata and does not count external modules toward moduleCount", async () => {
    const topology = await buildFixture("remote-module");
    expect(topology.metadata.hasExternalModules).toBe(true);
    expect(topology.metadata.moduleCount).toBe(1); // root only, both modules are external
  });

  it("passes structural validation with zero warnings", async () => {
    const topology = await buildFixture("remote-module");
    expect(validateTerraformTopologyStructure(topology)).toEqual([]);
  });
});
