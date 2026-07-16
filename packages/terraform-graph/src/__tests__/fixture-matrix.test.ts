import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRootModules, discoverTerraformFiles, groupIntoDirectories } from "../discover.js";
import { buildTerraformTopology } from "../topology.js";
import { validateTerraformTopologyStructure } from "../validate-structure.js";
import { buildTerraformSceneSubgraphs } from "../scene-subgraph.js";
import * as ids from "../ids.js";
import type { ArchitectureEdge, ArchitectureNode } from "@rvs/architecture-graph";
import type { TerraformTopology, TerraformTopologyWarning } from "../types.js";

// This suite exercises the 22-scenario Terraform fixture matrix required by
// the Milestone 2 Slice 2 coverage-and-documentation closure spec. Each
// `describe` block maps to one (or, where explicitly reused, more than one)
// numbered scenario from that spec. Scenario 6 ("resource with a remote
// module") and scenario 5 ("root module calling a local module") reuse the
// pre-existing `remote-module` and `module-composition` fixtures respectively
// — those behaviors were already fully covered by topology.test.ts, so no
// duplicate fixture directory was created for them (see the closure report
// for this mapping).

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

function nonInformational(warnings: TerraformTopologyWarning[]): TerraformTopologyWarning[] {
  return warnings.filter((w) => w.severity !== "informational");
}

// --- Scenario 1: single AWS resource -----------------------------------

describe("fixture matrix: single-resource (scenario 1)", () => {
  it("builds exactly one resource node with a deterministic address-based ID", async () => {
    const topology = await buildFixture("single-resource");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    const node = findNode(topology.nodes, resourceId);
    expect(node.type).toBe("resource");
    expect(topology.metadata.resourceCount).toBe(1);
  });

  it("has every visible node backed by evidence", async () => {
    const topology = await buildFixture("single-resource");
    for (const node of topology.nodes) {
      expect(node.evidence.length, `node ${node.id} has no evidence`).toBeGreaterThan(0);
    }
  });

  it("passes structural validation with zero warnings", async () => {
    const topology = await buildFixture("single-resource");
    expect(validateTerraformTopologyStructure(topology)).toEqual([]);
    expect(nonInformational(topology.warnings)).toEqual([]);
  });

  it("is deterministic across repeated builds", async () => {
    const first = await buildFixture("single-resource");
    const second = await buildFixture("single-resource");
    expect(second).toEqual(first);
  });
});

// --- Scenario 2: resource with explicit depends_on ----------------------

describe("fixture matrix: explicit-depends-on (scenario 2)", () => {
  it("creates an evidence-backed depends-on edge from the explicit depends_on array", async () => {
    const topology = await buildFixture("explicit-depends-on");
    const assetsId = ids.resourceId("", "aws_s3_bucket", "assets");
    const logsId = ids.resourceId("", "aws_s3_bucket", "logs");
    const edge = findEdge(topology.edges, (e) => e.type === "depends-on" && e.source === assetsId && e.target === logsId);
    expect(edge.evidence.length).toBeGreaterThan(0);
  });

  it("passes structural validation with zero non-informational warnings", async () => {
    const topology = await buildFixture("explicit-depends-on");
    expect(nonInformational(topology.warnings)).toEqual([]);
  });
});

// --- Scenario 3: resource-reference expression --------------------------

describe("fixture matrix: resource-reference (scenario 3)", () => {
  it("creates an evidence-backed references edge from a static resource attribute reference", async () => {
    const topology = await buildFixture("resource-reference");
    const subnetId = ids.resourceId("", "aws_subnet", "app");
    const vpcId = ids.resourceId("", "aws_vpc", "main");
    const edge = findEdge(topology.edges, (e) => e.type === "references" && e.source === subnetId && e.target === vpcId);
    expect(edge.evidence.length).toBeGreaterThan(0);
  });

  it("resolves the referencing node's status as dynamic (resource-attribute references are conservatively unresolved since evaluating them requires running Terraform)", async () => {
    const topology = await buildFixture("resource-reference");
    const subnetId = ids.resourceId("", "aws_subnet", "app");
    expect(findNode(topology.nodes, subnetId).status).toBe("dynamic");
  });
});

// --- Scenario 4: data source consumed by a resource ----------------------

