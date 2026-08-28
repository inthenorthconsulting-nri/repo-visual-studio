import type {
  ChangeReviewSourceInput,
  ReviewGovernanceChangeEntry,
  ReviewSnapshot,
  ReviewSourceEdge,
  ReviewSourceFinding,
  ReviewSourceNode,
} from "../source.js";

// The fifteen fixtures Milestone 10.4 requires, built by hand.
//
// Every one states its own premises. Nothing here is generated from a
// repository, and nothing is derived from another fixture: a fixture that
// moved when the repository moved would turn every assertion into a moving
// target, and a fixture derived from its neighbour would let one mistake
// propagate through the suite looking like agreement.
//
// They are all deliberately small. A reader of a failing assertion should be
// able to hold the whole graph in their head and say whether the expectation
// was right -- with the single exception of `largeDelta`, which exists
// precisely to exceed what fits.

export function node(id: string, over: Partial<ReviewSourceNode> = {}): ReviewSourceNode {
  return {
    id,
    node_type: "component",
    label: id.toUpperCase(),
    source_entity_id: id,
    resolution_status: "resolved",
    confidence: "confirmed",
    evidence_refs: [{ path: `src/${id}.ts`, lines: "1-40" }],
    ...over,
  };
}

export function edge(from: string, to: string, over: Partial<ReviewSourceEdge> = {}): ReviewSourceEdge {
  return {
    id: `e-${from}-${to}`,
    edge_type: "depends_on",
    from_node_id: from,
    to_node_id: to,
    resolution_status: "resolved",
    detail: `${from} depends on ${to}`,
    ...over,
  };
}

export function snapshot(
  id: string,
  nodes: readonly ReviewSourceNode[],
  edges: readonly ReviewSourceEdge[],
): ReviewSnapshot {
  return { snapshot_id: id, nodes: [...nodes], edges: [...edges] };
}

const COMPATIBLE = { status: "compatible" as const, reasons: [] };

/** The estate both baseline snapshots are built from: an entrypoint, two services, a store. */
function baseNodes(): ReviewSourceNode[] {
  return [
    node("api", { node_type: "runtime_entrypoint" }),
    node("orders"),
    node("billing"),
    node("store", { node_type: "package" }),
  ];
}

function baseEdges(): ReviewSourceEdge[] {
  return [edge("api", "orders"), edge("orders", "store"), edge("billing", "store")];
}

function base(id: string): ReviewSnapshot {
  return snapshot(id, baseNodes(), baseEdges());
}

// --- 1. no change ----------------------------------------------------------

export function noChange(): ChangeReviewSourceInput {
  return {
    before: base("snap-a"),
    after: base("snap-b"),
    compatibility: COMPATIBLE,
    graph_changes: {},
  };
}

// --- 2. one component added ------------------------------------------------

export function componentAdded(): ChangeReviewSourceInput {
  const after = snapshot(
    "snap-b",
    [...baseNodes(), node("shipping")],
    [...baseEdges(), edge("shipping", "store")],
  );
  return {
    before: base("snap-a"),
    after,
    compatibility: COMPATIBLE,
    graph_changes: { nodes_added: ["shipping"], edges_added: ["e-shipping-store"] },
  };
}

// --- 3. one component removed ----------------------------------------------

export function componentRemoved(): ChangeReviewSourceInput {
  const after = snapshot(
    "snap-b",
    baseNodes().filter((n) => n.id !== "billing"),
    baseEdges().filter((e) => e.id !== "e-billing-store"),
  );
  return {
    before: base("snap-a"),
    after,
    compatibility: COMPATIBLE,
    graph_changes: { nodes_removed: ["billing"], edges_removed: ["e-billing-store"] },
  };
}

// --- 4. dependency rerouted ------------------------------------------------

export function dependencyRerouted(): ChangeReviewSourceInput {
  const after = snapshot(
    "snap-b",
    baseNodes(),
    [edge("api", "orders"), edge("orders", "billing"), edge("billing", "store")],
  );
  return {
    before: base("snap-a"),
    after,
    compatibility: COMPATIBLE,
    graph_changes: {
      edges_added: ["e-orders-billing"],
      edges_removed: ["e-orders-store"],
      dependency_paths_changed: ["orders->store"],
    },
  };
}

