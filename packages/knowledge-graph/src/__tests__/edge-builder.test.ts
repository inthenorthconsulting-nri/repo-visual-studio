import { describe, it, expect } from "vitest";
import {
  buildArchitectureContainmentEdges,
  buildArchitectureFlowEdges,
  buildCapabilityRelationshipEdges,
  buildDecisionAssumptionEdges,
  buildDecisionConsequenceEdges,
  buildDecisionLinkEdges,
  buildDecisionSupersessionEdges,
  buildEvidencedByEdges,
  buildGovernanceEdges,
  buildPortfolioDependencyGraphEdges,
  buildPortfolioProductCapabilityEdges,
  buildPortfolioRelationshipReferenceEdges,
  buildProductRequiresCapabilityEdges,
  type ArchitectureFlowEcho,
  type CapabilityLinkArtifactEcho,
  type DecisionLinksArtifactEcho,
  type DecisionSupersessionArtifactEcho,
  type GovernanceLinkArtifactEcho,
  type PortfolioLinkArtifactEcho,
  type ProductCapabilityLinkArtifactEcho,
} from "../edge-builder.js";
import type {
  ArchitectureArtifactEcho,
  CapabilityArtifactEcho,
  PortfolioArtifactEcho,
  DecisionAssumptionsArtifactEcho,
  DecisionConsequencesArtifactEcho,
} from "../node-builder.js";
import { buildEdgeId, buildNodeId } from "../ids.js";
import { REPOSITORY_ID } from "./graph-fixtures.js";

describe("buildArchitectureContainmentEdges", () => {
  it("returns [] when identity or components is absent", () => {
    expect(buildArchitectureContainmentEdges(undefined)).toEqual([]);
    expect(buildArchitectureContainmentEdges({ identity: { id: REPOSITORY_ID } })).toEqual([]);
  });

  it("emits one contains edge per component, from the repository to the component", () => {
    const architecture: ArchitectureArtifactEcho = {
      identity: { id: REPOSITORY_ID },
      components: [{ id: "comp-a" }, { id: "comp-b" }],
    };
    const edges = buildArchitectureContainmentEdges(architecture);
    expect(edges).toHaveLength(2);
    expect(edges[0]!.edge_type).toBe("contains");
    expect(edges[0]!.from_node_id).toBe(buildNodeId(REPOSITORY_ID));
    expect(edges[0]!.to_node_id).toBe(buildNodeId("comp-a"));
    expect(edges[0]!.id).toBe(buildEdgeId("contains", buildNodeId(REPOSITORY_ID), buildNodeId("comp-a")));
    expect(edges[0]!.resolution_status).toBe("resolved");
  });
});

describe("buildArchitectureFlowEdges", () => {
  it("returns [] when flows is absent, and maps flows to invokes edges otherwise", () => {
    expect(buildArchitectureFlowEdges(undefined)).toEqual([]);
    const flowArtifact: ArchitectureFlowEcho = {
      flows: [{ id: "flow-1", label: "Flow One", fromId: "comp-a", toId: "comp-b", evidence: [{ path: "flow.ts" }] }],
    };
    const edges = buildArchitectureFlowEdges(flowArtifact);
    expect(edges[0]!.edge_type).toBe("invokes");
    expect(edges[0]!.detail).toBe("Flow One");
    expect(edges[0]!.evidence_refs).toEqual([{ path: "flow.ts", lines: undefined, source_artifact: "architecture" }]);
  });

  it("falls back to a synthesized detail string when label is absent", () => {
    const flowArtifact: ArchitectureFlowEcho = { flows: [{ id: "flow-2", fromId: "a", toId: "b" }] };
    expect(buildArchitectureFlowEdges(flowArtifact)[0]!.detail).toBe("Architecture flow flow-2");
  });
});