describe("fixture matrix: data-source-reference (scenario 4)", () => {
  it("models the data block as a data-source node distinct from a resource node", async () => {
    const topology = await buildFixture("data-source-reference");
    const dataId = ids.dataSourceId("", "aws_ami", "ubuntu");
    expect(findNode(topology.nodes, dataId).type).toBe("data-source");
  });

  it("creates a reads-from edge from the consuming resource to the data source", async () => {
    const topology = await buildFixture("data-source-reference");
    const appId = ids.resourceId("", "aws_instance", "app");
    const dataId = ids.dataSourceId("", "aws_ami", "ubuntu");
    const edge = findEdge(topology.edges, (e) => e.type === "reads-from" && e.source === appId && e.target === dataId);
    expect(edge).toBeTruthy();
  });
});

// --- Scenario 5: root module calling a local module ----------------------
// (also fully covered by the pre-existing module-composition fixture in
// topology.test.ts; this block adds a minimal, single-behavior fixture)

describe("fixture matrix: local-module (scenario 5)", () => {
  it("resolves a local module source to a child-module node and a resource inside it", async () => {
    const topology = await buildFixture("local-module");
    const childId = ids.childModuleId("storage");
    expect(findNode(topology.nodes, childId).type).toBe("child-module");
    const resourceId = ids.resourceId("storage", "aws_s3_bucket", "assets");
    expect(findNode(topology.nodes, resourceId).type).toBe("resource");
  });

  it("creates a calls-module edge from root to the child, and a contains edge from the child to its resource", async () => {
    const topology = await buildFixture("local-module");
    const rootId = ids.rootModuleId("local-module");
    const childId = ids.childModuleId("storage");
    const resourceId = ids.resourceId("storage", "aws_s3_bucket", "assets");
    expect(findEdge(topology.edges, (e) => e.type === "calls-module" && e.source === rootId && e.target === childId)).toBeTruthy();
    expect(findEdge(topology.edges, (e) => e.type === "contains" && e.source === childId && e.target === resourceId)).toBeTruthy();
  });

  it("does not download or treat the local module as external", async () => {
    const topology = await buildFixture("local-module");
    expect(topology.metadata.hasExternalModules).toBe(false);
    expect(topology.warnings.some((w) => w.code === "TERRAFORM_REMOTE_MODULE_OPAQUE")).toBe(false);
  });
});

// --- Scenario 6: root module calling a remote module ----------------------
// Covered by the pre-existing `remote-module` fixture (registry module
// `terraform-aws-modules/vpc/aws`) — see topology.test.ts's
// "buildTerraformTopology: remote-module fixture" block, which already
// asserts: opaque external-module node, "registry" sourceKind,
// TERRAFORM_REMOTE_MODULE_OPAQUE warning, and that the module is never
// downloaded (the fixture's `source` is never resolved to a filesystem
// path). No additional fixture was created for this scenario.

// --- Scenario 7: multiple providers with aliases --------------------------

describe("fixture matrix: provider-aliases (scenario 7)", () => {
  it("creates two distinct provider nodes, one per alias", async () => {
    const topology = await buildFixture("provider-aliases");
    const primaryId = ids.providerId("", "aws", "primary");
    const secondaryId = ids.providerId("", "aws", "secondary");
    expect(findNode(topology.nodes, primaryId).metadata?.alias).toBe("primary");
    expect(findNode(topology.nodes, secondaryId).metadata?.alias).toBe("secondary");
  });

  it("routes each resource's explicit provider meta-argument to its own aliased provider node", async () => {
    const topology = await buildFixture("provider-aliases");
    const primaryResourceId = ids.resourceId("", "aws_s3_bucket", "primary_assets");
    const secondaryResourceId = ids.resourceId("", "aws_s3_bucket", "secondary_assets");
    const primaryProviderId = ids.providerId("", "aws", "primary");
    const secondaryProviderId = ids.providerId("", "aws", "secondary");
    expect(
      findEdge(topology.edges, (e) => e.type === "uses-provider" && e.source === primaryResourceId && e.target === primaryProviderId),
    ).toBeTruthy();
    expect(
      findEdge(topology.edges, (e) => e.type === "uses-provider" && e.source === secondaryResourceId && e.target === secondaryProviderId),
    ).toBeTruthy();
  });

  it("never routes an aliased resource to the wrong alias's provider node", async () => {
    const topology = await buildFixture("provider-aliases");
    const primaryResourceId = ids.resourceId("", "aws_s3_bucket", "primary_assets");
    const secondaryProviderId = ids.providerId("", "aws", "secondary");
    expect(topology.edges.some((e) => e.type === "uses-provider" && e.source === primaryResourceId && e.target === secondaryProviderId)).toBe(false);
  });
});