// --- 5. capability regression ----------------------------------------------

/** A governance change entry recording reduced or lost runtime, which is what makes a change a regression. */
export function governanceChange(
  id: string,
  entityId: string,
  over: Partial<ReviewGovernanceChangeEntry> = {},
): ReviewGovernanceChangeEntry {
  return {
    id,
    entity_id: entityId,
    entity_label: entityId.toUpperCase(),
    type: "modified",
    domain_path: "architecture.components",
    detail: `${entityId} changed.`,
    evidence_refs: [{ path: `src/${entityId}.ts`, lines: "1-40" }],
    ...over,
  };
}

export function capabilityRegression(): ChangeReviewSourceInput {
  return {
    before: base("snap-a"),
    after: base("snap-b"),
    compatibility: COMPATIBLE,
    graph_changes: {},
    governance_changes: [
      governanceChange("gov-change-orders", "orders", {
        detail: "Order placement no longer completes end to end.",
        classification: { materiality: "material", runtime_impact: "lost", consumer_impact: "cross_component" },
      }),
    ],
    entity_links: [{ entity_id: "orders", capability_ids: ["cap-order-placement"], product_ids: ["prod-commerce"] }],
  };
}

// --- 6. governance blocking finding introduced -----------------------------

export function finding(id: string, over: Partial<ReviewSourceFinding> = {}): ReviewSourceFinding {
  return {
    id,
    severity: "blocking",
    statement: "A component with a runtime entrypoint was removed without a recorded decision.",
    affected_entity_ids: ["billing"],
    human_review_required: true,
    blast_radius: "cross_component",
    evidence_refs: [{ path: "governance/policy.yaml", lines: "10-14" }],
    ...over,
  };
}

export function blockingFinding(): ChangeReviewSourceInput {
  return { ...componentRemoved(), findings: [finding("gf-blocking")] };
}

// --- 7. review-required finding introduced ---------------------------------

export function reviewRequiredFinding(): ChangeReviewSourceInput {
  return {
    ...componentRemoved(),
    findings: [
      finding("gf-review", {
        severity: "review_required",
        statement: "A removed component is named by an accepted decision; a human should confirm this is intended.",
      }),
    ],
  };
}

// --- 8. decision assumption contradicted -----------------------------------

export function decisionAssumptionContradicted(): ChangeReviewSourceInput {
  return {
    ...componentRemoved(),
    decision_impacts: [
      {
        id: "di-1",
        decision_node_id: "adr-0007",
        target_entity_node_id: "billing",
        state: "assumption_contradicted",
        detail: "ADR-0007 assumed billing would remain a separate component.",
        evidence_refs: [{ path: "docs/adr/0007.md", lines: "20-31" }],
      },
    ],
  };
}

// --- 9. decision implementation drift --------------------------------------

export function decisionImplementationDrift(): ChangeReviewSourceInput {
  return {
    before: base("snap-a"),
    after: base("snap-b"),
    compatibility: COMPATIBLE,
    graph_changes: { relationships_changed: ["e-orders-store"] },
    // The drift is recorded against the component, which is where
    // @rvs/decision-intelligence records it. The relationship change is the
    // graph's separate account of the same edit.
    governance_changes: [
      governanceChange("gov-change-orders-drift", "orders", {
        detail: "Orders no longer depends on the store directly.",
      }),
    ],
    decision_impacts: [
      {
        id: "di-2",
        decision_node_id: "adr-0011",
        target_entity_node_id: "orders",
        state: "implementation_invalidated",
        detail: "ADR-0011 records a direct store dependency that the implementation no longer matches.",
        evidence_refs: [{ path: "docs/adr/0011.md", lines: "8-14" }],
      },
    ],
  };
}

// --- 10. unknown downstream consumer ---------------------------------------