describe("buildCapabilityRelationshipEdges", () => {
  it("returns [] when the artifact is absent", () => {
    expect(buildCapabilityRelationshipEdges(undefined)).toEqual([]);
  });

  it("emits a contains edge from domain to capability, and depends_on edges for each logicalComponent/workflow", () => {
    const capability: CapabilityLinkArtifactEcho = {
      includedCapabilities: [{ id: "cap-1", domainId: "dom-1", logicalComponents: ["comp-a"], workflows: ["wf-1"] }],
    };
    const edges = buildCapabilityRelationshipEdges(capability);
    expect(edges).toHaveLength(3);
    const containsEdge = edges.find((e) => e.edge_type === "contains")!;
    expect(containsEdge.from_node_id).toBe(buildNodeId("dom-1"));
    expect(containsEdge.to_node_id).toBe(buildNodeId("cap-1"));
    const dependsOnEdges = edges.filter((e) => e.edge_type === "depends_on");
    expect(dependsOnEdges).toHaveLength(2);
    expect(dependsOnEdges.every((e) => e.from_node_id === buildNodeId("cap-1"))).toBe(true);
  });

  it("skips the contains edge entirely when domainId is absent", () => {
    const capability: CapabilityLinkArtifactEcho = { includedCapabilities: [{ id: "cap-1" }] };
    expect(buildCapabilityRelationshipEdges(capability)).toEqual([]);
  });

  it("covers all 5 capability groups (roadmap/gap/unresolved included, not just included/qualified)", () => {
    const capability: CapabilityLinkArtifactEcho = {
      roadmapCapabilities: [{ id: "cap-roadmap", domainId: "dom-1" }],
      gapCapabilities: [{ id: "cap-gap", domainId: "dom-1" }],
      unresolvedCapabilities: [{ id: "cap-unresolved", domainId: "dom-1" }],
    };
    expect(buildCapabilityRelationshipEdges(capability)).toHaveLength(3);
  });
});

describe("buildProductRequiresCapabilityEdges", () => {
  it("returns [] when product.identity is absent", () => {
    expect(buildProductRequiresCapabilityEdges(undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("emits a requires edge from the synthesized product-identity entity to each current+qualified capability", () => {
    const product: ProductCapabilityLinkArtifactEcho = {
      identity: { currentCapabilities: ["cap-1"], qualifiedCapabilities: ["cap-2"] },
    };
    const edges = buildProductRequiresCapabilityEdges(product, REPOSITORY_ID);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.edge_type === "requires")).toBe(true);
    expect(edges[0]!.from_node_id).toBe(buildNodeId(`product-identity:${REPOSITORY_ID}`));
  });
});

describe("buildPortfolioProductCapabilityEdges", () => {
  it("returns [] when products is absent", () => {
    expect(buildPortfolioProductCapabilityEdges(undefined)).toEqual([]);
  });

  it("emits a requires edge per product per current+qualified capability id", () => {
    const portfolio: PortfolioLinkArtifactEcho = {
      products: [{ id: "prod-1", currentCapabilityIds: ["cap-1"], qualifiedCapabilityIds: ["cap-2"] }],
    };
    const edges = buildPortfolioProductCapabilityEdges(portfolio);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.edge_type === "requires" && e.from_node_id === buildNodeId("prod-1"))).toBe(true);
  });
});

describe("buildPortfolioRelationshipReferenceEdges", () => {
  it("returns [] when portfolio is absent", () => {
    expect(buildPortfolioRelationshipReferenceEdges(undefined)).toEqual([]);
  });

  it("emits two references edges per relationship (endpoint A and B), resolved for relationships[] and unresolved for unresolvedRelationships[]", () => {
    const portfolio: PortfolioLinkArtifactEcho = {
      relationships: [{ id: "rel-1", productAId: "p1", productBId: "p2", type: "complements" }],
      unresolvedRelationships: [{ id: "rel-2", productAId: "p1", productBId: "p3" }],
    };
    const edges = buildPortfolioRelationshipReferenceEdges(portfolio);
    expect(edges).toHaveLength(4);
    const resolvedEdges = edges.filter((e) => e.from_node_id === buildNodeId("rel-1"));
    expect(resolvedEdges.every((e) => e.resolution_status === "resolved")).toBe(true);
    expect(resolvedEdges.map((e) => e.to_node_id).sort()).toEqual([buildNodeId("p1"), buildNodeId("p2")].sort());
    const unresolvedEdges = edges.filter((e) => e.from_node_id === buildNodeId("rel-2"));
    expect(unresolvedEdges.every((e) => e.resolution_status === "unresolved")).toBe(true);
  });
});