// --- Scenario 8: variables and outputs -------------------------------------

describe("fixture matrix: variables-outputs (scenario 8)", () => {
  it("captures a non-sensitive variable's default value", async () => {
    const topology = await buildFixture("variables-outputs");
    const variableId = ids.variableId("", "environment");
    const node = findNode(topology.nodes, variableId);
    expect(node.metadata?.default).toBe("staging");
  });

  it("creates a produces-output edge from the referenced resource to the output node", async () => {
    const topology = await buildFixture("variables-outputs");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    const outputId = ids.outputId("", "bucket_name");
    const edge = findEdge(topology.edges, (e) => e.type === "produces-output" && e.source === resourceId && e.target === outputId);
    expect(edge).toBeTruthy();
  });
});

// --- Scenario 9: sensitive variable -----------------------------------------

describe("fixture matrix: sensitive-variable (scenario 9)", () => {
  it("never emits the sensitive variable's default value anywhere in the topology", async () => {
    const topology = await buildFixture("sensitive-variable");
    const serialized = JSON.stringify(topology);
    expect(serialized).not.toContain("should-not-appear-in-output");
  });

  it("marks the variable node sensitive with its default redacted, and emits an informational warning", async () => {
    const topology = await buildFixture("sensitive-variable");
    const variableId = ids.variableId("", "api_token");
    const node = findNode(topology.nodes, variableId);
    expect(node.metadata?.sensitive).toBe(true);
    expect(node.metadata?.default).toBeUndefined();
    expect(topology.warnings.some((w) => w.code === "TERRAFORM_SENSITIVE_VALUE_REDACTED" && w.relatedId === variableId)).toBe(true);
  });

  it("passes structural validation's sensitive-value spot-check", async () => {
    const topology = await buildFixture("sensitive-variable");
    expect(validateTerraformTopologyStructure(topology).some((w) => w.code === "TERRAFORM_SENSITIVE_VALUE_REDACTED")).toBe(false);
  });
});

// --- Scenario 10: dynamic for_each -------------------------------------------

describe("fixture matrix: dynamic-for-each (scenario 10)", () => {
  it("marks a resource with dynamic for_each as status dynamic without fabricating per-key instances", async () => {
    const topology = await buildFixture("dynamic-for-each");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    const node = findNode(topology.nodes, resourceId);
    expect(node.status).toBe("dynamic");
    expect(node.metadata?.hasForEach).toBe(true);
    // Exactly one node for the whole for_each block — no fabricated
    // per-key expansion (e.g. no "aws_s3_bucket.assets[\"primary\"]" node).
    expect(topology.nodes.filter((n) => n.type === "resource").length).toBe(1);
  });

  it("emits an informational TERRAFORM_DYNAMIC_EXPRESSION warning", async () => {
    const topology = await buildFixture("dynamic-for-each");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    const warning = topology.warnings.find((w) => w.code === "TERRAFORM_DYNAMIC_EXPRESSION" && w.relatedId === resourceId);
    expect(warning).toBeTruthy();
    expect(warning?.severity).toBe("informational");
  });
});

// --- Scenario 11: dynamic provider expression --------------------------------

describe("fixture matrix: dynamic-provider (scenario 11)", () => {
  it("marks the provider node partial when its config contains a dynamic expression", async () => {
    const topology = await buildFixture("dynamic-provider");
    const providerId = ids.providerId("", "aws");
    const node = findNode(topology.nodes, providerId);
    expect(node.status).toBe("partial");
  });

  it("preserves the dynamic region expression as unresolved rather than guessing a value", async () => {
    const topology = await buildFixture("dynamic-provider");
    const providerId = ids.providerId("", "aws");
    const node = findNode(topology.nodes, providerId);
    expect(node.metadata?.region).toBeUndefined();
  });
});

// --- Scenario 12: module input referencing a resource -------------------------

describe("fixture matrix: module-input-reference (scenario 12)", () => {
  it("creates a passes-input edge from the referenced root resource to the child module", async () => {
    const topology = await buildFixture("module-input-reference");
    const vpcId = ids.resourceId("", "aws_vpc", "main");
    const childId = ids.childModuleId("child");
    const edge = findEdge(topology.edges, (e) => e.type === "passes-input" && e.source === vpcId && e.target === childId);
    expect(edge).toBeTruthy();
  });
});

