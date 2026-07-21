import { describe, it, expect } from "vitest";
import { deriveBlastRadiusLevel } from "../blast-radius.js";
import { traverse } from "../traversal.js";
import type { TraversalOptions } from "../contracts.js";
import { evidencePathFixture, linearChainFixture, makeEdge, makeNode, unresolvedReferenceFixture } from "./graph-fixtures.js";

const OPTS: TraversalOptions = { maxDepth: 10, direction: "downstream", repositoryBoundary: "single", resultLimit: 500 };

describe("deriveBlastRadiusLevel", () => {
  it("returns 'unresolved' when the target node does not exist in the graph", () => {
    const { nodes, edges } = linearChainFixture();
    const result = traverse(nodes, edges, "graph:node:missing", OPTS);
    expect(deriveBlastRadiusLevel(nodes, "graph:node:missing", result)).toBe("unresolved");
  });

  it("returns 'unresolved' when the target node exists but has zero resolvable edges (gate before neighbor lookup)", () => {
    const solo = makeNode({ sourceEntityId: "blast-solo" });
    const result = traverse([solo], [], solo.id, OPTS);
    expect(deriveBlastRadiusLevel([solo], solo.id, result)).toBe("unresolved");
  });

  it("returns 'isolated' when every reached node is an unresolved_reference (edges exist, but nothing confirmed is reached)", () => {
    const { nodes, edges, a } = unresolvedReferenceFixture();
    const result = traverse(nodes, edges, a.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, a.id, result)).toBe("isolated");
  });

  it("returns 'local' when everything reached shares the target's node_type and source_artifact", () => {
    const { nodes, edges, a } = linearChainFixture();
    const result = traverse(nodes, edges, a.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, a.id, result)).toBe("local");
  });

  it("returns 'cross_component' when reached nodes share source_artifact but differ in node_type from the target", () => {
    const { nodes, edges, repo } = linearChainFixture();
    const result = traverse(nodes, edges, repo.id, OPTS);
    // repo is node_type "repository"; everything reached downstream is node_type "component", same source_artifact.
    expect(deriveBlastRadiusLevel(nodes, repo.id, result)).toBe("cross_component");
  });

  it("returns 'cross_layer' when reached nodes span more than one source_artifact", () => {
    const { nodes, edges, root } = evidencePathFixture();
    const result = traverse(nodes, edges, root.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, root.id, result)).toBe("cross_layer");
  });

  it("returns 'portfolio_wide' when a product or portfolio_relationship node is reached, even if other conditions would also apply", () => {
    const entity = makeNode({ sourceEntityId: "blast-portfolio-entity" });
    const product = makeNode({ sourceEntityId: "blast-portfolio-product", nodeType: "product", sourceArtifact: "product" });
    const nodes = [entity, product];
    const edges = [makeEdge({ edgeType: "depends_on", from: entity, to: product })];
    const result = traverse(nodes, edges, entity.id, OPTS);
    expect(deriveBlastRadiusLevel(nodes, entity.id, result)).toBe("portfolio_wide");
  });
});