describe("buildPortfolioDependencyGraphEdges", () => {
  it("returns [] when dependencyGraph.edges is absent", () => {
    expect(buildPortfolioDependencyGraphEdges(undefined)).toEqual([]);
    expect(buildPortfolioDependencyGraphEdges({})).toEqual([]);
  });

  it("conservatively maps every dependency-graph edge to depends_on, preserving the upstream kind string verbatim in detail", () => {
    const portfolio: PortfolioLinkArtifactEcho = {
      dependencyGraph: { edges: [{ id: "dep-1", kind: "some-unverified-kind", sourceProductId: "p1", targetId: "p2" }] },
    };
    const edges = buildPortfolioDependencyGraphEdges(portfolio);
    expect(edges[0]!.edge_type).toBe("depends_on");
    expect(edges[0]!.detail).toContain("some-unverified-kind");
  });
});

describe("buildGovernanceEdges", () => {
  it("returns [] when findings is absent", () => {
    expect(buildGovernanceEdges(undefined)).toEqual([]);
  });

  it("emits a governs edge (policy->finding) and an affects edge per affected_entity_id, passing through the finding's own evidence_refs", () => {
    const governance: GovernanceLinkArtifactEcho = {
      findings: [
        {
          id: "find-1",
          policy_id: "pol-1",
          affected_entity_ids: ["comp-a", "comp-b"],
          evidence_refs: [{ path: "g.ts", source_artifact: "governance" }],
        },
      ],
    };
    const edges = buildGovernanceEdges(governance);
    expect(edges).toHaveLength(3);
    const governsEdge = edges.find((e) => e.edge_type === "governs")!;
    expect(governsEdge.from_node_id).toBe(buildNodeId("pol-1"));
    expect(governsEdge.to_node_id).toBe(buildNodeId("find-1"));
    const affectsEdges = edges.filter((e) => e.edge_type === "affects");
    expect(affectsEdges).toHaveLength(2);
    expect(affectsEdges.every((e) => e.from_node_id === buildNodeId("find-1"))).toBe(true);
    expect(affectsEdges[0]!.evidence_refs).toEqual([{ path: "g.ts", lines: undefined, source_artifact: "governance" }]);
  });
});