export function unknownConsumer(): ChangeReviewSourceInput {
  const input = componentAdded();
  return {
    ...input,
    after: snapshot("snap-b", input.after.nodes, [
      ...input.after.edges,
      edge("shipping", "unresolved-ref", {
        id: "e-shipping-unknown",
        resolution_status: "unresolved",
        detail: "an import that could not be resolved to a known entity",
      }),
    ]),
    unresolved_links: [
      {
        id: "e-shipping-unknown",
        from_entity_id: "shipping",
        detail: "an import that could not be resolved to a known entity",
        boundary: "single repository",
      },
    ],
  };
}

// --- 11. resolved governance finding ---------------------------------------

export function resolvedFinding(): ChangeReviewSourceInput {
  return {
    before: base("snap-a"),
    after: base("snap-b"),
    compatibility: COMPATIBLE,
    graph_changes: {},
    findings: [
      finding("gf-resolved", {
        severity: "review_required",
        affected_entity_ids: ["orders"],
        resolved: true,
        statement: "Order placement had no recorded evidence; evidence is now recorded.",
      }),
    ],
  };
}

// --- 12. multiple causally related changes ---------------------------------

/**
 * The chain §39 requires: a component is removed, the capability it carried
 * regresses, a decision assumption is contradicted, and a governance finding
 * is raised -- all over the same entity, all recorded upstream.
 */
export function causalChain(): ChangeReviewSourceInput {
  const removed = componentRemoved();
  const capability = node("cap-invoicing", { node_type: "capability", label: "Invoicing" });
  return {
    ...removed,
    before: snapshot("snap-a", [...removed.before.nodes, capability], [
      ...removed.before.edges,
      edge("billing", "cap-invoicing", { id: "e-billing-cap", edge_type: "implements" }),
    ]),
    after: snapshot("snap-b", [...removed.after.nodes, capability], removed.after.edges),
    governance_changes: [
      // Two entries, because upstream records two facts: the component is
      // gone, and the capability it carried no longer runs. Collapsing them
      // into one would make the reader choose which of the two they were
      // being told.
      governanceChange("gov-change-billing", "billing", {
        type: "removed",
        detail: "Billing was removed.",
        classification: { materiality: "material", runtime_impact: "lost", consumer_impact: "cross_component" },
      }),
      governanceChange("gov-change-invoicing", "cap-invoicing", {
        type: "modified",
        domain_path: "capability.capabilities",
        detail: "Invoicing no longer has a runtime implementation.",
        classification: { materiality: "material", runtime_impact: "lost", consumer_impact: "cross_component" },
      }),
    ],
    findings: [finding("gf-chain")],
    decision_impacts: [
      {
        id: "di-chain",
        decision_node_id: "adr-0007",
        target_entity_node_id: "billing",
        state: "assumption_contradicted",
        detail: "ADR-0007 assumed billing would remain a separate component.",
        evidence_refs: [{ path: "docs/adr/0007.md", lines: "20-31" }],
      },
    ],
    impact_paths: [
      {
        id: "ip-billing-store",
        origin_entity_id: "billing",
        entity_ids: ["billing", "store"],
        artifact_id: "impact-results.json",
        boundary: "downstream traversal, max depth 12",
        evidence_refs: [{ path: "src/billing.ts", lines: "1-40" }],
      },
    ],
    entity_links: [{ entity_id: "billing", capability_ids: ["cap-invoicing"], product_ids: ["prod-commerce"] }],
  };
}

// --- 13. large delta requiring split views ---------------------------------

/**
 * Forty components, thirty of them changed.
 *
 * Sized to exceed every budget: `simplified` allows 13 nodes, so this fixture
 * cannot be drawn without splitting, collapsing, or paging. That is the point
 * -- it is the fixture that proves the anchor floor holds when the budget is
 * the binding constraint rather than a formality.
 */