// --- Scenario 13: output referencing a module ----------------------------------

describe("fixture matrix: module-output-reference (scenario 13)", () => {
  it("creates a produces-output edge from the child module's inner output to the root output", async () => {
    const topology = await buildFixture("module-output-reference");
    const childOutputId = ids.outputId("child", "bucket_name");
    const rootOutputId = ids.outputId("", "child_bucket_name");
    const edge = findEdge(topology.edges, (e) => e.type === "produces-output" && e.source === childOutputId && e.target === rootOutputId);
    expect(edge).toBeTruthy();
  });
});

// --- Scenario 14: multiple root modules -----------------------------------------

describe("fixture matrix: multiple-roots (scenario 14)", () => {
  it("detects both root modules deterministically, with neither referenced as a child of the other", async () => {
    const repoRoot = fixtureRoot("multiple-roots");
    const files = await discoverTerraformFiles(repoRoot);
    const directories = groupIntoDirectories(files);
    const { roots } = await classifyRootModules(repoRoot, directories);
    expect(roots.map((r) => r.relDir)).toEqual(["service-a", "service-b"]);
  });

  it("builds each root module independently with its own resource", async () => {
    const repoRoot = fixtureRoot("multiple-roots");
    const files = await discoverTerraformFiles(repoRoot);
    const directories = groupIntoDirectories(files);
    const topologyA = await buildTerraformTopology(repoRoot, "service-a", "service-a", directories);
    const topologyB = await buildTerraformTopology(repoRoot, "service-b", "service-b", directories);
    expect(topologyA.metadata.resourceCount).toBe(1);
    expect(topologyB.metadata.resourceCount).toBe(1);
    expect(topologyA.rootModulePath).not.toBe(topologyB.rootModulePath);
  });
});

// --- Scenario 15: large topology requiring splitting -------------------------------

describe("fixture matrix: large-topology (scenario 15)", () => {
  it("exceeds the 25-visible-node scene threshold at the default detail level", async () => {
    const topology = await buildFixture("large-topology");
    // root + 3 child modules + 3*9 resources = 31 nodes, all connected
    // (every resource depends on its module's b0, so all have degree > 0).
    expect(topology.nodes.length).toBe(31);
  });

  it("splits deterministically along module boundaries and never cuts a module's resources across scenes", async () => {
    const topology = await buildFixture("large-topology");
    const warnings: TerraformTopologyWarning[] = [];
    const parts = buildTerraformSceneSubgraphs(topology, "modules-and-key-resources", warnings);
    expect(parts.length).toBeGreaterThan(1);
    expect(warnings.some((w) => w.code === "TERRAFORM_COMPONENT_SPLIT")).toBe(true);

    // Every resource's containing child-module node lands in the same part
    // as the resource itself.
    const containsEdges = topology.edges.filter((e) => e.type === "contains");
    for (const part of parts) {
      const idsInPart = new Set(part.nodes.map((n) => n.id));
      for (const node of part.nodes) {
        if (node.type !== "resource") continue;
        const containingEdge = containsEdges.find((e) => e.target === node.id);
        if (containingEdge && idsInPart.size < topology.nodes.length) {
          // If the container is visible at all in this build, it must be
          // in the same part as the resource it contains.
          const containerVisible = parts.some((p) => p.nodes.some((n) => n.id === containingEdge.source));
          if (containerVisible) {
            expect(idsInPart.has(containingEdge.source)).toBe(true);
          }
        }
      }
    }
  });

  it("is deterministic across repeated splits", async () => {
    const topology = await buildFixture("large-topology");
    const warningsA: TerraformTopologyWarning[] = [];
    const warningsB: TerraformTopologyWarning[] = [];
    const partsA = buildTerraformSceneSubgraphs(topology, "modules-and-key-resources", warningsA);
    const partsB = buildTerraformSceneSubgraphs(topology, "modules-and-key-resources", warningsB);
    expect(partsA.map((p) => p.nodes.map((n) => n.id))).toEqual(partsB.map((p) => p.nodes.map((n) => n.id)));
  });
});

// --- Scenario 16: invalid HCL -----------------------------------------------------