describe("decision edge builders", () => {
  it("returns [] when the respective artifact is absent", () => {
    expect(buildDecisionSupersessionEdges(undefined)).toEqual([]);
    expect(buildDecisionAssumptionEdges(undefined)).toEqual([]);
    expect(buildDecisionConsequenceEdges(undefined)).toEqual([]);
    expect(buildDecisionLinkEdges(undefined)).toEqual([]);
  });

  it("buildDecisionSupersessionEdges emits a supersedes edge per superseded id", () => {
    const decision: DecisionSupersessionArtifactEcho = { decisions: [{ id: "dec-2", supersedes: ["dec-1"] }] };
    const edges = buildDecisionSupersessionEdges(decision);
    expect(edges[0]!.edge_type).toBe("supersedes");
    expect(edges[0]!.from_node_id).toBe(buildNodeId("dec-2"));
    expect(edges[0]!.to_node_id).toBe(buildNodeId("dec-1"));
  });

  it("buildDecisionAssumptionEdges/buildDecisionConsequenceEdges link decision_id to each assumption/consequence", () => {
    const assumptions: DecisionAssumptionsArtifactEcho = { assumptions: [{ id: "assume-1", decision_id: "dec-1" }] };
    const assumptionEdges = buildDecisionAssumptionEdges(assumptions);
    expect(assumptionEdges[0]!.edge_type).toBe("requires");
    expect(assumptionEdges[0]!.from_node_id).toBe(buildNodeId("dec-1"));
    expect(assumptionEdges[0]!.to_node_id).toBe(buildNodeId("assume-1"));

    const consequences: DecisionConsequencesArtifactEcho = { consequences: [{ id: "conseq-1", decision_id: "dec-1" }] };
    const consequenceEdges = buildDecisionConsequenceEdges(consequences);
    expect(consequenceEdges[0]!.edge_type).toBe("produces");
    expect(consequenceEdges[0]!.from_node_id).toBe(buildNodeId("dec-1"));
  });

  it("buildDecisionLinkEdges skips links with no target_id, and defaults resolution to 'partial' for an unrecognized status", () => {
    const links: DecisionLinksArtifactEcho = {
      links: [
        { id: "link-1", decision_id: "dec-1", target_id: "comp-a", link_type: "affects", resolution: "resolved" },
        { id: "link-2", decision_id: "dec-1" }, // no target_id -> skipped
        { id: "link-3", decision_id: "dec-1", target_id: "comp-b", resolution: "not-a-known-status" },
      ],
    };
    const edges = buildDecisionLinkEdges(links);
    expect(edges).toHaveLength(2);
    expect(edges[0]!.edge_type).toBe("references");
    expect(edges[0]!.resolution_status).toBe("resolved");
    expect(edges[1]!.resolution_status).toBe("partial");
  });

  it("buildDecisionLinkEdges falls back to a synthesized detail when neither detail nor link_type is present", () => {
    const links: DecisionLinksArtifactEcho = { links: [{ id: "link-1", decision_id: "dec-1", target_id: "comp-a" }] };
    expect(buildDecisionLinkEdges(links)[0]!.detail).toBe("decision link type: unknown");
  });
});

describe("buildEvidencedByEdges", () => {
  it("returns [] when nothing has id-bearing evidence", () => {
    expect(buildEvidencedByEdges(undefined, undefined, undefined, REPOSITORY_ID)).toEqual([]);
  });

  it("links capability, product, and portfolio-relationship entities to their evidence ids", () => {
    const capability: CapabilityArtifactEcho = { includedCapabilities: [{ id: "cap-1", evidence: [{ id: "ev-1", sourcePath: "a.ts" }] }] };
    const product = { identity: { evidence: [{ id: "ev-2", sourcePath: "p.ts" }] } };
    const portfolio: PortfolioArtifactEcho = {
      relationships: [{ id: "rel-1", productAId: "p1", productBId: "p2", evidenceIds: ["ev-3"] }],
      evidence: [{ id: "ev-3", text: "portfolio evidence" }],
    };
    const edges = buildEvidencedByEdges(capability, product, portfolio, REPOSITORY_ID);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.edge_type === "evidenced_by")).toBe(true);
    expect(edges.find((e) => e.to_node_id === buildNodeId("ev-1"))!.from_node_id).toBe(buildNodeId("cap-1"));
    expect(edges.find((e) => e.to_node_id === buildNodeId("ev-2"))!.from_node_id).toBe(buildNodeId(`product-identity:${REPOSITORY_ID}`));
    expect(edges.find((e) => e.to_node_id === buildNodeId("ev-3"))!.from_node_id).toBe(buildNodeId("rel-1"));
  });

  it("skips a relationship evidenceId that has no matching entry in the portfolio evidence array", () => {
    const portfolio: PortfolioArtifactEcho = {
      relationships: [{ id: "rel-1", productAId: "p1", productBId: "p2", evidenceIds: ["missing-ev"] }],
      evidence: [],
    };
    expect(buildEvidencedByEdges(undefined, undefined, portfolio, REPOSITORY_ID)).toEqual([]);
  });
});