export function largeDelta(): ChangeReviewSourceInput {
  const ids = Array.from({ length: 40 }, (_, i) => `svc-${String(i).padStart(2, "0")}`);
  const beforeNodes = ids.map((id) => node(id));
  const beforeEdges = ids.slice(1).map((id, i) => edge(ids[i], id));
  const addedIds = Array.from({ length: 10 }, (_, i) => `new-${String(i).padStart(2, "0")}`);
  const afterNodes = [...beforeNodes, ...addedIds.map((id) => node(id))];
  const afterEdges = [...beforeEdges, ...addedIds.map((id) => edge("svc-00", id))];
  return {
    before: snapshot("snap-a", beforeNodes, beforeEdges),
    after: snapshot("snap-b", afterNodes, afterEdges),
    compatibility: COMPATIBLE,
    graph_changes: {
      nodes_added: addedIds,
      edges_added: addedIds.map((id) => `e-svc-00-${id}`),
      entity_types_changed: ids.slice(0, 20),
    },
  };
}

// --- 14. simplified mode with anchor floor ---------------------------------

/**
 * Twenty entities, every one of them changed.
 *
 * Distinct from `largeDelta`: there, most entities are unchanged and the
 * adapter has plenty of low-value leaves to give up first. Here it has none,
 * so the only way to fit a simplified budget is to reduce real changes -- and
 * the anchor floor is what stops the result becoming stand-ins all the way
 * down.
 */
export function everythingChanged(): ChangeReviewSourceInput {
  const ids = Array.from({ length: 20 }, (_, i) => `mod-${String(i).padStart(2, "0")}`);
  const nodes = ids.map((id) => node(id));
  const edges = ids.slice(1).map((id, i) => edge(ids[i], id));
  return {
    before: snapshot("snap-a", nodes, edges),
    after: snapshot("snap-b", nodes, edges),
    compatibility: COMPATIBLE,
    graph_changes: { entity_types_changed: ids },
  };
}

// --- 15. reordered inputs --------------------------------------------------

/**
 * The same review as `causalChain`, with every input array reversed.
 *
 * Nothing about the architecture differs. If any output differs, something in
 * the pipeline is reading order as meaning.
 */
export function reordered(input: ChangeReviewSourceInput): ChangeReviewSourceInput {
  const reverse = <T>(items: readonly T[] | undefined): T[] | undefined =>
    items === undefined ? undefined : [...items].reverse();
  const gcs = input.graph_changes;
  return {
    ...input,
    before: {
      ...input.before,
      nodes: [...input.before.nodes].reverse(),
      edges: [...input.before.edges].reverse(),
    },
    after: {
      ...input.after,
      nodes: [...input.after.nodes].reverse(),
      edges: [...input.after.edges].reverse(),
    },
    ...(gcs === undefined
      ? {}
      : {
          graph_changes: {
            ...gcs,
            nodes_added: reverse(gcs.nodes_added),
            nodes_removed: reverse(gcs.nodes_removed),
            edges_added: reverse(gcs.edges_added),
            edges_removed: reverse(gcs.edges_removed),
            entity_types_changed: reverse(gcs.entity_types_changed),
            relationships_changed: reverse(gcs.relationships_changed),
            dependency_paths_changed: reverse(gcs.dependency_paths_changed),
          },
        }),
    governance_changes: reverse(input.governance_changes),
    findings: reverse(input.findings),
    decision_impacts: reverse(input.decision_impacts),
    impact_paths: reverse(input.impact_paths),
    unresolved_links: reverse(input.unresolved_links),
    entity_links: reverse(input.entity_links),
  };
}

/** Every fixture, named, so a test can sweep all of them and none is quietly skipped. */
export const FIXTURES: ReadonlyArray<readonly [string, () => ChangeReviewSourceInput]> = [
  ["no change", noChange],
  ["component added", componentAdded],
  ["component removed", componentRemoved],
  ["dependency rerouted", dependencyRerouted],
  ["capability regression", capabilityRegression],
  ["governance blocking finding", blockingFinding],
  ["review-required finding", reviewRequiredFinding],
  ["decision assumption contradicted", decisionAssumptionContradicted],
  ["decision implementation drift", decisionImplementationDrift],
  ["unknown downstream consumer", unknownConsumer],
  ["resolved governance finding", resolvedFinding],
  ["multiple causally related changes", causalChain],
  ["large delta requiring split views", largeDelta],
  ["simplified mode with anchor floor", everythingChanged],
  ["reordered inputs", () => reordered(causalChain())],
];