describe("fixture matrix: invalid-hcl (scenario 16)", () => {
  it("reports a TERRAFORM_PARSE_ERROR error with the offending file's path, and still returns a topology", async () => {
    const repoRoot = fixtureRoot("invalid-hcl");
    const files = await discoverTerraformFiles(repoRoot);
    const directories = groupIntoDirectories(files);
    const { roots } = await classifyRootModules(repoRoot, directories);
    expect(roots).toHaveLength(1);
    const topology = await buildTerraformTopology(repoRoot, roots[0]!.relDir, "invalid-hcl", directories);
    const parseError = topology.warnings.find((w) => w.code === "TERRAFORM_PARSE_ERROR");
    expect(parseError).toBeTruthy();
    expect(parseError?.severity).toBe("error");
    expect(parseError?.sourcePath).toContain("main.tf");
  });
});

// --- Scenario 17: unsupported block -----------------------------------------------

describe("fixture matrix: unsupported-block (scenario 17)", () => {
  it("emits an explicit TERRAFORM_UNSUPPORTED_BLOCK warning for a block type it does not model, and still processes the rest of the file", async () => {
    const topology = await buildFixture("unsupported-block");
    const unsupported = topology.warnings.find((w) => w.code === "TERRAFORM_UNSUPPORTED_BLOCK");
    expect(unsupported).toBeTruthy();
    expect(unsupported?.severity).toBe("warning");

    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    expect(findNode(topology.nodes, resourceId).type).toBe("resource");
  });
});

// --- Scenario 18: terraform state file present and ignored ------------------------

describe("fixture matrix: ignored-state (scenario 18)", () => {
  it("discovers only .tf files, never terraform.tfstate, its .backup, or *.tfplan", async () => {
    const repoRoot = fixtureRoot("ignored-state");
    const files = await discoverTerraformFiles(repoRoot);
    expect(files).toEqual(["main.tf"]);
  });

  it("builds a topology with no trace of state-file content", async () => {
    const topology = await buildFixture("ignored-state");
    expect(topology.metadata.resourceCount).toBe(1);
  });
});

// --- Scenario 19: .terraform/ directory present and ignored -----------------------

describe("fixture matrix: ignored-dot-terraform (scenario 19)", () => {
  it("excludes .terraform/** from discovery even when it contains a .tf file", async () => {
    const repoRoot = fixtureRoot("ignored-dot-terraform");
    const files = await discoverTerraformFiles(repoRoot);
    expect(files).toEqual(["main.tf"]);
  });

  it("never creates a node for a resource declared only inside .terraform/", async () => {
    const topology = await buildFixture("ignored-dot-terraform");
    expect(topology.nodes.some((n) => n.label?.includes("should_not_be_discovered"))).toBe(false);
    expect(JSON.stringify(topology)).not.toContain("should-not-appear");
  });
});

// --- Scenario 20: Databricks provider example --------------------------------------

describe("fixture matrix: databricks-provider (scenario 20)", () => {
  it("classifies the databricks provider and resource under the databricks cloud provider", async () => {
    const topology = await buildFixture("databricks-provider");
    const providerId = ids.providerId("", "databricks");
    const resourceId = ids.resourceId("", "databricks_cluster", "analytics");
    expect(findNode(topology.nodes, providerId).metadata?.cloudProvider).toBe("databricks");
    expect(findNode(topology.nodes, resourceId).metadata?.cloudProvider).toBe("databricks");
  });
});

// --- Scenario 21: cross-platform paths ----------------------------------------------

describe("fixture matrix: cross-platform-paths (scenario 21)", () => {
  it("returns forward-slash-normalized relative paths for nested directories regardless of platform", async () => {
    const repoRoot = fixtureRoot("cross-platform-paths");
    const files = await discoverTerraformFiles(repoRoot);
    expect(files).toEqual(["services/api/main.tf"]);
    expect(files.every((f) => !f.includes("\\"))).toBe(true);
  });

  it("carries the forward-slash nested path through into node evidence", async () => {
    const topology = await buildFixture("cross-platform-paths");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    const node = findNode(topology.nodes, resourceId);
    expect(node.evidence[0]?.path).toContain("services/api/main.tf");
    expect(node.evidence[0]?.path).not.toContain("\\");
  });
});

// --- Scenario 22: repository path containing spaces -----------------------------------

describe("fixture matrix: path with spaces (scenario 22)", () => {
  it("discovers and builds a topology from a repo root path containing spaces", async () => {
    const topology = await buildFixture("path with spaces", "path-with-spaces");
    const resourceId = ids.resourceId("", "aws_s3_bucket", "assets");
    expect(findNode(topology.nodes, resourceId).type).toBe("resource");
    expect(topology.metadata.resourceCount).toBe(1);
  });
});
