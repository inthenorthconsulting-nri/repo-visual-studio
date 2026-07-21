import { describe, it, expect } from "vitest";
import {
  buildBaselineNode,
  buildCapabilityDomainNodes,
  buildCapabilityNodes,
  buildComponentNodes,
  buildDecisionAssumptionNodes,
  buildDecisionConsequenceNodes,
  buildDecisionNodes,
  buildEvidenceNodes,
  buildGovernanceFindingNodes,
  buildPolicyNodes,
  buildPortfolioProductNodes,
  buildPortfolioRelationshipNodes,
  buildProductIdentityNode,
  buildRepositoryNode,
  buildRuntimeEntrypointNodes,
  buildWorkflowNodes,
  resolveRepositoryIdFromArchitecture,
  type ArchitectureArtifactEcho,
  type CapabilityArtifactEcho,
  type DecisionArtifactEcho,
  type DecisionAssumptionsArtifactEcho,
  type DecisionConsequencesArtifactEcho,
  type GovernanceArtifactEcho,
  type PortfolioArtifactEcho,
  type ProductArtifactEcho,
} from "../node-builder.js";
import { buildNodeId } from "../ids.js";
import { REPOSITORY_ID } from "./graph-fixtures.js";

describe("resolveRepositoryIdFromArchitecture / buildRepositoryNode", () => {
  it("returns undefined when architecture.identity is absent", () => {
    expect(resolveRepositoryIdFromArchitecture(undefined)).toBeUndefined();
    expect(buildRepositoryNode(undefined, REPOSITORY_ID)).toBeUndefined();
  });

  it("builds a repository node from identity, preferring displayLabel over sourceLabel over the raw id", () => {
    const architecture: ArchitectureArtifactEcho = {
      identity: { id: REPOSITORY_ID, name: { displayLabel: "Display Name" }, evidence: [{ path: "README.md" }] },
    };
    expect(resolveRepositoryIdFromArchitecture(architecture)).toBe(REPOSITORY_ID);
    const node = buildRepositoryNode(architecture, REPOSITORY_ID)!;
    expect(node.id).toBe(buildNodeId(REPOSITORY_ID));
    expect(node.node_type).toBe("repository");
    expect(node.label).toBe("Display Name");
    expect(node.confidence).toBe("confirmed");
    expect(node.evidence_refs).toEqual([{ path: "README.md", lines: undefined, source_artifact: "architecture" }]);
  });

  it("falls back to sourceLabel, then to the raw id, when displayLabel is absent", () => {
    const withSourceLabel: ArchitectureArtifactEcho = { identity: { id: "repo-x", name: { sourceLabel: "Source Label" } } };
    expect(buildRepositoryNode(withSourceLabel, "repo-x")!.label).toBe("Source Label");

    const withNoLabel: ArchitectureArtifactEcho = { identity: { id: "repo-y" } };
    expect(buildRepositoryNode(withNoLabel, "repo-y")!.label).toBe("repo-y");
  });
});

