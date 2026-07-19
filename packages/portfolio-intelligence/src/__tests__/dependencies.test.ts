import { describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { buildDependencyGraph } from "../dependencies.js";
import { portfolioDependencyNodeId } from "../ids.js";
import { makeCapability, makeCapabilityModel, makePortfolioConfig, makePortfolioProduct, makeSourceMetadata } from "./fixtures.js";

describe("buildDependencyGraph", () => {
  it("gives every product a 'product' node, even with no capability model and no config", () => {
    const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });

    const { graph } = buildDependencyGraph([productA, productB], new Map(), undefined);

    const productNodeIds = graph.nodes.filter((n) => n.kind === "product").map((n) => n.id);
    expect(productNodeIds).toEqual(
      [portfolioDependencyNodeId("product", productA.id), portfolioDependencyNodeId("product", productB.id)].sort((a, b) => a.localeCompare(b)),
    );
    const nodeA = graph.nodes.find((n) => n.id === portfolioDependencyNodeId("product", productA.id));
    expect(nodeA?.label).toBe(productA.displayName);
  });

  it("produces an external_system node plus a depends_on edge (sourceProductId = product.id) for a capability's externalSystems entry", () => {
    const product = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const capability = makeCapability({ sourceLabel: "Widget Sync", externalSystems: ["Acme Billing API"], confidence: "confirmed" });
    const model: CapabilityModel = makeCapabilityModel({ includedCapabilities: [capability] });
    const capabilityModelsByProductId = new Map([[product.id, model]]);

    const { graph, evidence } = buildDependencyGraph([product], capabilityModelsByProductId, undefined);

    const systemNodeId = portfolioDependencyNodeId("external_system", "Acme Billing API");
    const systemNode = graph.nodes.find((n) => n.id === systemNodeId);
    expect(systemNode).toBeDefined();
    expect(systemNode?.kind).toBe("external_system");
    expect(systemNode?.label).toBe("Acme Billing API");

    const edge = graph.edges.find((e) => e.targetId === systemNodeId);
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("depends_on");
    expect(edge?.sourceProductId).toBe(product.id);
    expect(edge?.confidence).toBe("confirmed");
    expect(edge?.qualifiers).toEqual(["Widget Sync"]);
    expect(evidence.some((e) => e.sourceType === "capability" && e.productId === product.id)).toBe(true);
  });

  it("does not duplicate an external_system node/edge across two capabilities on the same product that share the system", () => {
    const product = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const capabilityOne = makeCapability({ sourceLabel: "Widget Sync", externalSystems: ["Acme Billing API"] });
    const capabilityTwo = makeCapability({ sourceLabel: "Widget Export", externalSystems: ["Acme Billing API"] });
    const model: CapabilityModel = makeCapabilityModel({ includedCapabilities: [capabilityOne, capabilityTwo] });
    const capabilityModelsByProductId = new Map([[product.id, model]]);

    const { graph } = buildDependencyGraph([product], capabilityModelsByProductId, undefined);

    const systemNodeId = portfolioDependencyNodeId("external_system", "Acme Billing API");
    expect(graph.nodes.filter((n) => n.id === systemNodeId)).toHaveLength(1);
    expect(graph.edges.filter((e) => e.targetId === systemNodeId)).toHaveLength(1);
  });

  it("a config-declared upstream_dependency produces a direct product->product depends_on edge (downstream depends on upstream) with confirmed confidence", () => {
    const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
    const config = makePortfolioConfig({
      products: [{ id: "product-a", artifact_root: "./artifacts/product-a" }, { id: "product-b", artifact_root: "./artifacts/product-b" }],
      approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship: "upstream_dependency" }],
    });

    const { graph } = buildDependencyGraph([productA, productB], new Map(), config);

    // product_a is upstream of product_b => product_b depends on product_a.
    const edge = graph.edges.find((e) => e.sourceProductId === productB.id && e.targetId === portfolioDependencyNodeId("product", productA.id));
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("depends_on");
    expect(edge?.confidence).toBe("confirmed");
  });

  it("a config-declared downstream_dependency produces a direct product->product depends_on edge (product_a depends on product_b) with confirmed confidence", () => {
    const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
    const config = makePortfolioConfig({
      products: [{ id: "product-a", artifact_root: "./artifacts/product-a" }, { id: "product-b", artifact_root: "./artifacts/product-b" }],
      approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship: "downstream_dependency" }],
    });

    const { graph } = buildDependencyGraph([productA, productB], new Map(), config);

    const edge = graph.edges.find((e) => e.sourceProductId === productA.id && e.targetId === portfolioDependencyNodeId("product", productB.id));
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("depends_on");
    expect(edge?.confidence).toBe("confirmed");
  });

  it.each(["shared_platform", "shared_contract"] as const)("a config-declared %s mints a shared node and an edge from each participant into it", (relationship) => {
    const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
    const config = makePortfolioConfig({
      products: [{ id: "product-a", artifact_root: "./artifacts/product-a" }, { id: "product-b", artifact_root: "./artifacts/product-b" }],
      approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship }],
    });

    const { graph } = buildDependencyGraph([productA, productB], new Map(), config);

    const expectedKind = relationship === "shared_platform" ? "shared_platform" : "contract";
    const sharedNode = graph.nodes.find((n) => n.kind === expectedKind);
    expect(sharedNode).toBeDefined();

    const edgeFromA = graph.edges.find((e) => e.sourceProductId === productA.id && e.targetId === sharedNode!.id);
    const edgeFromB = graph.edges.find((e) => e.sourceProductId === productB.id && e.targetId === sharedNode!.id);
    expect(edgeFromA).toBeDefined();
    expect(edgeFromB).toBeDefined();
    expect(edgeFromA?.kind).toBe("depends_on");
    expect(edgeFromB?.kind).toBe("depends_on");
    expect(edgeFromA?.confidence).toBe("confirmed");
    expect(edgeFromB?.confidence).toBe("confirmed");
  });
});