describe("buildComponentNodes", () => {
  it("returns [] when architecture.components is absent", () => {
    expect(buildComponentNodes(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("maps every component to a confirmed component node", () => {
    const architecture: ArchitectureArtifactEcho = {
      components: [
        { id: "comp-a", label: { displayLabel: "Component A" } },
        { id: "comp-b" },
      ],
    };
    const nodes = buildComponentNodes(architecture, REPOSITORY_ID);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.node_type).toBe("component");
    expect(nodes[0]!.label).toBe("Component A");
    expect(nodes[1]!.label).toBe("comp-b");
    expect(nodes.every((n) => n.confidence === "confirmed" && n.repository_id === REPOSITORY_ID)).toBe(true);
  });
});

describe("buildWorkflowNodes", () => {
  it("returns [] when workflowFamilies is absent, and maps otherwise", () => {
    expect(buildWorkflowNodes(undefined, REPOSITORY_ID)).toEqual([]);
    const nodes = buildWorkflowNodes({ workflowFamilies: [{ id: "wf-1", label: { displayLabel: "Workflow One" } }] }, REPOSITORY_ID);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.node_type).toBe("workflow");
    expect(nodes[0]!.label).toBe("Workflow One");
  });
});

describe("buildRuntimeEntrypointNodes", () => {
  it("returns [] when there are no components", () => {
    expect(buildRuntimeEntrypointNodes(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("synthesizes one node per entrypoint, with an id derived from componentId+entrypoint (stable, not index-based)", () => {
    const architecture: ArchitectureArtifactEcho = {
      components: [{ id: "comp-a", implementation: { entryPoints: ["src/main.ts", "src/cli.ts"] } }],
    };
    const nodes = buildRuntimeEntrypointNodes(architecture, REPOSITORY_ID);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe(buildNodeId("comp-a#entrypoint:src/main.ts"));
    expect(nodes[0]!.label).toBe("src/main.ts");
    expect(nodes[1]!.id).toBe(buildNodeId("comp-a#entrypoint:src/cli.ts"));
    // Reordering entrypoints in the source array should reorder the output identically (id is content-derived).
    const reordered: ArchitectureArtifactEcho = {
      components: [{ id: "comp-a", implementation: { entryPoints: ["src/cli.ts", "src/main.ts"] } }],
    };
    const reorderedNodes = buildRuntimeEntrypointNodes(reordered, REPOSITORY_ID);
    expect(new Set(reorderedNodes.map((n) => n.id))).toEqual(new Set(nodes.map((n) => n.id)));
  });

  it("produces no entrypoint nodes for a component with no entryPoints", () => {
    const architecture: ArchitectureArtifactEcho = { components: [{ id: "comp-a" }] };
    expect(buildRuntimeEntrypointNodes(architecture, REPOSITORY_ID)).toEqual([]);
  });
});

describe("buildCapabilityDomainNodes", () => {
  it("returns [] when domains is absent, and maps otherwise", () => {
    expect(buildCapabilityDomainNodes(undefined, REPOSITORY_ID)).toEqual([]);
    const nodes = buildCapabilityDomainNodes({ domains: [{ id: "dom-1", displayName: "Domain One" }] }, REPOSITORY_ID);
    expect(nodes[0]!.node_type).toBe("capability_domain");
    expect(nodes[0]!.label).toBe("Domain One");
  });
});

describe("buildCapabilityNodes", () => {
  it("returns [] when the artifact itself is absent", () => {
    expect(buildCapabilityNodes(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("maps each of the 5 capability groups to its own fixed confidence level", () => {
    const capability: CapabilityArtifactEcho = {
      includedCapabilities: [{ id: "cap-included" }],
      qualifiedCapabilities: [{ id: "cap-qualified" }],
      roadmapCapabilities: [{ id: "cap-roadmap" }],
      gapCapabilities: [{ id: "cap-gap" }],
      unresolvedCapabilities: [{ id: "cap-unresolved" }],
    };
    const nodes = buildCapabilityNodes(capability, REPOSITORY_ID);
    const byId = new Map(nodes.map((n) => [n.source_entity_id, n]));
    expect(byId.get("cap-included")!.confidence).toBe("confirmed");
    expect(byId.get("cap-qualified")!.confidence).toBe("qualified");
    expect(byId.get("cap-roadmap")!.confidence).toBe("unverifiable");
    expect(byId.get("cap-gap")!.confidence).toBe("unverifiable");
    expect(byId.get("cap-unresolved")!.confidence).toBe("unverifiable");
    expect(nodes.every((n) => n.node_type === "capability")).toBe(true);
  });

  it("maps evidence entries into evidence_refs with path/detail from sourcePath/description", () => {
    const capability: CapabilityArtifactEcho = {
      includedCapabilities: [{ id: "cap-1", evidence: [{ id: "ev-1", sourcePath: "src/a.ts", description: "desc" }] }],
    };
    const nodes = buildCapabilityNodes(capability, REPOSITORY_ID);
    expect(nodes[0]!.evidence_refs).toEqual([{ path: "src/a.ts", detail: "desc", source_artifact: "capability" }]);
  });

  it("never reads excludedCandidates (not part of the echo interface, so no path exists to include them)", () => {
    // No excludedCandidates field exists on CapabilityArtifactEcho at all -- verified structurally by
    // the fact that only the 5 documented groups above produce nodes.
    const capability: CapabilityArtifactEcho = { includedCapabilities: [{ id: "cap-1" }] };
    expect(buildCapabilityNodes(capability, REPOSITORY_ID)).toHaveLength(1);
  });
});

describe("buildProductIdentityNode", () => {
  it("returns undefined when identity is absent", () => {
    expect(buildProductIdentityNode(undefined, REPOSITORY_ID)).toBeUndefined();
    expect(buildProductIdentityNode({}, REPOSITORY_ID)).toBeUndefined();
  });

  it("synthesizes a deterministic id from the repository id only (no upstream id)", () => {
    const product: ProductArtifactEcho = { identity: { displayName: "My Product" } };
    const node = buildProductIdentityNode(product, REPOSITORY_ID)!;
    expect(node.id).toBe(buildNodeId(`product-identity:${REPOSITORY_ID}`));
    expect(node.node_type).toBe("product");
    expect(node.label).toBe("My Product");
  });

  it("falls back to the repository id as the label when displayName is absent", () => {
    const node = buildProductIdentityNode({ identity: {} }, REPOSITORY_ID)!;
    expect(node.label).toBe(REPOSITORY_ID);
  });
});

describe("buildPortfolioProductNodes / buildPortfolioRelationshipNodes", () => {
  it("returns [] when products/portfolio is absent", () => {
    expect(buildPortfolioProductNodes(undefined, REPOSITORY_ID)).toEqual([]);
    expect(buildPortfolioRelationshipNodes(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("maps portfolio products to product nodes sourced from 'portfolio'", () => {
    const portfolio: PortfolioArtifactEcho = { products: [{ id: "prod-1", displayName: "Product One" }] };
    const nodes = buildPortfolioProductNodes(portfolio, REPOSITORY_ID);
    expect(nodes[0]!.node_type).toBe("product");
    expect(nodes[0]!.source_artifact).toBe("portfolio");
    expect(nodes[0]!.label).toBe("Product One");
  });

  it("combines relationships and unresolvedRelationships into portfolio_relationship nodes and resolves evidence by id", () => {
    const portfolio: PortfolioArtifactEcho = {
      relationships: [{ id: "rel-1", productAId: "p1", productBId: "p2", statement: "depends", evidenceIds: ["ev-1"] }],
      unresolvedRelationships: [{ id: "rel-2", productAId: "p1", productBId: "p3" }],
      evidence: [{ id: "ev-1", text: "evidence text" }],
    };
    const nodes = buildPortfolioRelationshipNodes(portfolio, REPOSITORY_ID);
    expect(nodes).toHaveLength(2);
    const rel1 = nodes.find((n) => n.source_entity_id === "rel-1")!;
    expect(rel1.label).toBe("depends");
    expect(rel1.evidence_refs).toEqual([{ detail: "evidence text", source_artifact: "portfolio" }]);
    const rel2 = nodes.find((n) => n.source_entity_id === "rel-2")!;
    expect(rel2.label).toBe("rel-2");
    expect(rel2.evidence_refs).toEqual([]);
  });

  it("drops an evidenceId that has no matching entry in the evidence array", () => {
    const portfolio: PortfolioArtifactEcho = {
      relationships: [{ id: "rel-1", productAId: "p1", productBId: "p2", evidenceIds: ["missing-ev"] }],
      evidence: [],
    };
    const nodes = buildPortfolioRelationshipNodes(portfolio, REPOSITORY_ID);
    expect(nodes[0]!.evidence_refs).toEqual([]);
  });
});

describe("buildPolicyNodes / buildGovernanceFindingNodes / buildBaselineNode", () => {
  it("returns [] / undefined when governance fields are absent", () => {
    expect(buildPolicyNodes(undefined, REPOSITORY_ID)).toEqual([]);
    expect(buildGovernanceFindingNodes(undefined, REPOSITORY_ID)).toEqual([]);
    expect(buildBaselineNode(undefined, REPOSITORY_ID)).toBeUndefined();
    expect(buildBaselineNode({}, REPOSITORY_ID)).toBeUndefined();
  });

  it("maps policies, findings (preserving evidence_refs' own source_artifact verbatim), and baseline", () => {
    const governance: GovernanceArtifactEcho = {
      policies: [{ id: "pol-1", name: "Policy One" }],
      findings: [{ id: "find-1", statement: "Finding One", evidence_refs: [{ path: "a.ts", source_artifact: "architecture" }] }],
      baseline: { id: "baseline-1" },
    };
    const policyNodes = buildPolicyNodes(governance, REPOSITORY_ID);
    expect(policyNodes[0]!.node_type).toBe("policy");
    expect(policyNodes[0]!.label).toBe("Policy One");

    const findingNodes = buildGovernanceFindingNodes(governance, REPOSITORY_ID);
    expect(findingNodes[0]!.node_type).toBe("governance_finding");
    // passThroughEvidenceRefs preserves the finding's own evidence_refs source_artifact verbatim (architecture),
    // rather than overwriting it with the citing domain (governance).
    expect(findingNodes[0]!.evidence_refs).toEqual([{ path: "a.ts", lines: undefined, source_artifact: "architecture" }]);

    const baselineNode = buildBaselineNode(governance, REPOSITORY_ID)!;
    expect(baselineNode.node_type).toBe("baseline");
    expect(baselineNode.label).toBe("baseline-1");
  });
});

describe("decision node builders", () => {
  it("returns [] when the respective artifact is absent", () => {
    expect(buildDecisionNodes(undefined, REPOSITORY_ID)).toEqual([]);
    expect(buildDecisionAssumptionNodes(undefined, REPOSITORY_ID)).toEqual([]);
    expect(buildDecisionConsequenceNodes(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("maps decisions, assumptions, and consequences with evidence_refs passed through verbatim", () => {
    const decision: DecisionArtifactEcho = {
      decisions: [{ id: "dec-1", title: "Decision One", evidence_refs: [{ path: "d.ts", source_artifact: "decision" }] }],
    };
    const decisionNodes = buildDecisionNodes(decision, REPOSITORY_ID);
    expect(decisionNodes[0]!.node_type).toBe("decision");
    expect(decisionNodes[0]!.label).toBe("Decision One");
    expect(decisionNodes[0]!.evidence_refs).toEqual([{ path: "d.ts", lines: undefined, source_artifact: "decision" }]);

    const assumptions: DecisionAssumptionsArtifactEcho = {
      assumptions: [{ id: "assume-1", decision_id: "dec-1", statement: "Assumption One" }],
    };
    const assumptionNodes = buildDecisionAssumptionNodes(assumptions, REPOSITORY_ID);
    expect(assumptionNodes[0]!.node_type).toBe("decision_assumption");
    expect(assumptionNodes[0]!.label).toBe("Assumption One");

    const consequences: DecisionConsequencesArtifactEcho = {
      consequences: [{ id: "conseq-1", decision_id: "dec-1", statement: "Consequence One" }],
    };
    const consequenceNodes = buildDecisionConsequenceNodes(consequences, REPOSITORY_ID);
    expect(consequenceNodes[0]!.node_type).toBe("decision_consequence");
    expect(consequenceNodes[0]!.label).toBe("Consequence One");
  });

  it("falls back to the raw id as label when title/statement is absent", () => {
    const decision: DecisionArtifactEcho = { decisions: [{ id: "dec-2" }] };
    expect(buildDecisionNodes(decision, REPOSITORY_ID)[0]!.label).toBe("dec-2");
  });
});

describe("buildEvidenceNodes", () => {
  it("returns [] when nothing has an id-bearing evidence array", () => {
    expect(buildEvidenceNodes(undefined, undefined, undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("collects evidence from capability capabilities, product identity, and portfolio, deduping by evidence id", () => {
    const capability: CapabilityArtifactEcho = {
      includedCapabilities: [{ id: "cap-1", evidence: [{ id: "ev-shared", sourcePath: "a.ts", description: "shared" }] }],
      qualifiedCapabilities: [{ id: "cap-2", evidence: [{ id: "ev-shared", sourcePath: "b.ts", description: "duplicate, should be skipped" }] }],
    };
    const product: ProductArtifactEcho = { identity: { evidence: [{ id: "ev-product", sourcePath: "p.ts", text: "product evidence" }] } };
    const portfolio: PortfolioArtifactEcho = { evidence: [{ id: "ev-portfolio", text: "portfolio evidence" }] };

    const nodes = buildEvidenceNodes(capability, product, portfolio, REPOSITORY_ID);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.node_type === "evidence")).toBe(true);
    const capabilityEvidence = nodes.find((n) => n.source_entity_id === "ev-shared")!;
    expect(capabilityEvidence.label).toBe("shared");
    expect(capabilityEvidence.source_artifact).toBe("capability");
    const productEvidence = nodes.find((n) => n.source_entity_id === "ev-product")!;
    expect(productEvidence.label).toBe("product evidence");
    const portfolioEvidence = nodes.find((n) => n.source_entity_id === "ev-portfolio")!;
    expect(portfolioEvidence.label).toBe("portfolio evidence");
  });

  it("cross-artifact ids are deduped globally, not just within a single artifact's own list", () => {
    const capability: CapabilityArtifactEcho = {
      includedCapabilities: [{ id: "cap-1", evidence: [{ id: "ev-collide", sourcePath: "a.ts" }] }],
    };
    const product: ProductArtifactEcho = { identity: { evidence: [{ id: "ev-collide", sourcePath: "p.ts" }] } };
    const nodes = buildEvidenceNodes(capability, product, undefined, REPOSITORY_ID);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.source_artifact).toBe("capability");
  });
});
